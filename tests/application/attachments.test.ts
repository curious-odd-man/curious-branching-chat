import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mainThread, reactionCounts } from '@shared/domain'
import type { RichDoc } from '@shared/validation'
import {
    AttachmentService,
    findAttachment,
    markFromInternet
} from '../../src/main/application/attachments'
import type { Ui } from '../../src/main/application/ui'
import { anna, boris, makeCtx, simple, withTempDir } from '../helpers/fixtures'
import { createSession, libraryIn, readSaved, reopenSession } from '../helpers/library'

const EMPTY: RichDoc = { type: 'doc', content: [{ type: 'paragraph' }] } as RichDoc

function fakeUi(answers: { confirm?: boolean; save?: string | null; pick?: string[] } = {}) {
    const asked: string[] = []
    const ui = {
        confirm: async (_p: unknown, q: { message: string; detail?: string }) => {
            asked.push(`${q.message} | ${q.detail ?? ''}`)
            return answers.confirm ?? true
        },
        pickAttachmentSavePath: async () => answers.save ?? null,
        pickAttachmentPaths: async () => answers.pick ?? []
    } as unknown as Ui
    return { ui, asked }
}

describe('attachments in the main process (phase 14)', () => {
    it('stores files for a draft, refuses a file above the limit, and sends a message with files only', async () => {
        await withTempDir(async (dir) => {
            const deps = { ctx: makeCtx('a') }
            const session = await createSession(dir, deps, { author: anna })
            const lib = await libraryIn(dir)
            const small = join(dir, 'план.txt')
            const big = join(dir, 'большой.bin')
            await fs.writeFile(small, 'план работ')
            await fs.writeFile(big, Buffer.alloc(2 * 1024 * 1024 + 1))
            const opened: string[] = []
            const service = new AttachmentService({
                library: lib,
                ui: fakeUi().ui,
                limitMb: () => 2,
                openDir: join(dir, 'open'),
                openPath: async (p) => {
                    opened.push(p)
                    return ''
                },
                platform: 'linux'
            })
            const r = await service.addPaths([small, big])
            expect(r.added).toMatchObject([{ name: 'план.txt', size: 19, type: 'text/plain' }])
            expect(r.refused).toEqual([{ name: 'большой.bin', reason: 'too-large' }])
            expect(r.limitMb).toBe(2)

            const threadId = mainThread(session.current.discussion).threadId
            session.appendMessage(anna, threadId, EMPTY, r.added)
            await session.flush()
            const saved = readSaved(session.documentId)
            const message = mainThread(saved.discussion).messages[0]!
            expect(message.attachments).toEqual(r.added)
            // a size that does not match the stored bytes is refused
            expect(() =>
                session.appendMessage(anna, threadId, simple('x'), [{ ...r.added[0]!, size: 5 }])
            ).toThrow()
        })
    })

    it('saves a copy, and opens a copy in a new folder; a type that can run code is warned first (FR-262, FR-267)', async () => {
        await withTempDir(async (dir) => {
            const deps = { ctx: makeCtx('b') }
            const session = await createSession(dir, deps, { author: boris })
            const lib = await libraryIn(dir)
            const script = join(dir, 'setup.ps1')
            await fs.writeFile(script, 'Write-Host hi')
            const { ui, asked } = fakeUi({ confirm: false, save: join(dir, 'copy.ps1') })
            const opened: string[] = []
            const service = new AttachmentService({
                library: lib,
                ui,
                limitMb: () => 100,
                openDir: join(dir, 'open'),
                openPath: async (p) => {
                    opened.push(p)
                    return ''
                },
                platform: 'linux'
            })
            const { added } = await service.addPaths([script])
            session.appendMessage(
                boris,
                mainThread(session.current.discussion).threadId,
                EMPTY,
                added
            )
            const { message, attachment } = findAttachment(
                session.current.discussion.threads,
                mainThread(session.current.discussion).messages[0]!.messageId,
                0
            )
            // cancelled at the warning: nothing is copied or opened
            expect(await service.open(undefined, attachment, message)).toBe(false)
            expect(asked).toHaveLength(1)
            expect(asked[0]).toContain('.ps1')
            expect(asked[0]).toContain('Борис')
            expect(opened).toEqual([])
            expect(await service.saveAs(undefined, attachment)).toBe(true)
            expect(await fs.readFile(join(dir, 'copy.ps1'), 'utf8')).toBe('Write-Host hi')

            const yes = new AttachmentService({
                library: lib,
                ui: fakeUi({ confirm: true }).ui,
                limitMb: () => 100,
                openDir: join(dir, 'open'),
                openPath: async (p) => {
                    opened.push(p)
                    return ''
                },
                platform: 'linux'
            })
            expect(await yes.open(undefined, attachment, message)).toBe(true)
            expect(opened).toHaveLength(1)
            expect(opened[0]!.endsWith('setup.ps1')).toBe(true)
            expect(opened[0]!.startsWith(join(dir, 'open'))).toBe(true)
            expect(() => findAttachment(session.current.discussion.threads, 'nope', 0)).toThrow()
        })
    })

    it('writes the mark of the web only on Windows', async () => {
        await withTempDir(async (dir) => {
            const file = join(dir, 'x.txt')
            await fs.writeFile(file, 'x')
            expect(await markFromInternet(file, 'linux')).toBe(false)
        })
    })

    it('keeps reactions of the person in the library and gives each a new clock (FR-231, FR-233)', async () => {
        await withTempDir(async (dir) => {
            const deps = { ctx: makeCtx('c') }
            const session = await createSession(dir, deps, { author: anna })
            const threadId = mainThread(session.current.discussion).threadId
            session.appendMessage(anna, threadId, simple('Привет'))
            const id = mainThread(session.current.discussion).messages[0]!.messageId
            session.toggleReaction(boris, id, '👍')
            session.toggleReaction(anna, id, '👍')
            session.toggleReaction(anna, id, '😂')
            session.toggleReaction(anna, id, '😂')
            await session.flush()
            const again = reopenSession(session.documentId, deps)
            const m = mainThread(again.current.discussion).messages[0]!
            expect(reactionCounts(m, anna.participantId)).toEqual([
                { emoji: '👍', by: [anna.participantId, boris.participantId].sort(), mine: true }
            ])
            const clocks = (m.reactions ?? []).map((r) => r.clock)
            expect(new Set(clocks).size).toBe(clocks.length)
            // FR-234: the reaction does not change the read state
            expect(again.current.readState).toEqual(session.current.readState)
        })
    })
})
