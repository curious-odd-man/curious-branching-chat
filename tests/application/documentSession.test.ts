import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { plainTextToRichDoc, mainThread } from '@shared/domain'
import { readDocument, writeDocument } from '../../src/main/document'
import { DocumentSession, type DocumentWriter } from '../../src/main/application/documentSession'
import { scanZip } from '../../src/main/document/zip'
import {
    anna,
    boris,
    clara,
    makeCtx,
    para,
    pngBytes,
    richDoc,
    simple,
    text as textNode,
    withTempDir
} from '../helpers/fixtures'

const text = (t: string) => plainTextToRichDoc(t)
const deferred = () => {
    let resolve!: () => void
    const promise = new Promise<void>((r) => (resolve = r))
    return { promise, resolve }
}

describe('DocumentSession', () => {
    it('creates the file immediately and reopens it (requirements 4.1)', async () => {
        await withTempDir(async (dir) => {
            const file = join(dir, 'Идея.branchchat')
            const s = await DocumentSession.create(file, { ctx: makeCtx() }, { author: anna })
            expect((await readDocument(file)).contents.discussion.title).toBe('Идея')
            expect(
                s.view(anna.participantId).discussion.participants.map((p) => p.displayName)
            ).toEqual(['Анна'])
            expect((await DocumentSession.open(file, { ctx: makeCtx('o') })).documentId).toBe(
                s.documentId
            )
        })
    })

    it('shows a message immediately and saves it (FR-007)', async () => {
        await withTempDir(async (dir) => {
            const file = join(dir, 'a.branchchat')
            const s = await DocumentSession.create(file, { ctx: makeCtx() }, { author: anna })
            const threadId = mainThread(s.view(anna.participantId).discussion).threadId
            s.appendMessage(anna, threadId, text('Привет'))
            expect(mainThread(s.view(anna.participantId).discussion).messages).toHaveLength(1)
            expect(s.saving).toBe(true)
            await s.flush()
            expect(s.saving).toBe(false)
            expect(s.saveError).toBeNull()
            expect(
                mainThread((await readDocument(file)).contents.discussion).messages
            ).toHaveLength(1)
        })
    })

    it('adds a new participant on their first message and marks earlier messages read (FR-112)', async () => {
        await withTempDir(async (dir) => {
            const file = join(dir, 'a.branchchat')
            const ctx = makeCtx()
            const s = await DocumentSession.create(file, { ctx }, { author: anna })
            const threadId = mainThread(s.view(anna.participantId).discussion).threadId
            s.appendMessage(anna, threadId, text('вопрос'))
            s.appendMessage(boris, threadId, text('ответ'))
            await s.flush()
            const saved = (await readDocument(file)).contents
            expect(saved.discussion.participants.map((p) => p.participantId)).toEqual([
                anna.participantId,
                boris.participantId
            ])
            expect(saved.readState[boris.participantId]).toEqual([
                mainThread(saved.discussion).messages[0]!.messageId
            ])
        })
    })

    it('coalesces quick changes into few writes and never writes concurrently', async () => {
        await withTempDir(async (dir) => {
            const file = join(dir, 'a.branchchat')
            let active = 0
            let maxActive = 0
            const gate = deferred()
            const writes: number[] = []
            const writer: DocumentWriter = async (p, c, o) => {
                active++
                maxActive = Math.max(maxActive, active)
                if (writes.length === 1) await gate.promise // hold the first non-create write
                writes.push(mainThread(c.discussion).messages.length)
                await writeDocument(p, c, o)
                active--
            }
            const s = await DocumentSession.create(
                file,
                { ctx: makeCtx(), writer },
                { author: anna }
            )
            const threadId = mainThread(s.view(anna.participantId).discussion).threadId
            for (let i = 0; i < 20; i++) s.appendMessage(anna, threadId, text(`m${i}`))
            gate.resolve()
            await s.flush()
            expect(maxActive).toBe(1)
            expect(writes.length).toBeLessThan(20) // creation + a few coalesced writes
            expect(writes.at(-1)).toBe(20) // the last write contains everything
            expect(
                mainThread((await readDocument(file)).contents.discussion).messages
            ).toHaveLength(20)
        })
    })

    it('keeps changes in memory when saving fails, reports it, and recovers (FR-008)', async () => {
        await withTempDir(async (dir) => {
            const file = join(dir, 'sub', 'a.branchchat')
            await fs.mkdir(join(dir, 'sub'))
            const s = await DocumentSession.create(file, { ctx: makeCtx() }, { author: anna })
            const threadId = mainThread(s.view(anna.participantId).discussion).threadId
            await fs.rm(join(dir, 'sub'), { recursive: true })

            let changes = 0
            s.onChange = () => void changes++
            s.onStatusChange = () => void changes++
            s.appendMessage(anna, threadId, text('не сохранится сразу'))
            await s.flush()
            expect(s.saveError).toMatch(/Не удалось записать файл|Нет доступа/)
            expect(s.view(anna.participantId).saveError).toBe(s.saveError)
            expect(mainThread(s.view(anna.participantId).discussion).messages).toHaveLength(1) // not lost
            expect(changes).toBeGreaterThanOrEqual(2) // change + save finished

            await fs.mkdir(join(dir, 'sub'))
            await s.retrySave()
            expect(s.saveError).toBeNull()
            expect(
                mainThread((await readDocument(file)).contents.discussion).messages
            ).toHaveLength(1)
        })
    })

    it('surfaces domain errors without changing state', async () => {
        await withTempDir(async (dir) => {
            const s = await DocumentSession.create(
                join(dir, 'a.branchchat'),
                { ctx: makeCtx() },
                { author: anna }
            )
            const threadId = mainThread(s.view(anna.participantId).discussion).threadId
            expect(() => s.appendMessage(anna, threadId, text('   '))).toThrow(/empty/)
            expect(() => s.appendMessage(anna, 'no-such-thread', text('x'))).toThrow(/not found/)
            expect(s.saving).toBe(false)
        })
    })

    it('creation fails loudly when the file cannot be written', async () => {
        await withTempDir(async (dir) => {
            await expect(
                DocumentSession.create(
                    join(dir, 'missing-dir', 'a.branchchat'),
                    { ctx: makeCtx() },
                    { author: anna }
                )
            ).rejects.toMatchObject({ code: expect.stringMatching(/WRITE_FAILED|ACCESS_DENIED/) })
        })
    })
})

