import { normalizeSearchText } from '@shared/domain'
import {
    richTextToPlain,
    type AssetInfo,
    type DiscussionData,
    type DocumentContents,
    type Message,
    type ReadState,
    type Thread
} from '@shared/validation'
import type { BlobStore } from './blobs'
import type { Database, Row } from './db'
import { LibraryError } from './schema'

/** One row of the discussion list (FR-221). */
export interface DiscussionSummary {
    id: string
    title: string
    createdAt: string
    updatedAt: string
    lastMessageAt: string | null
    messageCount: number
    synced: boolean
    conversationId: string | null
    openedAt: string | null
}

export interface LoadedDiscussion {
    contents: DocumentContents
    /** Images listed in the discussion whose bytes are not in the library (shown as placeholders). */
    missingAssetIds: string[]
    /** Pass to `save` to detect a change by another writer in between. */
    revision: number
}

/** An image for the library: with `data`, the bytes are stored first; without, the file must already be there. */
export interface BlobRef {
    sha256: string
    mediaType: string
    size: number
    data?: Uint8Array
}

interface MarkKeys {
    read: string[]
    delivery: string[] | null
}

const READ = 0
const DELIVERY = 1

/**
 * Discussions in the library database (ADR-003). The domain model stays `DocumentContents`: `load` builds it from the
 * rows, `save` writes the difference between two versions in one transaction. The difference uses object identity
 * first (the domain functions return new objects only for what they change), then IDs, so one new message writes a
 * few rows also in a discussion with 20,000 messages (NFR-202).
 */
export class LibraryRepository {
    constructor(
        private readonly db: Database,
        private readonly blobs: BlobStore
    ) {}

    has(id: string): boolean {
        return this.db.prepare('SELECT 1 FROM discussion WHERE id = ?').get(id) !== undefined
    }

    list(): DiscussionSummary[] {
        return this.db
            .prepare(
                `SELECT id, title, created_at, updated_at, last_message_at, message_count, synced, conversation_id,
                        opened_at
                   FROM discussion
                  ORDER BY COALESCE(last_message_at, created_at) DESC, id`
            )
            .all()
            .map(summaryOf)
    }

    summary(id: string): DiscussionSummary | null {
        const row = this.db
            .prepare(
                `SELECT id, title, created_at, updated_at, last_message_at, message_count, synced, conversation_id,
                        opened_at
                   FROM discussion WHERE id = ?`
            )
            .get(id)
        return row ? summaryOf(row) : null
    }

    /** The discussion that a synchronized conversation lives in, if any. */
    findByConversation(conversationId: string): string | null {
        const row = this.db
            .prepare('SELECT id FROM discussion WHERE conversation_id = ?')
            .get(conversationId)
        return row ? String(row.id) : null
    }

    load(id: string): LoadedDiscussion {
        const d = this.db.prepare('SELECT * FROM discussion WHERE id = ?').get(id)
        if (!d) throw new LibraryError('NOT_FOUND', 'The discussion is not in the library.')

        const head = JSON.parse(String(d.head)) as Omit<
            DiscussionData,
            'threads' | 'assets' | 'participants'
        >
        const participants = this.db
            .prepare('SELECT data FROM participant WHERE discussion_id = ? ORDER BY ord')
            .all(id)
            .map((r) => JSON.parse(String(r.data)) as DiscussionData['participants'][number])

        const messagesByThread = new Map<string, Message[]>()
        for (const r of this.db
            .prepare(
                'SELECT thread_id, data FROM message WHERE discussion_id = ? ORDER BY thread_id, ord'
            )
            .all(id)) {
            const key = String(r.thread_id)
            let list = messagesByThread.get(key)
            if (!list) messagesByThread.set(key, (list = []))
            list.push(JSON.parse(String(r.data)) as Message)
        }
        const threads = this.db
            .prepare('SELECT thread_id, data FROM thread WHERE discussion_id = ? ORDER BY ord')
            .all(id)
            .map(
                (r) =>
                    ({
                        ...(JSON.parse(String(r.data)) as Omit<Thread, 'messages'>),
                        messages: messagesByThread.get(String(r.thread_id)) ?? []
                    }) as Thread
            )

        const missingAssetIds: string[] = []
        const assets = this.db
            .prepare(
                `SELECT a.data, b.sha256 AS present FROM asset a LEFT JOIN blob b ON b.sha256 = a.sha256
                  WHERE a.discussion_id = ? ORDER BY a.ord`
            )
            .all(id)
            .map((r) => {
                const info = JSON.parse(String(r.data)) as AssetInfo
                if (r.present === null) missingAssetIds.push(info.assetId)
                return info
            })

        const keys = JSON.parse(String(d.mark_keys)) as MarkKeys
        const marks = this.loadMarks(id, d.sync !== null)
        const readState = marksOf(keys.read, marks.get(READ))
        const delivery = keys.delivery ? marksOf(keys.delivery, marks.get(DELIVERY)) : undefined

        const contents: DocumentContents = {
            manifest: JSON.parse(String(d.manifest)) as DocumentContents['manifest'],
            discussion: { ...head, participants, threads, assets } as DiscussionData,
            readState,
            ...(d.sync !== null
                ? { sync: JSON.parse(String(d.sync)) as DocumentContents['sync'] }
                : {}),
            ...(delivery ? { delivery } : {})
        }
        return { contents, missingAssetIds, revision: Number(d.revision) }
    }

