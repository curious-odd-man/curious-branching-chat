import { randomUUID } from 'node:crypto'
import {
    appendMessage,
    addAsset,
    createBranch,
    DomainError,
    ensureParticipant,
    findMessage,
    markAllRead,
    markMessageRead,
    markThreadRead,
    unreadSummary,
    quoteFromSelection,
    readStateAfterBranch,
    readStateAfterSend,
    setThreadStatus,
    setThreadTitle,
    type Author,
    type DomainContext
} from '@shared/domain'
import {
    knownParticipants,
    normalizeSynced,
    withLocalDisplayName,
    type LoadingMessage
} from '@shared/sync'
import type { ReadState, ThreadStatus } from '@shared/validation'
import { collectImageAssetIds, type RichDoc } from '@shared/validation'
import type { StagedImage } from '@shared/types/assets'
import type { DocumentContents } from '@shared/validation'
import type { DocumentView } from '@shared/types/ipc'
import { describeError } from '@shared/i18n/ru'
import type { AssetInfo } from '@shared/validation'
import { DocumentError, newDocumentContents, prepareImage, type PreparedImage } from '../document'
import type { BlobRef, DiscussionChange, DiscussionOwner } from '../library'
import { LibraryError } from '../library/schema'

/** Where a session keeps its discussion: a `DiscussionStore` of the library (tests can wrap one). */
export interface SessionStore {
    readonly id: string
    save(after: DocumentContents, newAssets: BlobRef[]): Promise<void>
    readAsset(info: AssetInfo): Promise<Buffer | null>
    setOwner(owner: DiscussionOwner | null): void
}

/** What a caller is about to do, to find out beforehand whether it will change the person's read state. */
export type ReadAction =
    | { type: 'send'; threadId: string }
    | { type: 'branch'; messageId: string }
    | { type: 'message'; messageId: string }
    | { type: 'thread'; threadId: string }
    | { type: 'all' }

export interface SessionDeps {
    ctx: DomainContext
}

/**
 * One open discussion: the in-memory state plus a serialized, coalescing save queue (FR-007).
 *
 * Changes appear immediately; every change is then saved to the library (a small transaction, ADR-003). Several quick
 * changes are saved together. If a save fails, the changes stay in memory, `saveError` is set, and the next change or
 * `retrySave()` tries again (FR-008).
 */
export class DocumentSession implements DiscussionOwner {
    /** Called whenever the discussion or the save state changes because of a change made by the person. */
    onChange: () => void = () => undefined
    /** Called when only the save status changed (a write finished); the discussion itself is unchanged. */
    onStatusChange: () => void = () => undefined
    notices: string[] = []

    private writeChain: Promise<void> = Promise.resolve()
    private scheduled = false
    private running = false
    private _saveError: string | null = null
    /** Identifies this open discussion in image URLs (see src/shared/types/assets.ts). */
    readonly sessionId = randomUUID()
    /** Images added to a draft. They are kept in memory only; nothing is written until a message uses them. */
    private readonly staged = new Map<string, PreparedImage>()
    /** Images used by sent messages but not yet saved in the library. */
    private pendingAssets: Array<BlobRef & { data: Buffer }> = []
    /**
     * Set by the sync service when this window shows the registered copy of a synchronized discussion: called after
     * every local change with the discussion before and after it (design section 10). Null for every other file.
     */
    syncHook: ((before: DocumentContents, after: DocumentContents) => void) | null = null
    /** Messages that are still loading (set by the sync service, D-37). */
    loading: LoadingMessage[] = []
    /** Delivery of own messages and sync health (set by the sync service, FR-169, FR-172). */
    copies: DocumentView['copies'] = {}
    syncStatus: DocumentView['syncStatus'] = null

    private constructor(
        readonly store: SessionStore,
        private contents: DocumentContents,
        private readonly missingAssetIds: string[],
        private readonly deps: SessionDeps
    ) {
        store.setOwner(this)
    }

