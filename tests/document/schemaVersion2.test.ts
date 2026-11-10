import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appendMessage, mainThread, setThreadStatus, setThreadTitle } from '@shared/domain'
import type { DocumentContents } from '@shared/types'
import {
    CURRENT_SCHEMA_VERSION,
    checkDiscussionIntegrity,
    compareMessages,
    isLaterStamp,
    maxClock,
    nextClock,
    normalizeOrder,
    type SyncInfo
} from '@shared/validation'
import { DocumentError, readDocument, writeDocument } from '../../src/main/document'
import { migrate1to2 } from '../../src/main/document/migrations'
import { scanZip } from '../../src/main/document/zip'
import {
    anna,
    boris,
    buildSample,
    buildZip,
    makeCtx,
    simple,
    withTempDir
} from '../helpers/fixtures'

const key = 'A'.repeat(43) + '='
const roster: SyncInfo = {
    protocolVersion: 1,
    members: [
        {
            participantId: anna.participantId,
            displayName: anna.displayName,
            signingPublicKey: key,
            encryptionPublicKey: key,
            fingerprint: '0123456789ABCDEF0123456789ABCDEF',
            addedBy: anna.participantId,
            addedAt: '2026-11-10T10:00:00Z'
        }
    ]
}

/** The sample written the way version 1.0 wrote it: no clocks, schemaVersion 1. */
function asVersion1(c: DocumentContents): {
    manifest: string
    discussion: string
    readstate: string
} {
    const strip = <T extends object>(o: T): T => {
        const { clock: _c, statusSet: _s, titleSet: _t, ...rest } = o as Record<string, unknown>
        return rest as T
    }
    const discussion = {
        ...c.discussion,
        threads: c.discussion.threads.map((t) => ({ ...strip(t), messages: t.messages.map(strip) }))
    }
    return {
        manifest: JSON.stringify({ ...c.manifest, schemaVersion: 1 }),
        discussion: JSON.stringify(discussion),
        readstate: JSON.stringify(c.readState)
    }
}

async function entryNames(file: string): Promise<string[]> {
    const names: string[] = []
    await scanZip(file, async (e) => {
        names.push(e.fileName)
    })
    return names
}

describe('schema version 2 (FR-151 to FR-154)', () => {
    it('is the current version, and new documents use it', () => {
        expect(CURRENT_SCHEMA_VERSION).toBe(2)
        const { contents } = buildSample()
        expect(contents.manifest.schemaVersion).toBe(2)
        expect(mainThread(contents.discussion).clock).toBe(0)
        expect(checkDiscussionIntegrity(contents.discussion)).toEqual([])
    })

    it('gives each local change a clock above all others, so the order is the order of writing (FR-152)', () => {
        const { contents, ctx, ids } = buildSample()
        let d = contents.discussion
        const before = maxClock(d)
        const r = appendMessage(ctx, d, {
            threadId: mainThread(d).threadId,
            author: boris,
            content: simple('последнее')
        })
        d = r.discussion
        expect(r.message.clock).toBe(before + 1)
        const main = mainThread(d)
        expect(main.messages.at(-1)!.messageId).toBe(r.message.messageId)
        expect(main.messages.map((m) => m.sequence)).toEqual([0, 1, 2, 3])

        d = setThreadStatus(ctx, d, ids.branch1, 'closed', boris.participantId)
        const branch = d.threads.find((t) => t.threadId === ids.branch1)!
        expect(branch.statusSet).toEqual({ clock: before + 2, by: boris.participantId })
        d = setThreadTitle(ctx, d, ids.branch1, 'Ёлка', anna.participantId)
        expect(d.threads.find((t) => t.threadId === ids.branch1)!.titleSet).toEqual({
            clock: before + 3,
            by: anna.participantId
        })
        expect(nextClock(d)).toBe(before + 4)
        expect(checkDiscussionIntegrity(d)).toEqual([])
    })

    it('orders by (clock, author, id) and compares change stamps (FR-152, FR-153)', () => {
        const { contents } = buildSample()
        const [m1, m2] = mainThread(contents.discussion).messages
        const a = { ...m1!, clock: 5, authorId: 'b' }
        const b = { ...m2!, clock: 5, authorId: 'a' }
        expect(compareMessages(a, b)).toBeGreaterThan(0)
        expect(compareMessages({ ...a, clock: 4 }, b)).toBeLessThan(0)
        expect(isLaterStamp({ clock: 3, by: 'a' }, { clock: 2, by: 'z' })).toBe(true)
        expect(isLaterStamp({ clock: 3, by: 'b' }, { clock: 3, by: 'a' })).toBe(true)
        expect(isLaterStamp({ clock: 3, by: 'a' }, { clock: 3, by: 'a' })).toBe(false)
    })

    it('sorts messages by clock and recomputes sequence', () => {
        const { contents } = buildSample()
        const main = mainThread(contents.discussion)
        const shuffled = {
            ...contents.discussion,
            threads: contents.discussion.threads.map((t) =>
                t.threadId === main.threadId ? { ...t, messages: [...t.messages].reverse() } : t
            )
        }
        expect(checkDiscussionIntegrity(shuffled).join()).toMatch(/clock order/)
        const fixed = normalizeOrder(shuffled)
        expect(mainThread(fixed).messages.map((m) => m.messageId)).toEqual(
            main.messages.map((m) => m.messageId)
        )
        expect(checkDiscussionIntegrity(fixed)).toEqual([])
        expect(normalizeOrder(contents.discussion)).toBe(contents.discussion)
    })
})

