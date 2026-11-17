import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import type { Attachment, DocumentContents } from '@shared/validation'
import type { DiscussionListItem } from '@shared/types/ipc'
import { describeDiscussions } from '../application/recentView'
import { readDocument, readImageAsset, writeDocument } from '../document'
import { readEntryBuffer } from '../document/zip'
import { BlobStore } from './blobs'
import { Database } from './db'
import { DiscussionStore } from './discussionStore'
import { mergeDiscussion } from './merge'
import { LibraryRepository, type BlobRef, type DiscussionSummary } from './repository'
import { LibraryError, migrate } from './schema'

export const LIBRARY_FILE = 'library.sqlite'
export const BLOB_DIR = 'blobs'

/** The open library: one database file and the blob folder, in `dir` (%APPDATA%\BranchChat). */
export interface Library {
    readonly dir: string
    readonly db: Database
    readonly blobs: BlobStore
    readonly repo: LibraryRepository
    close(): void
}

export async function openLibrary(
    dir: string,
    options: { beforeMigration?: (db: Database, from: number) => Promise<void> } = {}
): Promise<Library> {
    await fs.mkdir(dir, { recursive: true })
    const db = new Database(join(dir, LIBRARY_FILE))
    try {
        await migrate(
            db,
            options.beforeMigration ? (from) => options.beforeMigration!(db, from) : undefined
        )
    } catch (err) {
        db.close()
        throw err
    }
    const blobs = new BlobStore(join(dir, BLOB_DIR))
    const repo = new LibraryRepository(db, blobs)
    return { dir, db, blobs, repo, close: () => db.close() }
}

export interface ImportResult {
    id: string
    /** created: new in the library; merged: the file added something; unchanged: nothing new. */
    status: 'created' | 'merged' | 'unchanged'
    addedMessages: number
}

export interface ImportOptions {
    /**
     * Keep the member list, delivery marks, and sync state of a synchronized discussion (the migration of the
     * registered files, FR-206; a joined invitation). Otherwise a file is imported as a normal discussion.
     */
    keepSync?: boolean
    /**
     * A new discussion takes the file name (without `.branchchat`) as its name, as release 1.x showed the file name
     * (default). Off for the snapshot of an invitation, whose file name is technical.
     */
    titleFromFileName?: boolean
}

/**
 * The library as the rest of the app uses it (ADR-003): discussions, import and export of `.branchchat` files. One
 * `DiscussionStore` per discussion, so a window and the sync engine never write past each other.
 */
export class LibraryService {
    private readonly stores = new Map<string, DiscussionStore>()
    private readonly listeners: Array<() => void> = []

    constructor(readonly lib: Library) {}

    get repo(): LibraryRepository {
        return this.lib.repo
    }

    store(id: string): DiscussionStore {
        let s = this.stores.get(id)
        if (!s)
            this.stores.set(id, (s = new DiscussionStore(this.lib.repo, id, () => this.changed())))
        return s
    }

    has(id: string): boolean {
        return this.lib.repo.has(id)
    }

    list(): DiscussionSummary[] {
        return this.lib.repo.list()
    }

    /** The list for the windows and menus: with unread counts for this participant and draft marks. */
    listItems(localId: string): DiscussionListItem[] {
        return describeDiscussions(
            this.lib.repo.list(),
            this.lib.repo.unreadCounts(localId),
            this.lib.repo.discussionsWithDrafts()
        )
    }

    summary(id: string): DiscussionSummary | null {
        return this.lib.repo.summary(id)
    }

    /** The list of discussions changed (a new one, an import, a removal). */
    onChange(listener: () => void): void {
        this.listeners.push(listener)
    }

    changed(): void {
        for (const l of this.listeners) l()
    }

    markOpened(id: string): void {
        this.lib.repo.markOpened(id)
        this.changed()
    }

    async create(contents: DocumentContents, assets: BlobRef[] = []): Promise<void> {
        await this.lib.repo.create(contents, assets)
        this.changed()
    }

    /**
     * Gives a discussion a new ID (the copy keeps its content, without the member list): used when a synchronized
     * discussion must take the ID of a normal copy that is already in the library. Returns the new ID.
     */
    async moveAside(id: string): Promise<string> {
        const store = this.store(id)
        if (store.hasOwner) throw new LibraryError('CONFLICT', 'The discussion is open.')
        const { contents } = await store.load()
        const { sync: _sync, delivery: _delivery, ...plain } = contents
        const newId = randomUUID()
        await this.lib.repo.create(
            { ...plain, manifest: { ...plain.manifest, documentId: newId } },
            []
        )
        this.lib.repo.remove(id)
        store.invalidate()
        this.stores.delete(id)
        this.changed()
        return newId
    }

