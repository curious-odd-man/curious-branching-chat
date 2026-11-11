import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
    FolderTransport,
    MARKER_FILE,
    TransportError,
    isInside,
    type FileOps
} from '../../src/main/transport/folderTransport'
import { SyncRegistry } from '../../src/main/sync/registry'
import { SyncState, conversationDir } from '../../src/main/sync/syncState'
import { withTempDir } from '../helpers/fixtures'

const ID = '0f3c1a2b-1111-4222-8333-444455556666'
const inbox = (participantId: string) => ({ kind: 'inbox' as const, participantId })

async function setup(dir: string, ops?: FileOps) {
    const root = join(dir, 'shared')
    await fs.mkdir(root)
    return { root, t: new FolderTransport(root, join(dir, 'local', 'staging'), ops) }
}

async function allFiles(dir: string): Promise<string[]> {
    const out: string[] = []
    for (const e of await fs.readdir(dir, { withFileTypes: true, recursive: true }))
        if (e.isFile()) out.push(join(e.parentPath, e.name).slice(dir.length + 1))
    return out.sort()
}

describe('folder transport (sync-protocol.md 3, 3.4)', () => {
    it('creates the layout and the marker without temporary files in the shared folder', async () => {
        await withTempDir(async (dir) => {
            const { root, t } = await setup(dir)
            await t.ensureLayout('doc-1', 'p-anna')
            expect(await allFiles(root)).toEqual([MARKER_FILE])
            expect(await t.readMarker()).toEqual({
                format: 'branchchat-sync',
                protocolVersion: 1,
                conversationId: 'doc-1'
            })
            await expect(fs.stat(join(root, 'inbox', 'p-anna'))).resolves.toBeTruthy()
        })
    })

    it('publishes through the local staging folder: the shared folder only ever sees the final name (D-39)', async () => {
        await withTempDir(async (dir) => {
            const seen: string[][] = []
            let root = ''
            const ops: FileOps = {
                rename: async (from, to) => {
                    seen.push(await allFiles(root)) // what a reader could see just before the move
                    expect(from.startsWith(join(dir, 'local', 'staging'))).toBe(true)
                    await fs.rename(from, to)
                },
                copyFile: (a, b) => fs.copyFile(a, b)
            }
            const s = await setup(dir, ops)
            root = s.root
            await s.t.publish(inbox('p-boris'), `${ID}.bcmsg`, new Uint8Array([1, 2, 3]))
            expect(seen).toEqual([[]])
            expect(await allFiles(root)).toEqual([join('inbox', 'p-boris', `${ID}.bcmsg`)])
            expect(await fs.readdir(join(dir, 'local', 'staging'))).toEqual([])
        })
    })

    it('copies when the move crosses drives (EXDEV), and replaces an earlier copy', async () => {
        await withTempDir(async (dir) => {
            let copies = 0
            const ops: FileOps = {
                rename: async () => {
                    throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' })
                },
                copyFile: async (a, b) => {
                    copies++
                    await fs.copyFile(a, b)
                }
            }
            const { root, t } = await setup(dir, ops)
            await t.publish(inbox('p-boris'), `${ID}.bcmsg`, new Uint8Array([1]))
            await t.publish(inbox('p-boris'), `${ID}.bcmsg`, new Uint8Array([2, 2]))
            expect(copies).toBe(2)
            expect([...(await fs.readFile(join(root, 'inbox', 'p-boris', `${ID}.bcmsg`)))]).toEqual(
                [2, 2]
            )
            expect(await fs.readdir(join(dir, 'local', 'staging'))).toEqual([])
        })
    })

    it('lists only protocol files, also conflict copies', async () => {
        await withTempDir(async (dir) => {
            const { root, t } = await setup(dir)
            const folder = join(root, 'inbox', 'p-anna')
            await fs.mkdir(folder, { recursive: true })
            for (const name of [
                `${ID}.bcmsg`,
                `${ID} (1).bcmsg`,
                `${ID}.bcmsg.tmp`,
                'desktop.ini',
                '~$x.bcmsg',
                `${ID}.bcpart`
            ])
                await fs.writeFile(join(folder, name), 'x')
            const names = (await t.list(inbox('p-anna'))).map((e) => e.name).sort()
            expect(names).toEqual([`${ID} (1).bcmsg`, `${ID}.bcmsg`, `${ID}.bcpart`])
            expect(await t.list(inbox('p-nobody'))).toEqual([])
        })
    })

    it('refuses paths outside the shared folder, bad names, links, and staging inside the shared folder', async () => {
        await withTempDir(async (dir) => {
            const { root, t } = await setup(dir)
            for (const bad of ['..', '../x', 'a/b', '.', 'a\\b'])
                await expect(
                    t.publish(inbox(bad), `${ID}.bcmsg`, new Uint8Array())
                ).rejects.toBeInstanceOf(TransportError)
            await expect(
                t.publish(inbox('p-anna'), '../evil.bcmsg', new Uint8Array())
            ).rejects.toBeInstanceOf(TransportError)
            await expect(
                t.publish(inbox('p-anna'), 'notes.txt', new Uint8Array())
            ).rejects.toBeInstanceOf(TransportError)
            expect(() => new FolderTransport(root, join(root, 'staging'))).toThrow(TransportError)

            const outside = join(dir, 'outside')
            await fs.mkdir(outside)
            await fs.writeFile(join(outside, `${ID}.bcmsg`), 'secret')
            await fs.mkdir(join(root, 'inbox'), { recursive: true })
            await fs.symlink(outside, join(root, 'inbox', 'p-link'), 'dir')
            await expect(t.list(inbox('p-link'))).rejects.toBeInstanceOf(TransportError)
            await fs.mkdir(join(root, 'inbox', 'p-anna'), { recursive: true })
            await fs.symlink(
                join(outside, `${ID}.bcmsg`),
                join(root, 'inbox', 'p-anna', `${ID}.bcmsg`)
            )
            await expect(t.read(inbox('p-anna'), `${ID}.bcmsg`, 100)).rejects.toBeInstanceOf(
                TransportError
            )
            expect(await t.list(inbox('p-anna'))).toEqual([])
        })
    })

    it('refuses a file larger than the limit before reading it (FR-166)', async () => {
        await withTempDir(async (dir) => {
            const { t } = await setup(dir)
            await t.publish(inbox('p-anna'), `${ID}.bcmsg`, new Uint8Array(100))
            await expect(t.read(inbox('p-anna'), `${ID}.bcmsg`, 99)).rejects.toMatchObject({
                code: 'TOO_LARGE'
            })
            expect((await t.read(inbox('p-anna'), `${ID}.bcmsg`, 100)).length).toBe(100)
        })
    })

    it('reports delete results and cleans the staging folder', async () => {
        await withTempDir(async (dir) => {
            const { t } = await setup(dir)
            await t.publish(inbox('p-anna'), `${ID}.bcmsg`, new Uint8Array(1))
            expect(await t.delete(inbox('p-anna'), `${ID}.bcmsg`)).toBe('deleted')
            expect(await t.delete(inbox('p-anna'), `${ID}.bcmsg`)).toBe('missing')
            await fs.writeFile(join(t.staging, 'left-over.staging'), 'x')
            await t.cleanStaging()
            expect(await fs.readdir(t.staging)).toEqual([])
        })
    })

    it('runs the folder test and leaves nothing behind', async () => {
        await withTempDir(async (dir) => {
            const { root, t } = await setup(dir)
            expect(await t.folderTest()).toEqual({ ok: true })
            expect(await allFiles(root)).toEqual([])
            const missing = new FolderTransport(join(dir, 'nope'), join(dir, 'st'))
            expect(await missing.folderTest()).toMatchObject({ ok: false, step: 'root' })
        })
    })

    it('knows whether a path is inside the shared folder (FR-160)', () => {
        expect(isInside('/a/b', '/a/b/c.branchchat')).toBe(true)
        expect(isInside('/a/b', '/a/b')).toBe(true)
        expect(isInside('/a/b', '/a/bc/x')).toBe(false)
        expect(isInside('/a/b', '/a/x')).toBe(false)
    })
})

