import { messageSearchText, normalizeSearchText } from '@shared/domain'
import {
    type AssetInfo,
    type DiscussionData,
    type DocumentContents,
    type Message,
    type ReadState,
    type Thread
} from '@shared/validation'
import type { BlobStore } from './blobs'
import { BlobRows, type BlobRef } from './blobRows'
import { DraftRows } from './draftRows'
import { MetaRows } from './metaRows'
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

export type { BlobRef } from './blobRows'

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
    private readonly draftRows: DraftRows
    private readonly metaRows: MetaRows
    private readonly blobRows: BlobRows

    constructor(
        private readonly db: Database,
        blobs: BlobStore
    ) {
        this.draftRows = new DraftRows(db)
        this.metaRows = new MetaRows(db)
        this.blobRows = new BlobRows(db, blobs, () => this.draftRows.draftBlobs())
    }

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
        await this.blobRows.storeBlobs(newAssets)
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
            this.blobRows.registerBlobs(newAssets)
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
        await this.blobRows.storeBlobs(newAssets)
        return this.db.transaction(() => {
            const row = this.db.prepare('SELECT revision FROM discussion WHERE id = ?').get(id)
            if (!row) throw new LibraryError('NOT_FOUND', 'The discussion is not in the library.')
            if (Number(row.revision) !== expectedRevision)
                throw new LibraryError('CONFLICT', 'The discussion was changed by another writer.')
            this.blobRows.registerBlobs(newAssets)
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
                  WHERE m.author_id != ?
                    AND NOT EXISTS (SELECT 1 FROM mark k
                                     WHERE k.discussion_id = m.discussion_id AND k.kind = 0
                                       AND k.participant_id = ? AND k.message_id = m.message_id)
                  GROUP BY m.discussion_id`
            )
            // Plain "?" only: some node:sqlite versions do not bind numbered parameters ("?1").
            .all(localId, localId))
            out.set(String(r.id), Number(r.n))
        return out
    }

    // ---- drafts, meta values, and files: own classes; these methods keep the callers unchanged -----------------

    drafts(id: string): ReturnType<DraftRows['drafts']> {
        return this.draftRows.drafts(id)
    }

    setDraft(...args: Parameters<DraftRows['setDraft']>): void {
        this.draftRows.setDraft(...args)
    }

    discussionsWithDrafts(): Set<string> {
        return this.draftRows.discussionsWithDrafts()
    }

    draftBlobs(): Set<string> {
        return this.draftRows.draftBlobs()
    }

    getMeta(key: string): string | null {
        return this.metaRows.getMeta(key)
    }

    setMeta(key: string, value: string): void {
        this.metaRows.setMeta(key, value)
    }

    markOpened(id: string, at = new Date().toISOString()): void {
        this.db.prepare('UPDATE discussion SET opened_at = ? WHERE id = ?').run(at, id)
    }

    readBlob(sha256: string): Promise<Buffer | null> {
        return this.blobRows.readBlob(sha256)
    }

    usedBlobs(): Set<string> {
        return this.blobRows.usedBlobs()
    }

    removeUnusedBlobs(minAgeMs: number, now?: number): Promise<number> {
        return this.blobRows.removeUnusedBlobs(minAgeMs, now)
    }

    hasBlob(sha256: string): boolean {
        return this.blobRows.hasBlob(sha256)
    }

    blobSize(sha256: string): number | null {
        return this.blobRows.blobSize(sha256)
    }

    storeBlob(sha256: string, data: Uint8Array, mediaType: string): Promise<void> {
        return this.blobRows.storeBlob(sha256, data, mediaType)
    }

    storeBlobFile(
        path: string,
        mediaType: string,
        maxBytes?: number
    ): Promise<{ sha256: string; size: number }> {
        return this.blobRows.storeBlobFile(path, mediaType, maxBytes)
    }

    blobPath(sha256: string): string {
        return this.blobRows.blobPath(sha256)
    }

    registerBlob(a: BlobRef): void {
        this.blobRows.registerBlob(a)
    }

    // ---------------------------------------------------------------------------------------------------------------

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
                .run(Number(row.rowid), normalizeSearchText(messageSearchText(m)))
            const oldAttachments = old?.message.attachments
            if (oldAttachments !== m.attachments) this.writeAttachments(id, m)
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
            if (m.attachments)
                this.db
                    .prepare('DELETE FROM attachment WHERE discussion_id = ? AND message_id = ?')
                    .run(id, m.messageId)
        }
    }

    private writeAttachments(id: string, m: Message): void {
        this.db
            .prepare('DELETE FROM attachment WHERE discussion_id = ? AND message_id = ?')
            .run(id, m.messageId)
        ;(m.attachments ?? []).forEach((a, i) =>
            this.db
                .prepare(
                    'INSERT INTO attachment (discussion_id, message_id, ord, sha256) VALUES (?, ?, ?, ?)'
                )
                .run(id, m.messageId, i, a.sha256)
        )
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