describe('DocumentSession branches', () => {
    async function sessionWithMessage(dir: string) {
        const file = join(dir, 'a.branchchat')
        const s = await DocumentSession.create(file, { ctx: makeCtx() }, { author: anna })
        const threadId = mainThread(s.view(anna.participantId).discussion).threadId
        s.appendMessage(anna, threadId, text('Привет, это идея про ёлку.'))
        const messageId = mainThread(s.view(anna.participantId).discussion).messages[0]!.messageId
        return { file, s, threadId, messageId }
    }

    it('creates a branch with the quote taken from the stored message, marks the source read, and saves (FR-112)', async () => {
        await withTempDir(async (dir) => {
            const { file, s, messageId } = await sessionWithMessage(dir)
            const branchId = s.createBranch(boris, {
                sourceMessageId: messageId,
                selectionStart: 17,
                selectionEnd: 25
            })
            await s.flush()
            const saved = (await readDocument(file)).contents
            const branch = saved.discussion.threads.find((t) => t.threadId === branchId)!
            expect(branch).toMatchObject({
                sourceMessageId: messageId,
                quoteText: 'про ёлку',
                selectionStart: 17,
                selectionEnd: 25,
                status: 'open',
                createdBy: boris.participantId
            })
            expect(saved.readState[boris.participantId]).toEqual([messageId]) // replying marks the source message read
            expect(saved.discussion.participants.map((p) => p.participantId)).toContain(
                boris.participantId
            )
        })
    })

    it('refuses selections outside the message, empty selections and unknown messages', async () => {
        await withTempDir(async (dir) => {
            const { s, messageId } = await sessionWithMessage(dir)
            await s.flush() // the setup message has been saved; from here on nothing may be scheduled
            const base = { sourceMessageId: messageId }
            expect(() =>
                s.createBranch(boris, { ...base, selectionStart: 5, selectionEnd: 5 })
            ).toThrow()
            expect(() =>
                s.createBranch(boris, { ...base, selectionStart: 0, selectionEnd: 9999 })
            ).toThrow(/outside/)
            expect(() =>
                s.createBranch(boris, {
                    sourceMessageId: 'ghost',
                    selectionStart: 0,
                    selectionEnd: 3
                })
            ).toThrow(/not found/)
            expect(() =>
                s.createBranch(boris, { ...base, selectionStart: 7, selectionEnd: 8 })
            ).toThrow(/non-empty/) // a space
            expect(s.saving).toBe(false) // nothing was changed or scheduled
        })
    })

    it('closing, reopening and titles are saved; a closed branch takes no messages', async () => {
        await withTempDir(async (dir) => {
            const { file, s, messageId } = await sessionWithMessage(dir)
            const branchId = s.createBranch(boris, {
                sourceMessageId: messageId,
                selectionStart: 0,
                selectionEnd: 6
            })
            s.setThreadTitle(boris.participantId, branchId, '  Приветствие ')
            s.setThreadStatus(boris.participantId, branchId, 'closed')
            await s.flush()
            const closed = (await readDocument(file)).contents.discussion.threads.find(
                (t) => t.threadId === branchId
            )!
            expect(closed).toMatchObject({ status: 'closed', title: 'Приветствие' })
            expect(() => s.appendMessage(boris, branchId, text('ещё'))).toThrow(/closed/)

            s.setThreadStatus(boris.participantId, branchId, 'open')
            s.appendMessage(boris, branchId, text('ещё'))
            await s.flush()
            const reopened = (await readDocument(file)).contents.discussion.threads.find(
                (t) => t.threadId === branchId
            )!
            expect(reopened.status).toBe('open')
            expect(reopened.messages).toHaveLength(1)
            expect(() =>
                s.setThreadStatus(
                    anna.participantId,
                    mainThread(s.view(anna.participantId).discussion).threadId,
                    'closed'
                )
            ).toThrow(/main thread/)
        })
    })
})