    /**
     * Imports a `.branchchat` file (FR-203, FR-204): validated like any file, then added, or merged into the same
     * discussion of the library (ADR-003). A file is never merged into a synchronized discussion (FR-205a).
     */
    async importFile(path: string, options: ImportOptions = {}): Promise<ImportResult> {
        const loaded = await readDocument(path)
        const missing = new Set(loaded.missingAssetIds)
        for (const info of loaded.contents.discussion.assets) {
            if (await this.lib.blobs.has(info.sha256)) {
                this.lib.repo.registerBlob(info)
                continue
            }
            if (missing.has(info.assetId)) continue
            const data = await readImageAsset(path, info).catch(() => null)
            if (!data) continue
            await this.lib.blobs.put(info.sha256, data)
            this.lib.repo.registerBlob(info)
        }
        // FR-261 (schema version 3): attachments are ZIP entries `attachments/<sha256>`, checked like images
        for (const a of attachmentsOf(loaded.contents)) {
            if (await this.lib.blobs.has(a.sha256)) {
                this.lib.repo.registerBlob({ sha256: a.sha256, mediaType: a.type, size: a.size })
                continue
            }
            const data = await readEntryBuffer(path, attachmentEntry(a.sha256)).catch(() => null)
            if (!data || data.length !== a.size) continue
            try {
                await this.lib.blobs.put(a.sha256, data)
            } catch {
                continue // the bytes do not match the hash: the attachment shows as missing
            }
            this.lib.repo.registerBlob({ sha256: a.sha256, mediaType: a.type, size: a.size })
        }
        const incoming = options.keepSync ? loaded.contents : withoutSync(loaded.contents)
        const id = incoming.manifest.documentId
        if (!this.lib.repo.has(id)) {
            const name = basename(path)
                .replace(/\.branchchat$/i, '')
                .trim()
            const titled =
                options.titleFromFileName !== false && name && name !== incoming.discussion.title
                    ? { ...incoming, discussion: { ...incoming.discussion, title: name } }
                    : incoming
            await this.lib.repo.create(titled, [])
            this.changed()
            return { id, status: 'created', addedMessages: countMessages(incoming) }
        }
        const store = this.store(id)
        const current = await store.read()
        if (current.sync)
            throw new LibraryError(
                'SYNCED_IMPORT',
                'The discussion is synchronized; a file is not merged into it.'
            )
        let result: ReturnType<typeof mergeDiscussion> | null = null
        await store.update((contents) => {
            result = mergeDiscussion(contents, incoming)
            return result.changed ? { contents: result.contents, images: [] } : null
        })
        const r = result as ReturnType<typeof mergeDiscussion> | null
        if (r?.changed) this.changed()
        return {
            id,
            status: r?.changed ? 'merged' : 'unchanged',
            addedMessages: r?.addedMessages ?? 0
        }
    }

    /**
     * Writes a discussion as a `.branchchat` file (FR-204): images come from the blob files. Without `withSync`, the
     * member list and delivery marks are left out (a copy to send, FR-167).
     */
    async exportTo(
        contents: DocumentContents,
        target: string,
        options: { withSync?: boolean } = {}
    ): Promise<void> {
        const data = options.withSync ? contents : withoutSync(contents)
        const assetFiles: Array<{ path: string; file: string }> = []
        for (const a of data.discussion.assets)
            if (await this.lib.blobs.has(a.sha256))
                assetFiles.push({ path: a.path, file: this.lib.blobs.pathOf(a.sha256) })
        for (const a of attachmentsOf(data))
            if (await this.lib.blobs.has(a.sha256))
                assetFiles.push({
                    path: attachmentEntry(a.sha256),
                    file: this.lib.blobs.pathOf(a.sha256)
                })
        await writeDocument(target, data, { discardExisting: true, assetFiles })
    }

    /** The discussion as file bytes, with the member list and all images (the snapshot of an invitation). */
    async snapshot(contents: DocumentContents): Promise<Uint8Array> {
        const temp = join(this.lib.dir, 'temp')
        await fs.mkdir(temp, { recursive: true })
        const file = join(temp, `${randomUUID()}.branchchat`)
        try {
            await this.exportTo(contents, file, { withSync: true })
            return new Uint8Array(await fs.readFile(file))
        } finally {
            await fs.rm(file, { force: true }).catch(() => undefined)
        }
    }