describe('local sync state and registry (design 18)', () => {
    it('keeps state, parts, and processed IDs across a restart', async () => {
        await withTempDir(async (dir) => {
            const folder = conversationDir(dir, 'doc-1')
            const s = await SyncState.open(folder, 'doc-1', 'p-anna', () => 1000)
            expect(s.nextSenderSeq()).toBe(1001)
            s.markProcessed('p-boris:e1')
            await s.storeInPart('p-boris', 'part-1', new Uint8Array([9]))
            await s.save()
            const again = await SyncState.open(folder, 'doc-1', 'p-anna')
            expect(again.nextSenderSeq()).toBe(1002)
            expect(again.isProcessed('p-boris:e1')).toBe(true)
            expect([...(await again.readInPart('p-boris', 'part-1'))!]).toEqual([9])
            expect(await again.readInPart('p-clara', 'part-1')).toBeNull()
            // another member on this computer, or another conversation, starts fresh
            expect((await SyncState.open(folder, 'doc-1', 'p-other', () => 5)).data.senderSeq).toBe(
                5
            )
            expect(() => conversationDir(dir, '../x')).toThrow()
        })
    })

    it('remembers which file and folder belong to a conversation (FR-168)', async () => {
        await withTempDir(async (dir) => {
            const r = new SyncRegistry(dir)
            await r.load()
            let changes = 0
            r.onChange(() => changes++)
            await r.put({
                conversationId: 'doc-1',
                filePath: '/a.branchchat',
                sharedRoot: '/s',
                ownId: 'p-anna'
            })
            await r.updatePath('doc-1', '/b.branchchat')
            const again = new SyncRegistry(dir)
            await again.load()
            expect(again.get('doc-1')?.filePath).toBe('/b.branchchat')
            expect(changes).toBe(2)
        })
    })
})