describe('migration 1 -> 2 (FR-151)', () => {
    it('keeps the order and gives clocks: main thread 0, then one counter', () => {
        const { contents } = buildSample()
        const v1 = asVersion1(contents)
        const raw = migrate1to2({
            manifest: JSON.parse(v1.manifest),
            discussion: JSON.parse(v1.discussion),
            readState: {}
        })
        const threads = (raw.discussion as DocumentContents['discussion']).threads
        expect(threads[0]!.clock).toBe(0)
        const all = threads.flatMap((t) => [t.clock, ...t.messages.map((m) => m.clock)])
        expect(all.filter((c) => c > 0)).toEqual(
            [...all.filter((c) => c > 0)].sort((a, b) => a - b)
        )
        expect(new Set(all.filter((c) => c > 0)).size).toBe(all.length - 1)
    })

    it('opens a version 1 file with the same order and saves it as version 2', async () => {
        await withTempDir(async (dir) => {
            const { contents } = buildSample()
            const v1 = asVersion1(contents)
            const file = join(dir, 'old.branchchat')
            await fs.writeFile(
                file,
                await buildZip([
                    { name: 'manifest.json', data: v1.manifest },
                    { name: 'discussion.json', data: v1.discussion },
                    { name: 'readstate.json', data: v1.readstate }
                ])
            )
            const loaded = await readDocument(file)
            expect(loaded.contents.manifest.schemaVersion).toBe(2)
            const order = (c: DocumentContents) =>
                c.discussion.threads.map((t) => [t.threadId, t.messages.map((m) => m.messageId)])
            expect(order(loaded.contents)).toEqual(order(contents))
            // reading never changes the file (FR-012): it is still version 1 on disk
            const onDisk = JSON.parse(v1.manifest)
            expect(onDisk.schemaVersion).toBe(1)

            await writeDocument(file, loaded.contents)
            const again = await readDocument(file)
            expect(again.contents.manifest.schemaVersion).toBe(2)
            expect(order(again.contents)).toEqual(order(contents))
        })
    })

    it('refuses a version 2 file without clocks', async () => {
        await withTempDir(async (dir) => {
            const v1 = asVersion1(buildSample().contents)
            const file = join(dir, 'bad.branchchat')
            await fs.writeFile(
                file,
                await buildZip([
                    {
                        name: 'manifest.json',
                        data: v1.manifest.replace('"schemaVersion":1', '"schemaVersion":2')
                    },
                    { name: 'discussion.json', data: v1.discussion }
                ])
            )
            await expect(readDocument(file)).rejects.toBeInstanceOf(DocumentError)
        })
    })
})

describe('roster entry sync.json (FR-154)', () => {
    it('round-trips the roster, and leaves it out when absent', async () => {
        await withTempDir(async (dir) => {
            const { contents } = buildSample()
            const file = join(dir, 'shared.branchchat')
            await writeDocument(file, { ...contents, sync: roster }, { discardExisting: true })
            expect(await entryNames(file)).toContain('sync.json')
            const loaded = await readDocument(file)
            expect(loaded.contents.sync).toEqual(roster)

            // a copy without the roster (for "Отправить копию…", FR-167): the entry is not copied through
            const { sync: _drop, ...plain } = loaded.contents
            await writeDocument(file, plain)
            expect(await entryNames(file)).not.toContain('sync.json')
            expect((await readDocument(file)).contents.sync).toBeUndefined()
        })
    })

    it('refuses an inconsistent roster on read and on write', async () => {
        await withTempDir(async (dir) => {
            const { contents } = buildSample()
            const bad: SyncInfo = { ...roster, members: [...roster.members, roster.members[0]!] }
            await expect(
                writeDocument(
                    join(dir, 'x.branchchat'),
                    { ...contents, sync: bad },
                    { discardExisting: true }
                )
            ).rejects.toBeInstanceOf(DocumentError)

            const file = join(dir, 'y.branchchat')
            await fs.writeFile(
                file,
                await buildZip([
                    { name: 'manifest.json', data: JSON.stringify(contents.manifest) },
                    { name: 'discussion.json', data: JSON.stringify(contents.discussion) },
                    { name: 'sync.json', data: JSON.stringify(bad) }
                ])
            )
            await expect(readDocument(file)).rejects.toBeInstanceOf(DocumentError)
        })
    })

    it('keeps the roster through a local change (detached copy, FR-154)', async () => {
        await withTempDir(async (dir) => {
            const { contents } = buildSample()
            const ctx = makeCtx('x')
            const file = join(dir, 'detached.branchchat')
            await writeDocument(file, { ...contents, sync: roster }, { discardExisting: true })
            const loaded = (await readDocument(file)).contents
            const { discussion } = appendMessage(ctx, loaded.discussion, {
                threadId: mainThread(loaded.discussion).threadId,
                author: boris,
                content: simple('ещё')
            })
            await writeDocument(file, { ...loaded, discussion })
            expect((await readDocument(file)).contents.sync).toEqual(roster)
        })
    })
})