    /**
     * FR-251: stores the draft of a branch. `images` are the images in the draft; bytes that are not in the library
     * yet (`data`) are stored first, so the draft can be sent after a restart. Null removes the draft.
     */
    saveDraft(
        id: string,
        threadId: string,
        content: string | null,
        images: BlobRef[] = [],
        attachments: Attachment[] = []
    ): Promise<void> {
        // in order: a late save of older text must not come after the removal of the draft
        const next = this.draftChain.then(() =>
            this.writeDraft(id, threadId, content, images, attachments)
        )
        this.draftChain = next.catch(() => undefined)
        return next
    }

    private draftChain: Promise<unknown> = Promise.resolve()

    private async writeDraft(
        id: string,
        threadId: string,
        content: string | null,
        images: BlobRef[],
        attachments: Attachment[]
    ): Promise<void> {
        const had = this.lib.repo.discussionsWithDrafts().has(id)
        if (content !== null)
            for (const image of images) {
                if (image.data) await this.lib.blobs.put(image.sha256, image.data)
                this.lib.repo.registerBlob(image)
            }
        this.lib.repo.setDraft(
            id,
            threadId,
            content,
            images.map((i) => i.sha256),
            attachments.filter((a) => this.lib.repo.hasBlob(a.sha256))
        )
        if (had !== this.lib.repo.discussionsWithDrafts().has(id)) this.changed()
    }

    /** The drafts of a discussion, with the bytes of their images (null when missing). */
    async drafts(id: string): Promise<
        Array<{
            threadId: string
            content: unknown
            images: Array<{ sha256: string; data: Buffer | null }>
            attachments: Attachment[]
        }>
    > {
        const out = []
        for (const d of this.lib.repo.drafts(id)) {
            const images = []
            for (const sha256 of d.images)
                images.push({ sha256, data: await this.lib.repo.readBlob(sha256) })
            let content: unknown
            try {
                content = JSON.parse(d.content)
            } catch {
                continue
            }
            out.push({ threadId: d.threadId, content, images, attachments: d.attachments })
        }
        return out
    }

    // ---- attachments (release 2.4) ---------------------------------------------------------------------------

    /** FR-261: stores a file to attach (streamed); refuses a file above `maxBytes` (code TOO_LARGE). */
    storeBlobFile(
        path: string,
        mediaType: string,
        maxBytes?: number
    ): Promise<{ sha256: string; size: number }> {
        return this.lib.repo.storeBlobFile(path, mediaType, maxBytes)
    }

    async storeBlobBytes(data: Uint8Array, mediaType: string): Promise<string> {
        const sha256 = createHash('sha256').update(data).digest('hex')
        await this.lib.repo.storeBlob(sha256, data, mediaType)
        return sha256
    }

    /** The file of stored bytes, or null when they are not in the library. */
    blobFile(sha256: string): string | null {
        return this.lib.repo.hasBlob(sha256) ? this.lib.repo.blobPath(sha256) : null
    }

    close(): void {
        this.lib.close()
    }
}

/** The ZIP entry of an attachment's bytes (schema version 3). */
export function attachmentEntry(sha256: string): string {
    return `attachments/${sha256}`
}

/** Each attachment of the discussion once (by hash, FR-266). */
export function attachmentsOf(contents: DocumentContents): Attachment[] {
    const out = new Map<string, Attachment>()
    for (const t of contents.discussion.threads)
        for (const m of t.messages)
            for (const a of m.attachments ?? []) if (!out.has(a.sha256)) out.set(a.sha256, a)
    return [...out.values()]
}

export function withoutSync(contents: DocumentContents): DocumentContents {
    const { sync: _sync, delivery: _delivery, ...plain } = contents
    return plain
}

function countMessages(c: DocumentContents): number {
    return c.discussion.threads.reduce((n, t) => n + t.messages.length, 0)
}

/**
 * FR-208: the check at start. `PRAGMA quick_check` must say "ok". Image rows whose file is missing are removed, so the
 * image shows as missing (a placeholder) instead of failing later; the count is returned for the log.
 */
export async function checkLibrary(
    lib: Library
): Promise<{ ok: boolean; problems: string[]; missingImages: number }> {
    const problems = lib.db.check().filter((p) => p !== 'ok')
    if (problems.length > 0) return { ok: false, problems, missingImages: 0 }
    let missingImages = 0
    for (const sha256 of lib.repo.usedBlobs())
        if (!(await lib.blobs.has(sha256))) {
            lib.db.prepare('DELETE FROM blob WHERE sha256 = ?').run(sha256)
            missingImages++
        }
    return { ok: true, problems: [], missingImages }
}