    /** Opens a discussion of the library. */
    static open(
        store: SessionStore,
        loaded: { contents: DocumentContents; missingAssetIds: string[] },
        deps: SessionDeps
    ): DocumentSession {
        return new DocumentSession(store, loaded.contents, loaded.missingAssetIds, deps)
    }

    /** The contents of a brand-new discussion (requirements 4.1); the caller adds it to the library. */
    static newContents(
        deps: SessionDeps,
        input: { author: Author; title: string; generator?: { name: string; version: string } }
    ): DocumentContents {
        return newDocumentContents(deps.ctx, {
            title: input.title,
            author: input.author,
            ...(input.generator ? { generator: input.generator } : {})
        })
    }

    /** The window closed: changes from now on go to the library directly (the sync engine). */
    async close(): Promise<void> {
        await this.flush()
        this.store.setOwner(null)
    }

    get documentId(): string {
        return this.contents.manifest.documentId
    }
    /** The current discussion (read by the sync service). */
    get current(): DocumentContents {
        return this.contents
    }
    get synced(): boolean {
        return this.syncHook !== null
    }

    /**
     * Applies remote events (design section 10): in the same write queue as local changes, so a local save never
     * overwrites a remote change. `images` are bytes of images that the change registers. No events are sent.
     */
    applyRemote(change: DiscussionChange): void {
        const r = change(this.contents)
        if (!r) return
        for (const image of r.images) {
            const info = r.contents.discussion.assets.find((a) => a.assetId === image.assetId)
            if (!info || this.pendingAssets.some((a) => a.sha256 === image.assetId)) continue
            this.pendingAssets.push({
                data: Buffer.from(image.data),
                sha256: info.sha256,
                size: info.size,
                mediaType: info.mediaType
            })
        }
        this.contents = r.contents
        this.scheduleSave()
        this.onChange()
    }

    /**
     * "Сделать обсуждение общим…" (D-02): the discussion gets its roster. Called before the session is attached, so
     * the existing history is not sent as events; it travels inside the invitations.
     */
    adoptSync(sync: NonNullable<DocumentContents['sync']>): DocumentContents {
        this.commit(normalizeSynced({ ...this.contents, sync }))
        return this.contents
    }

    /** The person's name changed in Settings: in a synchronized discussion it becomes `profile.updated` (D-12). */
    renameLocal(author: Author): void {
        if (!this.syncHook) return
        const next = withLocalDisplayName(this.contents, author.participantId, author.displayName)
        if (next !== this.contents) this.commit(next)
    }

    get saveError(): string | null {
        return this._saveError
    }
    get saving(): boolean {
        return this.scheduled || this.running
    }
    /** The name of the discussion (window title, lists). */
    get title(): string {
        return this.contents.discussion.title
    }

    /**
     * Adds image bytes to the draft (FR-065 to FR-067). Only PNG, JPEG, GIF and WebP are accepted (FR-116); there is no
     * size limit (NFR-015). The image is stored in the library only when a message containing it is sent; one that is
     * never sent leaves no trace. Identical images are the same asset (deduplicated by checksum).
     */
    stageImage(data: Buffer): StagedImage {
        const image = prepareImage(data)
        if (!this.staged.has(image.sha256)) this.staged.set(image.sha256, image)
        return { assetId: image.sha256, mediaType: image.mediaType, size: image.size }
    }

    /** An image of the draft that is only in memory (not sent yet), for a draft kept in the library (FR-251). */
    stagedImage(sha256: string): PreparedImage | undefined {
        return this.staged.get(sha256)
    }

    /** True if the discussion registers this image already (it was sent before). */
    hasAsset(assetId: string): boolean {
        return this.contents.discussion.assets.some((a) => a.assetId === assetId)
    }

