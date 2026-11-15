import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { addAsset, appendMessage, mainThread } from '@shared/domain'
import { prepareImage } from '../../src/main/document'
import {
    BackupService,
    LibraryService,
    applyPendingRestore,
    openLibrary,
    type Library
} from '../../src/main/library'
import { startLibrary } from '../../src/main/application/libraryStartup'
import { anna, buildSample, pngBytes, simple, withTempDir } from '../helpers/fixtures'

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined }

async function withApp<T>(
    fn: (app: {
        dir: string
        lib: Library
        service: LibraryService
        clock: { t: number }
    }) => Promise<T>
): Promise<T> {
    return withTempDir(async (dir) => {
        const lib = await openLibrary(dir)
        try {
            return await fn({
                dir,
                lib,
                service: new LibraryService(lib),
                clock: { t: Date.UTC(2026, 10, 15, 9) }
            })
        } finally {
            lib.close()
        }
    })
}

describe('backups (FR-207, FR-208)', () => {
    it('backs up into both places, copies each image once, and keeps the last 7', async () => {
        await withApp(async ({ dir, lib, service, clock }) => {
            const s = buildSample()
            const image = prepareImage(pngBytes(1))
            await service.create(
                { ...s.contents, discussion: addAsset(s.contents.discussion, image).discussion },
                [image]
            )
            const folder = join(dir, 'cloud')
            const backups = new BackupService(lib, {
                appDir: dir,
                folder: () => folder,
                appVersion: '2.2.0',
                now: () => new Date(clock.t)
            })
            const first = await backups.make('manual')
            expect(first.folderError).toBeNull()
            expect(first.backups.map((b) => b.place)).toEqual(['app', 'folder'])
            expect(first.backups[0]).toMatchObject({
                discussions: 1,
                messages: 5,
                reason: 'manual'
            })
            const pooled = join(dir, 'backups', 'blobs', image.sha256.slice(0, 2), image.sha256)
            const firstCopy = (await fs.stat(pooled)).mtimeMs

            for (let i = 0; i < 8; i++) {
                clock.t += 3600_000
                await backups.make('daily')
            }
            expect((await fs.stat(pooled)).mtimeMs).toBe(firstCopy) // copied only once
            const list = await backups.list()
            expect(list.filter((b) => b.place === 'app')).toHaveLength(7)
            expect(list.filter((b) => b.place === 'folder')).toHaveLength(7)
            const app = list.filter((b) => b.place === 'app')
            expect(app[0]!.createdAt > app[1]!.createdAt).toBe(true)
            expect(backups.lastBackupAt()).toBe(new Date(clock.t).toISOString())
        })
    })

    it('makes the daily backup once per day', async () => {
        await withApp(async ({ dir, lib, clock }) => {
            const backups = new BackupService(lib, {
                appDir: dir,
                folder: () => null,
                appVersion: '2.2.0',
                now: () => new Date(clock.t)
            })
            expect(await backups.dailyIfDue()).toBe(true)
            clock.t += 3600_000
            expect(await backups.dailyIfDue()).toBe(false)
            clock.t += 24 * 3600_000
            expect(await backups.dailyIfDue()).toBe(true)
        })
    })

    it('a folder that cannot be written does not stop the backup in the app folder', async () => {
        await withApp(async ({ dir, lib }) => {
            const file = join(dir, 'not-a-folder')
            await fs.writeFile(file, 'x')
            const backups = new BackupService(lib, {
                appDir: dir,
                folder: () => file,
                appVersion: '2.2.0'
            })
            const r = await backups.make('manual')
            expect(r.backups).toHaveLength(1)
            expect(r.folderError).not.toBeNull()
        })
    })

    it('restores a backup at the next start; the current library is kept as a backup first', async () => {
        await withTempDir(async (dir) => {
            const s = buildSample()
            let lib = await openLibrary(dir)
            const service = new LibraryService(lib)
            await service.create(s.contents)
            const backups = new BackupService(lib, {
                appDir: dir,
                folder: () => null,
                appVersion: '2.2.0'
            })
            const [saved] = (await backups.make('manual')).backups
            // a change after the backup
            const store = service.store(s.contents.manifest.documentId)
            const { contents } = await store.load()
            await store.save({
                ...contents,
                discussion: appendMessage(s.ctx, contents.discussion, {
                    threadId: mainThread(contents.discussion).threadId,
                    author: anna,
                    content: simple('после копии')
                }).discussion
            })
            await backups.scheduleRestore(saved!.path)
            expect((await backups.list()).map((b) => b.reason)).toEqual(['restore', 'manual'])
            lib.close()

            expect(await applyPendingRestore(dir)).toBe(true)
            expect(await applyPendingRestore(dir)).toBe(false) // only once
            lib = await openLibrary(dir)
            expect(lib.repo.summary(s.contents.manifest.documentId)?.messageCount).toBe(5)
            lib.close()
        })
    })

    it('a damaged library is kept, and the newest backup takes its place after the question (FR-208)', async () => {
        await withTempDir(async (dir) => {
            const s = buildSample()
            const lib = await openLibrary(dir)
            await new LibraryService(lib).create(s.contents)
            await new BackupService(lib, {
                appDir: dir,
                folder: () => null,
                appVersion: '2.2.0'
            }).make('daily')
            lib.close()
            await fs.writeFile(join(dir, 'library.sqlite'), 'this is not a database')
            for (const suffix of ['-wal', '-shm'])
                await fs.rm(join(dir, `library.sqlite${suffix}`), { force: true })

            const asked: string[][] = []
            const restored = await startLibrary({
                appDir: dir,
                folder: () => null,
                appVersion: '2.2.0',
                ask: async (_m, _d, buttons) => {
                    asked.push(buttons)
                    return 0 // "Восстановить копию"
                },
                log: silent,
                formatDate: (iso) => iso
            })
            expect(asked).toEqual([['Восстановить копию', 'Начать с пустой библиотекой', 'Выход']])
            expect(restored?.repo.summary(s.contents.manifest.documentId)?.messageCount).toBe(5)
            restored?.close()
            const kept = (await fs.readdir(dir)).filter((n) => n.startsWith('library.damaged-'))
            expect(kept).toHaveLength(1)
            expect(await fs.readFile(join(dir, kept[0]!), 'utf8')).toBe('this is not a database')
        })
    })

    it('without a backup the person can start with an empty library or quit', async () => {
        await withTempDir(async (dir) => {
            await fs.writeFile(join(dir, 'library.sqlite'), 'garbage')
            const quit = await startLibrary({
                appDir: dir,
                folder: () => null,
                appVersion: '2.2.0',
                ask: async () => 1, // "Выход"
                log: silent,
                formatDate: (iso) => iso
            })
            expect(quit).toBeNull()
            expect(await fs.readFile(join(dir, 'library.sqlite'), 'utf8')).toBe('garbage') // untouched
            const empty = await startLibrary({
                appDir: dir,
                folder: () => null,
                appVersion: '2.2.0',
                ask: async () => 0, // "Начать с пустой библиотекой"
                log: silent,
                formatDate: (iso) => iso
            })
            expect(empty?.repo.list()).toEqual([])
            empty?.close()
        })
    })
})