describe('DocumentSession read state', () => {
    async function twoPeople(dir: string) {
        const file = join(dir, 'a.branchchat')
        const s = await DocumentSession.create(file, { ctx: makeCtx() }, { author: anna })
        const threadId = mainThread(s.view(anna.participantId).discussion).threadId
        s.appendMessage(anna, threadId, text('вопрос 1'))
        s.appendMessage(anna, threadId, text('вопрос 2'))
        await s.flush()
        const ids = mainThread(s.view(anna.participantId).discussion).messages.map(
            (m) => m.messageId
        )
        return { file, s, threadId, ids }
    }

    it('marks a message, a thread and everything as read; saves; adds the participant (FR-111, FR-121, FR-022)', async () => {
        await withTempDir(async (dir) => {
            const { file, s, threadId, ids } = await twoPeople(dir)
            expect(s.unreadTotal(boris.participantId)).toBe(2)

            expect(s.markMessageRead(boris, ids[0]!)).toBe(true)
            expect(s.unreadTotal(boris.participantId)).toBe(1)
            await s.flush()
            const saved = (await readDocument(file)).contents
            expect(saved.readState[boris.participantId]).toEqual([ids[0]])
            expect(saved.discussion.participants.map((p) => p.participantId)).toContain(
                boris.participantId
            )

            expect(s.markThreadRead(boris, threadId)).toBe(true)
            expect(s.unreadTotal(boris.participantId)).toBe(0)
            expect(s.markAllRead(boris)).toBe(false) // nothing left to mark
        })
    })

    it('does nothing (and saves nothing) when everything is already read, and never changes messages', async () => {
        await withTempDir(async (dir) => {
            const { s, ids } = await twoPeople(dir)
            s.markMessageRead(boris, ids[0]!)
            await s.flush()
            expect(s.markMessageRead(boris, ids[0]!)).toBe(false)
            expect(s.saving).toBe(false)
            expect(s.markMessageRead(anna, ids[0]!)).toBe(false) // own messages are always read
        })
    })

    it("only the local participant's entry changes; other entries are preserved on disk (FR-120)", async () => {
        await withTempDir(async (dir) => {
            const { file, s, ids } = await twoPeople(dir)
            s.markMessageRead(boris, ids[0]!)
            await s.flush()
            s.markAllRead(clara)
            await s.flush()
            const saved = (await readDocument(file)).contents.readState
            expect(saved[boris.participantId]).toEqual([ids[0]])
            expect(saved[clara.participantId]).toEqual(ids)
        })
    })

    it('tells beforehand whether an action would change the read state (for the privacy notice, FR-125)', async () => {
        await withTempDir(async (dir) => {
            const { s, threadId, ids } = await twoPeople(dir)
            const change = (a: Parameters<typeof s.readStateChangeFor>[1]) =>
                s.readStateChangeFor(boris.participantId, a)
            expect(change({ type: 'message', messageId: ids[0]! })).toBe(true)
            expect(change({ type: 'thread', threadId })).toBe(true)
            expect(change({ type: 'all' })).toBe(true)
            expect(change({ type: 'send', threadId })).toBe(true) // replying reads what came before
            expect(change({ type: 'branch', messageId: ids[1]! })).toBe(true)
            // Anna wrote everything herself, so for her nothing would change
            for (const a of [
                { type: 'all' },
                { type: 'send', threadId },
                { type: 'message', messageId: ids[0]! }
            ] as const)
                expect(s.readStateChangeFor(anna.participantId, a)).toBe(false)
            expect(s.saving).toBe(false) // asking changes nothing
        })
    })
})

