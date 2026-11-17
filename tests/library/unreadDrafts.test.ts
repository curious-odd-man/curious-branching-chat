import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { appendMessage, mainThread, markMessageRead } from '@shared/domain'
import { LibraryService, openLibrary } from '../../src/main/library'
import { Database } from '../../src/main/library/db'
import { anna, boris, buildSample, simple, withTempDir } from '../helpers/fixtures'

describe('library: unread counts, drafts, and schema migration', () => {
    it('counts unread messages of others per discussion (FR-221)', async () => {
        await withTempDir(async (dir) => {
            const lib = await openLibrary(dir)
            try {
                const service = new LibraryService(lib)
                const s = buildSample()
                await service.create(s.contents)
                const id = s.contents.manifest.documentId
                const all = s.contents.discussion.threads.flatMap((t) => t.messages)
                const fromOthers = all.filter((m) => m.authorId !== anna.participantId)
                expect(lib.repo.unreadCounts(anna.participantId).get(id)).toBe(fromOthers.length)

                const store = service.store(id)
                const { contents } = await store.load()
                await store.save({
                    ...contents,
                    readState: markMessageRead(
                        contents.discussion,
                        contents.readState,
                        anna.participantId,
                        fromOthers[0]!.messageId
                    )
                })
                expect(lib.repo.unreadCounts(anna.participantId).get(id) ?? 0).toBe(
                    fromOthers.length - 1
                )
                const item = service.listItems(anna.participantId)[0]!
                expect(item).toMatchObject({
                    id,
                    unreadCount: fromOthers.length - 1,
                    hasDraft: false
                })
            } finally {
                lib.close()
            }
        })
    })

    it('keeps drafts per branch, marks the discussion, and keeps their images from the cleanup (FR-251, FR-253)', async () => {
        await withTempDir(async (dir) => {
            const lib = await openLibrary(dir)
            try {
                const s = buildSample()
                await new LibraryService(lib).create(s.contents)
                const id = s.contents.manifest.documentId
                lib.repo.setDraft(id, s.ids.branch1, '{"type":"doc"}', ['a'.repeat(64)])
                expect(lib.repo.drafts(id)).toMatchObject([
                    { threadId: s.ids.branch1, images: ['a'.repeat(64)] }
                ])
                expect(lib.repo.discussionsWithDrafts()).toEqual(new Set([id]))
                expect(lib.repo.draftBlobs()).toEqual(new Set(['a'.repeat(64)]))
                lib.repo.setDraft(id, s.ids.branch1, null)
                expect(lib.repo.drafts(id)).toEqual([])
            } finally {
                lib.close()
            }
        })
    })

    it('migrates a library of schema 1 with a backup first', async () => {
        await withTempDir(async (dir) => {
            const first = await openLibrary(dir)
            const s = buildSample()
            const d = appendMessage(s.ctx, s.contents.discussion, {
                threadId: mainThread(s.contents.discussion).threadId,
                author: boris,
                content: simple('ещё')
            }).discussion
            await new LibraryService(first).create({ ...s.contents, discussion: d })
            first.close()
            // back to schema 1
            const db = new Database(join(dir, 'library.sqlite'))
            db.exec(`DROP TABLE attachment; DROP INDEX message_by_author; ALTER TABLE message DROP COLUMN author_id; DROP TABLE draft;
                     UPDATE meta SET value = '1' WHERE key = 'schema_version'`)
            db.close()

            const before: number[] = []
            const again = await openLibrary(dir, {
                beforeMigration: async (_db, from) => void before.push(from)
            })
            try {
                expect(before).toEqual([1])
                expect(
                    again.repo.load(s.contents.manifest.documentId).contents.manifest.schemaVersion
                ).toBe(3)
                const unread = again.repo
                    .unreadCounts(anna.participantId)
                    .get(s.contents.manifest.documentId)
                expect(unread).toBeGreaterThan(0)
                const authors = again.db
                    .prepare("SELECT count(*) AS n FROM message WHERE author_id = ''")
                    .get()!
                expect(authors.n).toBe(0)
            } finally {
                again.close()
            }
        })
    })
})