    /** Adds a new discussion. Refused if the ID is in the library. Returns the revision. */
    async create(contents: DocumentContents, newAssets: BlobRef[] = []): Promise<number> {
        await this.storeBlobs(newAssets)
        return this.db.transaction(() => {
            const id = contents.manifest.documentId
            if (this.has(id))
                throw new LibraryError('EXISTS', 'The discussion is already in the library.')
            this.db
                .prepare(
                    `INSERT INTO discussion (id, schema_version, title, created_at, updated_at, manifest, head,
                                             mark_keys)
                     VALUES (?, ?, '', '', '', '{}', '{}', '{"read":[],"delivery":null}')`
                )
                .run(id, contents.manifest.schemaVersion)
            this.registerBlobs(newAssets)
            this.writeDiff(id, null, contents)
            return this.finish(id, contents, 0)
        })
    }

    /**
     * Writes the change from `before` (the last loaded or saved version) to `after` in one transaction. Image bytes are
     * stored first (ADR-003: the file before the row). `expectedRevision` protects against a lost change by another
     * writer; the new revision is returned.
     */
    async save(
        id: string,
        before: DocumentContents,
        after: DocumentContents,
        expectedRevision: number,
        newAssets: BlobRef[] = []
    ): Promise<number> {
        await this.storeBlobs(newAssets)
        return this.db.transaction(() => {
            const row = this.db.prepare('SELECT revision FROM discussion WHERE id = ?').get(id)
            if (!row) throw new LibraryError('NOT_FOUND', 'The discussion is not in the library.')
            if (Number(row.revision) !== expectedRevision)
                throw new LibraryError('CONFLICT', 'The discussion was changed by another writer.')
            this.registerBlobs(newAssets)
            this.writeDiff(id, before, after)
            return this.finish(id, after, expectedRevision)
        })
    }

    /** Removes a discussion (rows only; unused image files go at the next cleanup). */
    remove(id: string): void {
        this.db.transaction(() => {
            for (const r of this.db
                .prepare('SELECT rowid FROM message WHERE discussion_id = ?')
                .all(id))
                this.db.prepare('DELETE FROM search_index WHERE rowid = ?').run(Number(r.rowid))
            this.db.prepare('DELETE FROM discussion WHERE id = ?').run(id)
        })
    }

    /** FR-221: unread messages per discussion for this participant (not own messages, not in the read marks). */
    unreadCounts(localId: string): Map<string, number> {
        const out = new Map<string, number>()
        for (const r of this.db
            .prepare(
                `SELECT m.discussion_id AS id, count(*) AS n FROM message m
                  WHERE m.author_id != ?1
                    AND NOT EXISTS (SELECT 1 FROM mark k
                                     WHERE k.discussion_id = m.discussion_id AND k.kind = 0
                                       AND k.participant_id = ?1 AND k.message_id = m.message_id)
                  GROUP BY m.discussion_id`
            )
            .all(localId))
            out.set(String(r.id), Number(r.n))
        return out
    }

    // ---- drafts (FR-251 to FR-254): local only, never in an export ------------------------------------------------

    drafts(
        id: string
    ): Array<{ threadId: string; content: string; images: string[]; updatedAt: string }> {
        return this.db
            .prepare(
                'SELECT thread_id, content, images, updated_at FROM draft WHERE discussion_id = ?'
            )
            .all(id)
            .map((r) => ({
                threadId: String(r.thread_id),
                content: String(r.content),
                images: JSON.parse(String(r.images)) as string[],
                updatedAt: String(r.updated_at)
            }))
    }

