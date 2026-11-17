import { afterEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import {
    addAsset,
    appendMessage,
    createBranch,
    mainThread,
    markMessageRead,
    setThreadTitle
} from '@shared/domain'
import { normalizeSynced } from '@shared/sync'
import { checkDiscussionIntegrity, type DocumentContents } from '@shared/validation'
import { prepareImage, readDocument, writeDocument } from '../../src/main/document'
import { mergeDiscussion } from '../../src/main/library'
import {
    anna,
    boris,
    buildSample,
    makeCtx,
    pngBytes,
    richDoc,
    para,
    simple,
    withTempDir
} from '../helpers/fixtures'
import { closeLibraries, libraryIn } from '../helpers/library'

afterEach(() => closeLibraries())

const plain = (c: unknown): unknown => JSON.parse(JSON.stringify(c))
const count = (c: DocumentContents): number =>
    c.discussion.threads.reduce((n, t) => n + t.messages.length, 0)

/** The sample discussion with one image in a message. */
function withImage(): { contents: DocumentContents; image: ReturnType<typeof prepareImage> } {
    const s = buildSample()
    const image = prepareImage(pngBytes(9))
    let d = addAsset(s.contents.discussion, image).discussion
    s.ctx.tick()
    d = appendMessage(s.ctx, d, {
        threadId: mainThread(d).threadId,
        author: anna,
        content: richDoc(para({ type: 'image', attrs: { assetId: image.sha256 } }))
    }).discussion
    return { contents: { ...s.contents, discussion: d }, image }
}

describe('merge on import (ADR-003, Q-03)', () => {
    it('adds new messages and branches by ID, joins read marks, and the later stamp wins', () => {
        const s = buildSample()
        const base = s.contents
        const ctx = makeCtx('f')
        // the file: one more message, one more branch, a later title, more read marks
        let f = base.discussion
        f = appendMessage(ctx, f, {
            threadId: mainThread(f).threadId,
            author: boris,
            content: simple('из файла')
        }).discussion
        f = createBranch(ctx, f, {
            sourceMessageId: s.ids.mainMessages[0]!,
            quoteText: 'Привет',
            author: boris
        }).discussion
        f = setThreadTitle(ctx, f, s.ids.branch1, 'Из файла', boris.participantId)
        const file: DocumentContents = {
            ...base,
            discussion: f,
            readState: markMessageRead(
                f,
                base.readState,
                boris.participantId,
                s.ids.mainMessages[0]!
            )
        }
        // the library: its own new message and an earlier title change
        let l = setThreadTitle(
            s.ctx,
            base.discussion,
            s.ids.branch1,
            'В библиотеке',
            anna.participantId
        )
        l = appendMessage(s.ctx, l, {
            threadId: mainThread(l).threadId,
            author: anna,
            content: simple('из библиотеки')
        }).discussion
        const library: DocumentContents = { ...base, discussion: l }

        const r = mergeDiscussion(library, file)
        expect(r.changed).toBe(true)
        expect(r.addedMessages).toBe(1)
        expect(checkDiscussionIntegrity(r.contents.discussion)).toEqual([])
        expect(r.contents.discussion.threads).toHaveLength(base.discussion.threads.length + 1)
        const texts = mainThread(r.contents.discussion).messages.map(
            (m) => (m.content.content[0] as { content: Array<{ text: string }> }).content[0]!.text
        )
        expect(texts).toContain('из файла')
        expect(texts).toContain('из библиотеки')
        // both titles have stamps; the higher clock wins
        const title = r.contents.discussion.threads.find((t) => t.threadId === s.ids.branch1)!.title
        const fileClock = f.threads.find((t) => t.threadId === s.ids.branch1)!.titleSet!.clock
        const libClock = l.threads.find((t) => t.threadId === s.ids.branch1)!.titleSet!.clock
        expect(title).toBe(fileClock > libClock ? 'Из файла' : 'В библиотеке')
        expect(r.contents.readState[boris.participantId]).toEqual([s.ids.mainMessages[0]])

        // the same file again changes nothing
        const again = mergeDiscussion(r.contents, file)
        expect(again.changed).toBe(false)
        expect(again.contents).toBe(r.contents)
    })

    it('keeps the library value when the file has no stamp (schema version 1)', () => {
        const s = buildSample()
        const titled = setThreadTitle(
            s.ctx,
            s.contents.discussion,
            s.ids.branch1,
            'Своё',
            anna.participantId
        )
        const library = { ...s.contents, discussion: titled }
        const r = mergeDiscussion(library, s.contents)
        expect(r.changed).toBe(false)
        expect(r.contents.discussion.threads.find((t) => t.threadId === s.ids.branch1)!.title).toBe(
            'Своё'
        )
    })
})

describe('import and export (FR-203 to FR-205a)', () => {
    it('imports a file with an image, exports it again, and the export imports into a clean library unchanged', async () => {
        await withTempDir(async (dir) => {
            const { contents, image } = withImage()
            // the file name is the name of the discussion (the earlier storage showed the file name)
            const file = join(dir, 'Тест.branchchat')
            await writeDocument(file, contents, { discardExisting: true, newAssets: [image] })

            const lib = await libraryIn(join(dir, 'one'))
            const r = await lib.importFile(file)
            expect(r).toEqual({
                id: contents.manifest.documentId,
                status: 'created',
                addedMessages: count(contents)
            })
            const loaded = lib.repo.load(r.id)
            expect(plain(loaded.contents)).toEqual(plain(contents))
            expect(loaded.missingAssetIds).toEqual([])
            expect(await lib.importFile(file)).toMatchObject({
                status: 'unchanged',
                addedMessages: 0
            })

            const out = join(dir, 'out', 'Тест.branchchat')
            await mkdir(join(dir, 'out'))
            await lib.exportTo(loaded.contents, out)
            const back = await readDocument(out)
            expect(back.missingAssetIds).toEqual([])
            expect(plain(back.contents)).toEqual(plain(contents))

            const clean = await libraryIn(join(dir, 'two'))
            await clean.importFile(out)
            expect(plain(clean.repo.load(r.id).contents)).toEqual(plain(contents))
            expect(await clean.repo.readBlob(image.sha256)).toEqual(image.data)
        })
    })

    it('a new discussion takes the file name as its name', async () => {
        await withTempDir(async (dir) => {
            const s = buildSample()
            const file = join(dir, 'Отпуск 2026.branchchat')
            await writeDocument(file, s.contents, { discardExisting: true })
            const lib = await libraryIn(join(dir, 'lib'))
            const r = await lib.importFile(file)
            expect(lib.summary(r.id)?.title).toBe('Отпуск 2026')
            const other = await libraryIn(join(dir, 'other'))
            const kept = await other.importFile(file, { titleFromFileName: false })
            expect(other.summary(kept.id)?.title).toBe('Тест')
        })
    })

    it('merges a changed copy and reports the new messages', async () => {
        await withTempDir(async (dir) => {
            const s = buildSample()
            const lib = await libraryIn(join(dir, 'lib'))
            await lib.create(s.contents)
            s.ctx.tick()
            const d = appendMessage(s.ctx, s.contents.discussion, {
                threadId: mainThread(s.contents.discussion).threadId,
                author: boris,
                content: simple('новое в копии')
            }).discussion
            const file = join(dir, 'copy.branchchat')
            await writeDocument(file, { ...s.contents, discussion: d }, { discardExisting: true })
            expect(await lib.importFile(file)).toMatchObject({ status: 'merged', addedMessages: 1 })
            expect(count(lib.repo.load(s.contents.manifest.documentId).contents)).toBe(
                count(s.contents) + 1
            )
        })
    })

    it('refuses a file for a synchronized discussion; a file with a member list comes in as a normal discussion', async () => {
        await withTempDir(async (dir) => {
            const s = buildSample()
            const sync = { protocolVersion: 1, members: [] }
            const synced = normalizeSynced({ ...s.contents, sync, delivery: {} })
            const file = join(dir, 'shared.branchchat')
            await writeDocument(file, synced, { discardExisting: true })

            const plainLib = await libraryIn(join(dir, 'plain'))
            await plainLib.importFile(file)
            const imported = plainLib.repo.load(s.contents.manifest.documentId).contents
            expect(imported.sync).toBeUndefined()
            expect(imported.delivery).toBeUndefined()

            const syncedLib = await libraryIn(join(dir, 'synced'))
            await syncedLib.importFile(file, { keepSync: true })
            expect(syncedLib.repo.load(s.contents.manifest.documentId).contents.sync).toEqual(sync)
            expect(syncedLib.summary(s.contents.manifest.documentId)).toMatchObject({
                synced: true,
                conversationId: s.contents.manifest.documentId
            })
            await expect(syncedLib.importFile(file)).rejects.toMatchObject({
                code: 'SYNCED_IMPORT'
            })
        })
    })

    it('a synchronized discussion round-trips, and moveAside keeps a copy under a new ID', async () => {
        await withTempDir(async (dir) => {
            const s = buildSample()
            const synced = normalizeSynced({
                ...s.contents,
                sync: { protocolVersion: 1, members: [] },
                delivery: { [anna.participantId]: [s.ids.mainMessages[0]!] }
            })
            const lib = await libraryIn(dir)
            await lib.create(synced)
            expect(plain(lib.repo.load(s.contents.manifest.documentId).contents)).toEqual(
                plain(synced)
            )
            const newId = await lib.moveAside(s.contents.manifest.documentId)
            expect(lib.has(s.contents.manifest.documentId)).toBe(false)
            const moved = lib.repo.load(newId).contents
            expect(moved.sync).toBeUndefined()
            expect(count(moved)).toBe(count(synced))
        })
    })
})
