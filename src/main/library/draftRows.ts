import type { Attachment } from '@shared/validation'
import type { Database } from './db'

/** Drafts (FR-251 to FR-254): local only, never in an export (code review 4.3: one class per table group). */
export class DraftRows {
    constructor(
        private readonly db: Database,
        private readonly now: () => string = () => new Date().toISOString()
    ) {}

    drafts(id: string): Array<{
        threadId: string
        content: string
        images: string[]
        attachments: Attachment[]
        updatedAt: string
    }> {
        return this.db
            .prepare(
                'SELECT thread_id, content, images, attachments, updated_at FROM draft WHERE discussion_id = ?'
            )
            .all(id)
            .map((r) => ({
                threadId: String(r.thread_id),
                content: String(r.content),
                images: JSON.parse(String(r.images)) as string[],
                attachments: JSON.parse(String(r.attachments)) as Attachment[],
                updatedAt: String(r.updated_at)
            }))
    }

    /**
     * Stores or (with `content` null) removes the draft of a branch. `images` are the hashes of the draft's images,
     * `attachments` its files.
     */
    setDraft(
        id: string,
        threadId: string,
        content: string | null,
        images: string[] = [],
        attachments: Attachment[] = []
    ): void {
        if (content === null)
            this.db
                .prepare('DELETE FROM draft WHERE discussion_id = ? AND thread_id = ?')
                .run(id, threadId)
        else
            this.db
                .prepare(
                    `INSERT INTO draft (discussion_id, thread_id, content, images, attachments, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?)
                     ON CONFLICT (discussion_id, thread_id) DO UPDATE
                        SET content = excluded.content, images = excluded.images,
                            attachments = excluded.attachments, updated_at = excluded.updated_at`
                )
                .run(
                    id,
                    threadId,
                    content,
                    JSON.stringify(images),
                    JSON.stringify(attachments),
                    this.now()
                )
    }

    /** Discussions that have at least one draft (the mark in the list, FR-253). */
    discussionsWithDrafts(): Set<string> {
        return new Set(
            this.db
                .prepare('SELECT DISTINCT discussion_id FROM draft')
                .all()
                .map((r) => String(r.discussion_id))
        )
    }

    /** Image hashes that drafts use (kept by the cleanup of unused image files). */
    draftBlobs(): Set<string> {
        const out = new Set<string>()
        for (const r of this.db.prepare('SELECT images, attachments FROM draft').all()) {
            for (const h of JSON.parse(String(r.images)) as string[]) out.add(h)
            for (const a of JSON.parse(String(r.attachments)) as Attachment[]) out.add(a.sha256)
        }
        return out
    }
}
