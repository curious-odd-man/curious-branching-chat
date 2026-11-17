import { afterEach, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeSynced } from '@shared/sync'
import { writeDocument } from '../../src/main/document'
import { Migration } from '../../src/main/library'
import { buildSample, withTempDir } from '../helpers/fixtures'
import { closeLibraries, libraryIn } from '../helpers/library'

afterEach(() => closeLibraries())

describe('migration of the discussion files of the earlier storage (FR-206)', () => {
    it('offers the recent and registered files, imports them, keeps the originals, and asks only once', async () => {
        await withTempDir(async (dir) => {
            const sample = buildSample()
            // buildSample gives the same IDs each time: the plain discussion gets its own
            const plain = {
                contents: {
                    ...sample.contents,
                    manifest: { ...sample.contents.manifest, documentId: 'doc-plain' }
                }
            }
            const shared = buildSample()
            const sharedContents = normalizeSynced({
                ...shared.contents,
                sync: { protocolVersion: 1, members: [] },
                delivery: {}
            })
            const fPlain = join(dir, 'Заметки.branchchat')
            const fShared = join(dir, 'Планы.branchchat')
            const fCopy = join(dir, 'Планы (копия).branchchat')
            const fGone = join(dir, 'Пропало.branchchat')
            await writeDocument(fPlain, plain.contents, { discardExisting: true })
            await writeDocument(fShared, sharedContents, { discardExisting: true })
            await writeDocument(fCopy, sharedContents, { discardExisting: true })
            const before = await readFile(fShared)

            const library = await libraryIn(join(dir, 'profile'))
            const logs: string[] = []
            const migration = new Migration({
                library,
                recent: () => [
                    { path: fCopy, openedAt: '' },
                    { path: fPlain, openedAt: '' },
                    { path: fGone, openedAt: '' },
                    { path: fShared, openedAt: '' }
                ],
                registry: () => [
                    {
                        conversationId: shared.contents.manifest.documentId,
                        filePath: fShared,
                        sharedRoot: '/shared',
                        ownId: 'p-anna'
                    }
                ],
                ownId: () => 'p-anna',
                log: (m) => logs.push(m)
            })
            const offered = await migration.candidates()
            expect(offered.map((c) => [c.name, c.exists, c.synced])).toEqual([
                ['Планы', true, true],
                ['Планы (копия)', true, false],
                ['Заметки', true, false],
                ['Пропало', false, false]
            ])

            // the copy comes first in the list, but the registered discussion is imported first
            const results = await migration.run([fCopy, fPlain, fShared])
            expect(results.map((r) => [r.name, r.status, r.synced, r.errorCode])).toEqual([
                ['Планы', 'imported', true, undefined],
                ['Планы (копия)', 'failed', false, 'SYNCED_IMPORT'],
                ['Заметки', 'imported', false, undefined]
            ])
            const synced = library.repo.load(shared.contents.manifest.documentId).contents
            expect(synced.sync).toEqual({ protocolVersion: 1, members: [] })
            expect(library.summary(plain.contents.manifest.documentId)?.title).toBe('Заметки')
            expect((await readFile(fShared)).equals(before)).toBe(true)
            expect(logs).toHaveLength(3)

            expect(migration.done).toBe(true)
            expect(await migration.candidates()).toEqual([])
        })
    })

    it('"Не переносить" is remembered; nothing to offer means no question', async () => {
        await withTempDir(async (dir) => {
            const library = await libraryIn(dir)
            const empty = new Migration({
                library,
                recent: () => [],
                registry: () => [],
                ownId: () => 'p'
            })
            expect(await empty.candidates()).toEqual([])
            const other = new Migration({
                library,
                recent: () => [{ path: join(dir, 'a.branchchat'), openedAt: '' }],
                registry: () => [],
                ownId: () => 'p'
            })
            expect(await other.candidates()).toHaveLength(1)
            other.skip()
            expect(await other.candidates()).toEqual([])
        })
    })
})
