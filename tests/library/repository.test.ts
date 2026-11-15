import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
    addAsset,
    appendMessage,
    createBranch,
    markMessageRead,
    setThreadStatus,
    setThreadTitle,
    type Author
} from '@shared/domain'
import type { DocumentContents } from '@shared/validation'
import { newDocumentContents, prepareImage } from '../../src/main/document'
import { BlobStore, LibraryError, openLibrary, type Library } from '../../src/main/library'
import { Database } from '../../src/main/library/db'
import {
    anna,
    boris,
    buildSample,
    makeCtx,
    pngBytes,
    simple,
    withTempDir
} from '../helpers/fixtures'

async function withLibrary<T>(fn: (lib: Library, dir: string) => Promise<T>): Promise<T> {
    return withTempDir(async (dir) => {
        const lib = await openLibrary(dir)
        try {
            return await fn(lib, dir)
        } finally {
            lib.close()
        }
    })
}

/** JSON form: what the library must give back (undefined fields are not stored). */
const plain = (c: DocumentContents): unknown => JSON.parse(JSON.stringify(c))

describe('library repository', () => {
    it('gives back a created discussion unchanged', async () => {
        await withLibrary(async (lib) => {
            const { contents } = buildSample()
            const c = { ...contents, readState: { [anna.participantId]: [], x: ['a', 'b'] } }
            await lib.repo.create(c)
            const loaded = lib.repo.load(c.manifest.documentId)
            expect(plain(loaded.contents)).toEqual(plain(c))
            expect(loaded.missingAssetIds).toEqual([])
            expect(loaded.revision).toBe(1)
            await expect(lib.repo.create(c)).rejects.toMatchObject({ code: 'EXISTS' })
        })
    })

    it('saves changes as a difference and keeps the list columns current', async () => {
        await withLibrary(async (lib) => {
            const s = buildSample()
            const id = s.contents.manifest.documentId
            let rev = await lib.repo.create(s.contents)
            let before = s.contents
            const step = async (after: DocumentContents): Promise<void> => {
                rev = await lib.repo.save(id, before, after, rev)
                expect(plain(lib.repo.load(id).contents)).toEqual(plain(after))
                before = after
            }
            const main = before.discussion.threads[0]!.threadId
            s.ctx.tick()
            const sent = appendMessage(s.ctx, before.discussion, {
                threadId: main,
                author: boris,
                content: simple('Новое')
            })
            await step({ ...before, discussion: sent.discussion })
            await step({
                ...before,
                readState: markMessageRead(
                    before.discussion,
                    before.readState,
                    anna.participantId,
                    sent.message.messageId
                )
            })
            await step({
                ...before,
                discussion: setThreadTitle(
                    s.ctx,
                    before.discussion,
                    s.ids.branch1,
                    'Ёлка',
                    anna.participantId
                )
            })
            await step({
                ...before,
                discussion: setThreadStatus(
                    s.ctx,
                    before.discussion,
                    s.ids.branch2,
                    'closed',
                    anna.participantId
                )
            })
            await step({ ...before, readState: {} })

            const summary = lib.repo.summary(id)!
            expect(summary.messageCount).toBe(6)
            expect(summary.lastMessageAt).toBe(sent.message.createdAt)
            expect(summary.synced).toBe(false)
            expect(lib.repo.list().map((d) => d.id)).toEqual([id])
            await expect(lib.repo.save(id, before, before, rev - 1)).rejects.toMatchObject({
                code: 'CONFLICT'
            })
        })
    })

    it('stores images as files by hash and reports missing ones', async () => {
        await withLibrary(async (lib, dir) => {
            const ctx = makeCtx()
            const c = newDocumentContents(ctx, { title: 'Картинки', author: anna })
            const img = prepareImage(pngBytes(1))
            const other = prepareImage(pngBytes(2))
            let d = addAsset(c.discussion, img).discussion
            d = addAsset(d, other).discussion
            await lib.repo.create({ ...c, discussion: d }, [img])
            const loaded = lib.repo.load(c.manifest.documentId)
            expect(loaded.missingAssetIds).toEqual([other.sha256])
            expect(await lib.repo.readBlob(img.sha256)).toEqual(img.data)
            const file = join(dir, 'blobs', img.sha256.slice(0, 2), img.sha256)
            expect((await fs.readFile(file)).equals(img.data)).toBe(true)

            // a damaged file reads as missing
            await fs.writeFile(file, Buffer.from('broken'))
            expect(await lib.repo.readBlob(img.sha256)).toBeNull()
        })
    })

    it('refuses bytes that do not match the hash', async () => {
        await withTempDir(async (dir) => {
            const blobs = new BlobStore(dir)
            const img = prepareImage(pngBytes(3))
            await expect(blobs.put(img.sha256, pngBytes(4))).rejects.toThrow()
            await blobs.put(img.sha256, img.data)
            await blobs.put(img.sha256, img.data)
            expect((await blobs.list()).map((b) => b.sha256)).toEqual([img.sha256])
        })
    })

    it('removes unused image files only after the minimum age', async () => {
        await withLibrary(async (lib) => {
            const ctx = makeCtx()
            const c = newDocumentContents(ctx, { title: 'x', author: anna })
            const used = prepareImage(pngBytes(5))
            const unused = prepareImage(pngBytes(6))
            await lib.repo.create({ ...c, discussion: addAsset(c.discussion, used).discussion }, [
                used,
                unused
            ])
            const week = 7 * 24 * 3600 * 1000
            expect(await lib.repo.removeUnusedBlobs(week)).toBe(0)
            expect(await lib.repo.removeUnusedBlobs(week, Date.now() + week + 1000)).toBe(1)
            expect(await lib.blobs.has(used.sha256)).toBe(true)
            expect(await lib.blobs.has(unused.sha256)).toBe(false)
        })
    })

    it('keeps a search index with normalized text', async () => {
        await withLibrary(async (lib) => {
            const s = buildSample()
            await lib.repo.create(s.contents)
            const hits = lib.db
                .prepare(
                    `SELECT m.message_id FROM search_index s JOIN message m ON m.rowid = s.rowid
                      WHERE search_index MATCH ? ORDER BY m.message_id`
                )
                .all('елку')
                .map((r) => r.message_id)
            expect(hits).toEqual([s.ids.mainMessages[1], s.ids.branch1Messages[0]].sort())
            lib.repo.remove(s.contents.manifest.documentId)
            expect(lib.db.prepare('SELECT count(*) n FROM search_index').get()!.n).toBe(0)
            expect(lib.repo.has(s.contents.manifest.documentId)).toBe(false)
        })
    })

    it('refuses a library of a newer app version', async () => {
        await withTempDir(async (dir) => {
            ;(await openLibrary(dir)).close()
            const db = new Database(join(dir, 'library.sqlite'))
            db.exec("UPDATE meta SET value = '99' WHERE key = 'schema_version'")
            db.close()
            await expect(openLibrary(dir)).rejects.toBeInstanceOf(LibraryError)
        })
    })

    it('stays equal to the domain model under random change sequences', async () => {
        await withLibrary(async (lib) => {
            let seed = 12345
            const rand = (n: number): number => {
                seed = (seed * 1103515245 + 12345) % 2 ** 31
                return seed % n
            }
            const ctx = makeCtx('r')
            const people: Author[] = [anna, boris]
            let c = newDocumentContents(ctx, { title: 'Свойства', author: anna })
            const id = c.manifest.documentId
            let rev = await lib.repo.create(c)
            for (let i = 0; i < 300; i++) {
                ctx.tick()
                const d = c.discussion
                const threads = d.threads.filter((t) => t.status === 'open')
                const all = d.threads.flatMap((t) => t.messages)
                let next: DocumentContents
                const op = rand(6)
                if (op <= 1 || all.length === 0) {
                    const t = threads[rand(threads.length)] ?? d.threads[0]!
                    if (t.status === 'closed') continue
                    const r = appendMessage(ctx, d, {
                        threadId: t.threadId,
                        author: people[rand(2)]!,
                        content: simple(`сообщение ${i} ёж`)
                    })
                    next = { ...c, discussion: r.discussion }
                } else if (op === 2) {
                    const m = all[rand(all.length)]!
                    next = {
                        ...c,
                        discussion: createBranch(ctx, d, {
                            sourceMessageId: m.messageId,
                            quoteText: 'ёж',
                            author: people[rand(2)]!
                        }).discussion
                    }
                } else if (op === 3) {
                    const m = all[rand(all.length)]!
                    const p = people[rand(2)]!.participantId
                    next = { ...c, readState: markMessageRead(d, c.readState, p, m.messageId) }
                } else if (op === 4 && d.threads.length > 1) {
                    const t = d.threads[1 + rand(d.threads.length - 1)]!
                    next = {
                        ...c,
                        discussion: setThreadStatus(
                            ctx,
                            d,
                            t.threadId,
                            t.status === 'open' ? 'closed' : 'open',
                            anna.participantId
                        )
                    }
                } else {
                    const img = prepareImage(pngBytes(100 + rand(5)))
                    const added = addAsset(d, img).discussion
                    rev = await lib.repo.save(id, c, { ...c, discussion: added }, rev, [img])
                    c = { ...c, discussion: added }
                    continue
                }
                rev = await lib.repo.save(id, c, next, rev)
                c = next
                if (i % 50 === 0) expect(plain(lib.repo.load(id).contents)).toEqual(plain(c))
            }
            expect(plain(lib.repo.load(id).contents)).toEqual(plain(c))
            expect(lib.db.check()).toEqual(['ok'])
        })
    })

    it('saves one message in a discussion of 20,000 messages in less than 0.1 s (NFR-202)', async () => {
        await withLibrary(async (lib) => {
            const ctx = makeCtx('p')
            let c = newDocumentContents(ctx, { title: 'Большое', author: anna })
            const main = c.discussion.threads[0]!.threadId
            let d = c.discussion
            for (let i = 0; i < 20_000; i++) {
                ctx.tick()
                d = appendMessage(ctx, d, {
                    threadId: main,
                    author: i % 2 ? anna : boris,
                    content: simple(`Сообщение номер ${i}`)
                }).discussion
            }
            c = { ...c, discussion: d }
            const id = c.manifest.documentId
            let rev = await lib.repo.create(c)
            const times: number[] = []
            for (let i = 0; i < 5; i++) {
                ctx.tick()
                const sent = appendMessage(ctx, c.discussion, {
                    threadId: main,
                    author: anna,
                    content: simple('ещё одно')
                })
                const after = {
                    ...c,
                    discussion: sent.discussion,
                    readState: markMessageRead(
                        sent.discussion,
                        c.readState,
                        anna.participantId,
                        sent.message.messageId
                    )
                }
                const t0 = performance.now()
                rev = await lib.repo.save(id, c, after, rev)
                times.push(performance.now() - t0)
                c = after
            }
            times.sort((a, b) => a - b)
            expect(times[2]!).toBeLessThan(100)
            expect(lib.repo.summary(id)!.messageCount).toBe(20_005)
        })
    }, 120_000)

    it('keeps the old or the new state when the process is killed in a transaction', async () => {
        await withTempDir(async (dir) => {
            const lib = await openLibrary(dir)
            const s = buildSample()
            const id = s.contents.manifest.documentId
            await lib.repo.create(s.contents)
            lib.close()

            const script = (commit: boolean): string => `
                const { DatabaseSync } = require('node:sqlite')
                const db = new DatabaseSync(${JSON.stringify(join(dir, 'library.sqlite'))})
                db.exec('PRAGMA journal_mode = WAL'); db.exec('PRAGMA synchronous = NORMAL')
                db.exec('BEGIN IMMEDIATE')
                db.prepare("UPDATE discussion SET title = 'новое' WHERE id = ?").run(${JSON.stringify(id)})
                db.exec("DELETE FROM message")
                ${commit ? "db.exec('COMMIT')" : ''}
                process.kill(process.pid, 'SIGKILL')`
            for (const commit of [false, true]) {
                spawnSync(process.execPath, ['--no-warnings', '-e', script(commit)])
                const again = await openLibrary(dir)
                try {
                    expect(again.db.check()).toEqual(['ok'])
                    const summary = again.repo.summary(id)!
                    expect(summary.title).toBe(commit ? 'новое' : 'Тест')
                    const n = again.db.prepare('SELECT count(*) n FROM message').get()!.n
                    expect(n).toBe(commit ? 0 : 5)
                } finally {
                    again.close()
                }
            }
        })
    })
})