    /**
     * Bytes of an embedded image, for display (FR-068). Images that are not saved yet come from memory; the others are
     * read from the library and checked against their recorded type and checksum. Null means "show a placeholder"
     * (FR-075): the data is missing, damaged, or does not match.
     */
    async readAssetBytes(assetId: string): Promise<{ data: Buffer; mediaType: string } | null> {
        const memory =
            this.pendingAssets.find((a) => a.sha256 === assetId) ?? this.staged.get(assetId)
        if (memory) return { data: memory.data, mediaType: memory.mediaType }
        const info = this.contents.discussion.assets.find((a) => a.assetId === assetId)
        if (!info) return null
        const data = await this.store.readAsset(info).catch(() => null)
        return data ? { data, mediaType: info.mediaType } : null
    }

    /** FR-112 (1): writing in a thread also marks that thread's earlier messages as read. */
    appendMessage(author: Author, threadId: string, content: RichDoc): void {
        const before = this.contents.discussion
        const readState = readStateAfterSend(
            before,
            this.contents.readState,
            author.participantId,
            threadId
        )
        // Images used for the first time are registered now, and their bytes queued for the next save.
        let withAssets = before
        const added: PreparedImage[] = []
        for (const assetId of collectImageAssetIds(content)) {
            if (withAssets.assets.some((a) => a.assetId === assetId)) continue
            const image = this.staged.get(assetId)
            if (!image)
                throw new DomainError(
                    'UNKNOWN_ASSET',
                    `image ${assetId} was not added to the draft`
                )
            withAssets = addAsset(withAssets, {
                path: image.path,
                mediaType: image.mediaType,
                size: image.size,
                sha256: image.sha256
            }).discussion
            added.push(image)
        }
        const { discussion } = appendMessage(this.deps.ctx, withAssets, {
            threadId,
            author,
            content
        })
        this.pendingAssets.push(
            ...added.map((a) => ({
                data: a.data,
                sha256: a.sha256,
                size: a.size,
                mediaType: a.mediaType
            }))
        )
        this.commit({ ...this.contents, discussion, readState })
    }

    /**
     * "Reply to this" (FR-049 to FR-056, FR-112 case 2): creates a branch from a selected passage of a message and
     * marks that message as read. The quote is taken from the stored message, not from the caller. Returns the new
     * branch's ID.
     */
    createBranch(
        author: Author,
        input: { sourceMessageId: string; selectionStart: number; selectionEnd: number }
    ): string {
        const before = this.contents.discussion
        const { message } = findMessage(before, input.sourceMessageId)
        const quoteText = quoteFromSelection(message, input.selectionStart, input.selectionEnd)
        const readState = readStateAfterBranch(
            before,
            this.contents.readState,
            author.participantId,
            input.sourceMessageId
        )
        const { discussion, thread } = createBranch(this.deps.ctx, before, {
            sourceMessageId: input.sourceMessageId,
            quoteText,
            selectionStart: input.selectionStart,
            selectionEnd: input.selectionEnd,
            author
        })
        this.commit({ ...this.contents, discussion, readState })
        return thread.threadId
    }

    /** Explicit "mark as read" for one message (FR-111). Returns false if it was already read. */
    markMessageRead(author: Author, messageId: string): boolean {
        return this.commitReadState(
            author,
            markMessageRead(
                this.contents.discussion,
                this.contents.readState,
                author.participantId,
                messageId
            )
        )
    }

    /** Marks the thread's own messages as read (FR-111). */
    markThreadRead(author: Author, threadId: string): boolean {
        return this.commitReadState(
            author,
            markThreadRead(
                this.contents.discussion,
                this.contents.readState,
                author.participantId,
                threadId
            )
        )
    }

    /** Marks every message of the discussion as read (FR-111). */
    markAllRead(author: Author): boolean {
        return this.commitReadState(
            author,
            markAllRead(this.contents.discussion, this.contents.readState, author.participantId)
        )
    }

    /** Would this action change the person's read state? (Used to show the privacy notice first, FR-125.) */
    readStateChangeFor(participantId: string, action: ReadAction): boolean {
        const { discussion, readState } = this.contents
        const next = ((): ReadState => {
            switch (action.type) {
                case 'send':
                    return readStateAfterSend(discussion, readState, participantId, action.threadId)
                case 'branch':
                    return readStateAfterBranch(
                        discussion,
                        readState,
                        participantId,
                        action.messageId
                    )
                case 'message':
                    return markMessageRead(discussion, readState, participantId, action.messageId)
                case 'thread':
                    return markThreadRead(discussion, readState, participantId, action.threadId)
                case 'all':
                    return markAllRead(discussion, readState, participantId)
            }
        })()
        return next !== readState
    }