describe('DocumentSession images', () => {
    const imageDoc = (assetId: string) =>
        richDoc(para({ type: 'image', attrs: { assetId } }), para(textNode('подпись')))
    const entries = async (file: string): Promise<string[]> => {
        const names: string[] = []
        await scanZip(file, (e) => void names.push(e.fileName))
        return names.filter((n) => n.startsWith('assets/'))
    }
    async function fresh(
        dir: string,
        deps: Partial<Parameters<typeof DocumentSession.create>[1]> = {}
    ) {
        const file = join(dir, 'a.branchchat')
        const s = await DocumentSession.create(file, { ctx: makeCtx(), ...deps }, { author: anna })
        return { file, s, threadId: mainThread(s.view(anna.participantId).discussion).threadId }
    }

    it('accepts PNG, JPEG, GIF and WebP only (FR-116), with no size limit (NFR-015)', async () => {
        await withTempDir(async (dir) => {
            const { s } = await fresh(dir)
            expect(s.stageImage(pngBytes())).toMatchObject({ mediaType: 'image/png' })
            const jpeg = Buffer.concat([
                Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
                Buffer.alloc(30 * 1024 * 1024)
            ])
            expect(s.stageImage(jpeg)).toMatchObject({ mediaType: 'image/jpeg', size: jpeg.length })
            expect(s.stageImage(Buffer.from('GIF89a\x01\x00\x01\x00'))).toMatchObject({
                mediaType: 'image/gif'
            })
            expect(s.stageImage(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 '))).toMatchObject({
                mediaType: 'image/webp'
            })
            for (const bad of [
                Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
                Buffer.from('BM\x00\x00\x00\x00'),
                Buffer.from('%PDF-1.7'),
                Buffer.alloc(0)
            ])
                expect(() => s.stageImage(bad)).toThrow(/PNG, JPEG, GIF/)
        })
    })

    it('an image that is never sent leaves no trace in the file', async () => {
        await withTempDir(async (dir) => {
            const { file, s, threadId } = await fresh(dir)
            s.stageImage(pngBytes())
            s.appendMessage(anna, threadId, simple('без картинки'))
            await s.flush()
            expect(await entries(file)).toEqual([])
            expect((await readDocument(file)).contents.discussion.assets).toEqual([])
        })
    })

    it('stores a sent image in the file, registers it, and can show it before and after saving (FR-066, FR-068)', async () => {
        await withTempDir(async (dir) => {
            const { file, s, threadId } = await fresh(dir)
            const { assetId } = s.stageImage(pngBytes())
            s.appendMessage(anna, threadId, imageDoc(assetId))
            expect((await s.readAssetBytes(assetId))?.data.equals(pngBytes())).toBe(true) // from memory, not saved yet
            await s.flush()

            const saved = (await readDocument(file)).contents.discussion
            expect(saved.assets).toHaveLength(1)
            expect(saved.assets[0]).toMatchObject({
                assetId,
                mediaType: 'image/png',
                path: `assets/images/${assetId}.png`
            })
            expect(mainThread(saved).messages[0]!.assetReferences).toEqual([assetId])
            expect(await entries(file)).toEqual([`assets/images/${assetId}.png`])
            const fromFile = await s.readAssetBytes(assetId)
            expect(fromFile?.mediaType).toBe('image/png')
            expect(fromFile?.data.equals(pngBytes())).toBe(true)
        })
    })

    it('the same image in two messages is one asset (deduplicated by checksum)', async () => {
        await withTempDir(async (dir) => {
            const { file, s, threadId } = await fresh(dir)
            const first = s.stageImage(pngBytes())
            const second = s.stageImage(pngBytes()) // pasted again
            expect(second.assetId).toBe(first.assetId)
            s.appendMessage(anna, threadId, imageDoc(first.assetId))
            await s.flush()
            s.appendMessage(anna, threadId, imageDoc(first.assetId)) // used again, already in the file
            await s.flush()
            expect(await entries(file)).toHaveLength(1)
            expect((await readDocument(file)).contents.discussion.assets).toHaveLength(1)
            expect(
                mainThread((await readDocument(file)).contents.discussion).messages
            ).toHaveLength(2)
        })
    })

    it('refuses an image that was never added to the draft, without changing anything', async () => {
        await withTempDir(async (dir) => {
            const { s, threadId } = await fresh(dir)
            await s.flush()
            expect(() => s.appendMessage(anna, threadId, imageDoc('a'.repeat(64)))).toThrow(
                /was not added/
            )
            expect(s.saving).toBe(false)
            expect(mainThread(s.view(anna.participantId).discussion).messages).toHaveLength(0)
        })
    })

    it('keeps the image queued when saving fails, and writes it on retry (FR-008)', async () => {
        await withTempDir(async (dir) => {
            let fail = true
            const writer: DocumentWriter = async (p, c, o) => {
                if (fail && o?.newAssets) throw new Error('disk full')
                await writeDocument(p, c, o)
            }
            const { file, s, threadId } = await fresh(dir, { writer })
            const { assetId } = s.stageImage(pngBytes())
            s.appendMessage(anna, threadId, imageDoc(assetId))
            await s.flush()
            expect(s.saveError).not.toBeNull()
            expect((await s.readAssetBytes(assetId))?.data.equals(pngBytes())).toBe(true) // still available in memory
            fail = false
            await s.retrySave()
            expect(s.saveError).toBeNull()
            expect(await entries(file)).toEqual([`assets/images/${assetId}.png`])
        })
    })

    it('shows a placeholder (null) for missing, unknown or damaged image data (FR-075)', async () => {
        await withTempDir(async (dir) => {
            // a writer that "loses" the image data: the file lists the image but has no entry for it
            const writer: DocumentWriter = (p, c, o) =>
                writeDocument(p, c, o && { ...o, newAssets: [] })
            const { file, s, threadId } = await fresh(dir, { writer })
            const { assetId } = s.stageImage(pngBytes())
            s.appendMessage(anna, threadId, imageDoc(assetId))
            await s.flush()
            expect(await entries(file)).toEqual([])
            expect(await s.readAssetBytes(assetId)).toBeNull() // listed, but the data is not in the file
            expect(await s.readAssetBytes('b'.repeat(64))).toBeNull() // not listed at all

            // damaged: the bytes in the file do not match the recorded checksum
            const reopened = await DocumentSession.open(file, { ctx: makeCtx('o') })
            expect(reopened.view(anna.participantId).missingAssetIds).toEqual([assetId])
        })
    })

    it('every session has its own id, used in image URLs', async () => {
        await withTempDir(async (dir) => {
            const { file, s } = await fresh(dir)
            const other = await DocumentSession.open(file, { ctx: makeCtx('o') })
            expect(s.sessionId).not.toBe(other.sessionId)
            expect(s.view(anna.participantId).sessionId).toBe(s.sessionId)
        })
    })
})
