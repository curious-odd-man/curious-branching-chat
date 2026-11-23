import { describe, expect, it } from 'vitest'
import { LibraryService, openLibrary } from '../../src/main/library'
import type { DiscussionOwner } from '../../src/main/library/discussionStore'
import { search } from '../../src/main/library/search'
import { anna, buildSample, withTempDir } from '../helpers/fixtures'

describe('library: delete a discussion (2026-11-23)', () => {
    it('removes the discussion with its drafts and search entries; others stay', async () => {
        await withTempDir(async (dir) => {
            const lib = await openLibrary(dir)
            try {
                const service = new LibraryService(lib)
                const a = buildSample()
                const b = buildSample()
                const idA = a.contents.manifest.documentId
                const idB = 'other-discussion'
                await service.create(a.contents)
                await service.create({
                    ...b.contents,
                    manifest: { ...b.contents.manifest, documentId: idB }
                })
                await service.saveDraft(idA, a.ids.branch1, '{"type":"doc","content":[]}')
                let changes = 0
                service.onChange(() => changes++)

                service.remove(idA)

                expect(service.has(idA)).toBe(false)
                expect(service.has(idB)).toBe(true)
                expect(lib.repo.discussionsWithDrafts().has(idA)).toBe(false)
                expect(new Set(search(lib.db, 'ёлку').map((h) => h.discussionId))).toEqual(
                    new Set([idB])
                )
                expect(service.listItems(anna.participantId).map((d) => d.id)).toEqual([idB])
                expect(changes).toBe(1)
            } finally {
                lib.close()
            }
        })
    })

    it('an open discussion cannot be removed', async () => {
        await withTempDir(async (dir) => {
            const lib = await openLibrary(dir)
            try {
                const service = new LibraryService(lib)
                const s = buildSample()
                const id = s.contents.manifest.documentId
                await service.create(s.contents)
                service.store(id).setOwner({} as DiscussionOwner)
                expect(() => service.remove(id)).toThrow(/open/)
                expect(service.has(id)).toBe(true)
            } finally {
                lib.close()
            }
        })
    })
})