    /** Total unread messages for a participant (window title, header; FR-113). */
    unreadTotal(participantId: string): number {
        return unreadSummary(this.contents.discussion, this.contents.readState, participantId).total
    }

    /** Close or reopen a branch (FR-059, FR-060). `by` is the local participant ID (FR-153). */
    setThreadStatus(by: string, threadId: string, status: ThreadStatus): void {
        this.commit({
            ...this.contents,
            discussion: setThreadStatus(
                this.deps.ctx,
                this.contents.discussion,
                threadId,
                status,
                by
            )
        })
    }

    /** Optional branch title (FR-058); an empty title removes it. `by` is the local participant ID (FR-153). */
    setThreadTitle(by: string, threadId: string, title: string): void {
        this.commit({
            ...this.contents,
            discussion: setThreadTitle(this.deps.ctx, this.contents.discussion, threadId, title, by)
        })
    }

    /** Writes any pending change now; resolves when the queue is empty. Never rejects. */
    async flush(): Promise<void> {
        await this.writeChain
    }

    /** Tries again after a failed save. */
    async retrySave(): Promise<void> {
        this.scheduleSave()
        await this.flush()
    }

    view(localParticipantId: string): DocumentView {
        return {
            documentId: this.documentId,
            sessionId: this.sessionId,
            discussion: this.contents.discussion,
            readState: this.contents.readState,
            synced: this.synced,
            knownParticipants: this.synced
                ? knownParticipants(this.contents)
                : this.contents.discussion.participants,
            loading: this.loading,
            copies: this.synced ? this.copies : {},
            deliveryState: this.synced ? (this.contents.delivery ?? {}) : {},
            syncStatus: this.synced ? this.syncStatus : null,
            localParticipantId,
            missingAssetIds: this.missingAssetIds,
            saveError: this._saveError,
            saving: this.saving,
            notices: this.notices
        }
    }

    /** Saves a read-state change (FR-121); the participant is added to the discussion on this first save (FR-022). */
    private commitReadState(author: Author, readState: ReadState): boolean {
        if (readState === this.contents.readState) return false
        this.commit({
            ...this.contents,
            discussion: ensureParticipant(this.contents.discussion, author),
            readState
        })
        return true
    }

    private commit(next: DocumentContents): void {
        const before = this.contents
        const hook = this.syncHook
        // a synchronized discussion keeps the same order of lists on every computer (normalizeSynced)
        this.contents = hook ? normalizeSynced(next) : next
        this.scheduleSave()
        this.onChange()
        hook?.(before, this.contents)
    }

    private scheduleSave(): void {
        if (this.scheduled) return // the pending write will pick up the latest state
        this.scheduled = true
        this.writeChain = this.writeChain.then(async () => {
            this.scheduled = false // changes committed from now on schedule another write
            this.running = true
            const snapshot = this.contents
            const assets = [...this.pendingAssets]
            try {
                await this.store.save(snapshot, assets)
                // saved: these images now come from the library, so their memory can be released
                this.pendingAssets = this.pendingAssets.filter((a) => !assets.includes(a))
                for (const a of assets) this.staged.delete(a.sha256)
                this._saveError = null
            } catch (err) {
                this._saveError = describeSaveError(err)
            } finally {
                this.running = false
            }
            this.onStatusChange()
        })
    }
}

export function describeSaveError(err: unknown): string {
    if (err instanceof DocumentError) return describeError(err.code)
    if (err instanceof DomainError) return describeError(err.code)
    if (err instanceof LibraryError && err.code === 'CONFLICT') return describeError('CONFLICT')
    return describeError('SAVE_FAILED')
}