    /** Stores or (with `content` null) removes the draft of a branch. */
    setDraft(id: string, threadId: string, content: string | null, images: string[] = []): void {
        if (content === null)
            this.db
                .prepare('DELETE FROM draft WHERE discussion_id = ? AND thread_id = ?')
                .run(id, threadId)
        else
            this.db
                .prepare(
                    `INSERT INTO draft (discussion_id, thread_id, content, images, updated_at) VALUES (?, ?, ?, ?, ?)
                     ON CONFLICT (discussion_id, thread_id) DO UPDATE
                        SET content = excluded.content, images = excluded.images, updated_at = excluded.updated_at`
                )
                .run(id, threadId, content, JSON.stringify(images), new Date().toISOString())
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
        for (const r of this.db.prepare('SELECT images FROM draft').all())
            for (const h of JSON.parse(String(r.images)) as string[]) out.add(h)
        return out
    }

    /** A value of the library itself (for example "the files of release 1.x were offered for migration"). */
    getMeta(key: string): string | null {
        const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key)
        return row ? String(row.value) : null
    }

    setMeta(key: string, value: string): void {
        this.db
            .prepare(
                'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
            )
            .run(key, value)
    }

    markOpened(id: string, at = new Date().toISOString()): void {
        this.db.prepare('UPDATE discussion SET opened_at = ? WHERE id = ?').run(at, id)
    }

    /** Image bytes by hash, checked; null when missing or damaged. */
    readBlob(sha256: string): Promise<Buffer | null> {
        return this.blobs.read(sha256)
    }

    /** Hashes that rows refer to (for the cleanup of unused files and for the integrity check). */
    usedBlobs(): Set<string> {
        return new Set(
            this.db
                .prepare('SELECT sha256 FROM blob')
                .all()
                .map((r) => String(r.sha256))
        )
    }

    /**
     * Deletes image files that no asset row uses and that are older than `minAgeMs` (ADR-003 Q-07: 7 days, so a file
     * written just before a crash or a restore can still be used). Returns the number of files removed.
     */
    async removeUnusedBlobs(minAgeMs: number, now = Date.now()): Promise<number> {
        const used = new Set(
            this.db
                .prepare('SELECT DISTINCT sha256 FROM asset')
                .all()
                .map((r) => String(r.sha256))
        )
        for (const h of this.draftBlobs()) used.add(h)
        let removed = 0
        for (const { sha256, modifiedMs } of await this.blobs.list()) {
            if (used.has(sha256) || now - modifiedMs < minAgeMs) continue
            this.db.prepare('DELETE FROM blob WHERE sha256 = ?').run(sha256)
            await this.blobs.remove(sha256)
            removed++
        }
        return removed
    }

    // ---------------------------------------------------------------------------------------------------------------

    private async storeBlobs(assets: BlobRef[]): Promise<void> {
        for (const a of assets) if (a.data) await this.blobs.put(a.sha256, a.data)
    }

    private registerBlobs(assets: BlobRef[]): void {
        for (const a of assets) this.registerBlob(a)
    }

    /** Records an image whose file is in the blob folder (the row comes after the file). */
    registerBlob(a: BlobRef): void {
        this.db
            .prepare('INSERT OR IGNORE INTO blob (sha256, media_type, size) VALUES (?, ?, ?)')
            .run(a.sha256, a.mediaType, a.size)
    }

    private loadMarks(id: string, sorted: boolean): Map<number, Map<string, string[]>> {
        const out = new Map<number, Map<string, string[]>>()
        for (const r of this.db
            .prepare(
                'SELECT kind, participant_id, message_id FROM mark WHERE discussion_id = ? ORDER BY kind, participant_id, ord'
            )
            .all(id)) {
            const kind = Number(r.kind)
            let byPerson = out.get(kind)
            if (!byPerson) out.set(kind, (byPerson = new Map()))
            const p = String(r.participant_id)
            let list = byPerson.get(p)
            if (!list) byPerson.set(p, (list = []))
            list.push(String(r.message_id))
        }
        if (sorted)
            for (const byPerson of out.values()) for (const list of byPerson.values()) list.sort()
        return out
    }

    /** Updates the discussion row (columns for the list, JSON parts, revision). */
    private finish(id: string, c: DocumentContents, revision: number): number {
        const { threads, assets, participants, ...head } = c.discussion
        void assets
        void participants
        let lastMessageAt: string | null = null
        let count = 0
        for (const t of threads)
            for (const m of t.messages) {
                count++
                if (lastMessageAt === null || m.createdAt > lastMessageAt)
                    lastMessageAt = m.createdAt
            }
        const keys: MarkKeys = {
            read: Object.keys(c.readState),
            delivery: c.delivery ? Object.keys(c.delivery) : null
        }
        this.db
            .prepare(
                `UPDATE discussion SET schema_version = ?, revision = ?, title = ?, created_at = ?, updated_at = ?,
                        last_message_at = ?, message_count = ?, synced = ?, conversation_id = ?, manifest = ?,
                        head = ?, sync = ?, mark_keys = ?
                  WHERE id = ?`
            )
            .run(
                c.manifest.schemaVersion,
                revision + 1,
                c.discussion.title,
                c.discussion.createdAt,
                c.discussion.updatedAt,
                lastMessageAt,
                count,
                c.sync ? 1 : 0,
                c.sync ? id : null,
                JSON.stringify(c.manifest),
                JSON.stringify(head),
                c.sync ? JSON.stringify(c.sync) : null,
                JSON.stringify(keys),
                id
            )
        return revision + 1
    }

    private writeDiff(id: string, before: DocumentContents | null, after: DocumentContents): void {
        const b = before?.discussion
        const a = after.discussion

        if (!b || b.participants !== a.participants) {
            this.db.prepare('DELETE FROM participant WHERE discussion_id = ?').run(id)
            a.participants.forEach((p, i) =>
                this.db
                    .prepare(
                        'INSERT INTO participant (discussion_id, participant_id, ord, data) VALUES (?, ?, ?, ?)'
                    )
                    .run(id, p.participantId, i, JSON.stringify(p))
            )
        }

        if (!b || b.assets !== a.assets) {
            this.db.prepare('DELETE FROM asset WHERE discussion_id = ?').run(id)
            a.assets.forEach((x, i) =>
                this.db
                    .prepare(
                        'INSERT INTO asset (discussion_id, asset_id, ord, sha256, data) VALUES (?, ?, ?, ?, ?)'
                    )
                    .run(id, x.assetId, i, x.sha256, JSON.stringify(x))
            )
        }

        if (!b || b.threads !== a.threads) this.writeThreads(id, b?.threads ?? [], a.threads)

        this.writeMarks(
            id,
            READ,
            before?.readState ?? {},
            after.readState,
            after.sync !== undefined
        )
        this.writeMarks(
            id,
            DELIVERY,
            before?.delivery ?? {},
            after.delivery ?? {},
            after.sync !== undefined
        )
    }

    private writeThreads(id: string, before: Thread[], after: Thread[]): void {
        const beforeById = new Map<string, { thread: Thread; index: number }>()
        before.forEach((t, index) => beforeById.set(t.threadId, { thread: t, index }))
        const seen = new Set<string>()

        after.forEach((t, index) => {
            seen.add(t.threadId)
            const old = beforeById.get(t.threadId)
            if (old && old.thread === t) {
                if (old.index !== index)
                    this.db
                        .prepare(
                            'UPDATE thread SET ord = ? WHERE discussion_id = ? AND thread_id = ?'
                        )
                        .run(index, id, t.threadId)
                return
            }
            const { messages, ...data } = t
            this.db
                .prepare(
                    `INSERT INTO thread (discussion_id, thread_id, ord, data) VALUES (?, ?, ?, ?)
                     ON CONFLICT (discussion_id, thread_id) DO UPDATE SET ord = excluded.ord, data = excluded.data`
                )
                .run(id, t.threadId, index, JSON.stringify(data))
            if (!old || old.thread.messages !== messages)
                this.writeMessages(id, old?.thread.messages ?? [], messages)
        })

        for (const [threadId, old] of beforeById) {
            if (seen.has(threadId)) continue
            this.deleteMessages(id, old.thread.messages, new Set())
            this.db
                .prepare('DELETE FROM thread WHERE discussion_id = ? AND thread_id = ?')
                .run(id, threadId)
        }
    }

    private writeMessages(id: string, before: Message[], after: Message[]): void {
        let beforePos: Map<string, { message: Message; index: number }> | null = null
        const positions = (): Map<string, { message: Message; index: number }> => {
            if (!beforePos) {
                beforePos = new Map()
                before.forEach((message, index) =>
                    beforePos!.set(message.messageId, { message, index })
                )
            }
            return beforePos
        }
        let changed = before.length !== after.length

        after.forEach((m, index) => {
            if (before[index] === m) return
            changed = true
            const old = positions().get(m.messageId)
            if (old && old.message === m) {
                this.db
                    .prepare(
                        'UPDATE message SET ord = ? WHERE discussion_id = ? AND message_id = ?'
                    )
                    .run(index, id, m.messageId)
                return
            }
            const row = this.db
                .prepare(
                    `INSERT INTO message (discussion_id, message_id, thread_id, ord, created_at, data, author_id)
                     VALUES (?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT (discussion_id, message_id) DO UPDATE
                        SET thread_id = excluded.thread_id, ord = excluded.ord, created_at = excluded.created_at,
                            author_id = excluded.author_id,
                            data = excluded.data
                     RETURNING rowid`
                )
                .get(
                    id,
                    m.messageId,
                    m.threadId,
                    index,
                    m.createdAt,
                    JSON.stringify(m),
                    m.authorId
                )!
            this.db.prepare('DELETE FROM search_index WHERE rowid = ?').run(Number(row.rowid))
            this.db
                .prepare('INSERT INTO search_index (rowid, text) VALUES (?, ?)')
                .run(Number(row.rowid), normalizeSearchText(richTextToPlain(m.content)))
        })

        if (changed && before.length > 0)
            this.deleteMessages(id, before, new Set(after.map((m) => m.messageId)))
    }

    private deleteMessages(id: string, list: Message[], keep: Set<string>): void {
        for (const m of list) {
            if (keep.has(m.messageId)) continue
            const row = this.db
                .prepare(
                    'DELETE FROM message WHERE discussion_id = ? AND message_id = ? RETURNING rowid'
                )
                .get(id, m.messageId)
            if (row)
                this.db.prepare('DELETE FROM search_index WHERE rowid = ?').run(Number(row.rowid))
        }
    }

    private writeMarks(
        id: string,
        kind: number,
        before: ReadState,
        after: ReadState,
        sortedLists: boolean
    ): void {
        if (before === after) return
        const insert = (p: string, ids: string[], from: number): void => {
            for (let i = from; i < ids.length; i++)
                this.db
                    .prepare(
                        'INSERT OR IGNORE INTO mark (discussion_id, kind, participant_id, message_id, ord) VALUES (?, ?, ?, ?, ?)'
                    )
                    .run(id, kind, p, ids[i]!, i)
        }
        for (const [p, ids] of Object.entries(after)) {
            const old = before[p]
            if (old === ids) continue
            if (old && isPrefix(old, ids)) {
                insert(p, ids, old.length)
                continue
            }
            if (old && sortedLists) {
                // synchronized: the lists are sorted (normalizeSynced), so the order comes from the IDs on load
                const now = new Set(ids)
                const was = new Set(old)
                for (const m of old)
                    if (!now.has(m))
                        this.db
                            .prepare(
                                'DELETE FROM mark WHERE discussion_id = ? AND kind = ? AND participant_id = ? AND message_id = ?'
                            )
                            .run(id, kind, p, m)
                ids.forEach((m, i) => {
                    if (!was.has(m))
                        this.db
                            .prepare(
                                'INSERT OR IGNORE INTO mark (discussion_id, kind, participant_id, message_id, ord) VALUES (?, ?, ?, ?, ?)'
                            )
                            .run(id, kind, p, m, i)
                })
                continue
            }
            if (old)
                this.db
                    .prepare(
                        'DELETE FROM mark WHERE discussion_id = ? AND kind = ? AND participant_id = ?'
                    )
                    .run(id, kind, p)
            insert(p, ids, 0)
        }
        for (const p of Object.keys(before))
            if (!(p in after))
                this.db
                    .prepare(
                        'DELETE FROM mark WHERE discussion_id = ? AND kind = ? AND participant_id = ?'
                    )
                    .run(id, kind, p)
    }
}

function isPrefix(prefix: string[], list: string[]): boolean {
    if (prefix.length > list.length) return false
    for (let i = 0; i < prefix.length; i++) if (prefix[i] !== list[i]) return false
    return true
}

function marksOf(keys: string[], byPerson: Map<string, string[]> | undefined): ReadState {
    const out: ReadState = {}
    for (const k of keys) out[k] = byPerson?.get(k) ?? []
    return out
}

function summaryOf(r: Row): DiscussionSummary {
    return {
        id: String(r.id),
        title: String(r.title),
        createdAt: String(r.created_at),
        updatedAt: String(r.updated_at),
        lastMessageAt: r.last_message_at === null ? null : String(r.last_message_at),
        messageCount: Number(r.message_count),
        synced: Number(r.synced) === 1,
        conversationId: r.conversation_id === null ? null : String(r.conversation_id),
        openedAt: r.opened_at === null ? null : String(r.opened_at)
    }
}
