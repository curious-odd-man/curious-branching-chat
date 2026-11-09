import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
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
import type { ReadState, ThreadStatus } from '@shared/validation'
import { collectImageAssetIds, type RichDoc } from '@shared/validation'
import type { StagedImage } from '@shared/types/assets'
import type { DocumentContents } from '@shared/validation'
import type { DocumentView } from '@shared/types/ipc'
import { describeError } from '@shared/i18n/ru'
import {
    DocumentError,
    newDocumentContents,
    prepareImage,
    readDocument,
    readImageAsset,
    writeDocument as defaultWriter,
    type PreparedImage
} from '../document'

export type DocumentWriter = (
    path: string,
    contents: DocumentContents,
    options?: { discardExisting?: boolean; newAssets?: PreparedImage[] }
) => Promise<void>

/** What a caller is about to do, to find out beforehand whether it will change the person's read state. */
export type ReadAction =
    | { type: 'send'; threadId: string }
    | { type: 'branch'; messageId: string }
    | { type: 'message'; messageId: string }
    | { type: 'thread'; threadId: string }
    | { type: 'all' }

export interface SessionDeps {
    ctx: DomainContext
    /** Injectable so tests can observe, delay or fail writes. */
    writer?: DocumentWriter
}

/**
 * One open discussion: the in-memory state plus a serialized, coalescing write queue (FR-007).
 *
 * Changes appear immediately; every change is then saved to the file. Several quick changes are saved with a single
 * write of the latest state. If a write fails, the changes stay in memory, `saveError` is set, and the next change or
 * `retrySave()` tries again (FR-008).
 */
export class DocumentSession {
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
    /** Images used by sent messages but not yet written to the file. */
    private pendingAssets: PreparedImage[] = []

    private constructor(
        readonly path: string,
        private contents: DocumentContents,
        private readonly missingAssetIds: string[],
        private readonly deps: Required<SessionDeps>
    ) {}

    static async open(path: string, deps: SessionDeps): Promise<DocumentSession> {
        const loaded = await readDocument(path)
        return new DocumentSession(
            path,
            loaded.contents,
            loaded.missingAssetIds,
            withDefaults(deps)
        )
    }

    /** Creates the file immediately (requirements 4.1). Fails if it cannot be written. */
    static async create(
        path: string,
        deps: SessionDeps,
        input: { author: Author; title?: string; generator?: { name: string; version: string } }
    ): Promise<DocumentSession> {
        const full = withDefaults(deps)
        const title = input.title ?? basename(path).replace(/\.branchchat$/i, '')
        const contents = newDocumentContents(full.ctx, {
            title,
            author: input.author,
            ...(input.generator ? { generator: input.generator } : {})
        })
        // A new file replaces whatever is at the path (the Save dialog already asked about overwriting).
        await full.writer(path, contents, { discardExisting: true })
        return new DocumentSession(path, contents, [], full)
    }

    get documentId(): string {
        return this.contents.manifest.documentId
    }
    get saveError(): string | null {
        return this._saveError
    }
    get saving(): boolean {
        return this.scheduled || this.running
    }
    get fileName(): string {
        return basename(this.path)
    }

    /**
     * Adds image bytes to the draft (FR-065 to FR-067). Only PNG, JPEG, GIF and WebP are accepted (FR-116); there is no
     * size limit (NFR-015). The image is stored in the file only when a message containing it is sent; one that is
     * never sent leaves no trace in the file. Identical images are the same asset (deduplicated by checksum).
     */
    stageImage(data: Buffer): StagedImage {
        const image = prepareImage(data)
        if (!this.staged.has(image.sha256)) this.staged.set(image.sha256, image)
        return { assetId: image.sha256, mediaType: image.mediaType, size: image.size }
    }

    /**
     * Bytes of an embedded image, for display (FR-068). Images that are not saved yet come from memory; the others are
     * read from the file and checked against their recorded type and checksum. Null means "show a placeholder"
     * (FR-075): the data is missing, damaged, or does not match.
     */
    async readAssetBytes(assetId: string): Promise<{ data: Buffer; mediaType: string } | null> {
        const memory =
            this.pendingAssets.find((a) => a.sha256 === assetId) ?? this.staged.get(assetId)
        if (memory) return { data: memory.data, mediaType: memory.mediaType }
        const info = this.contents.discussion.assets.find((a) => a.assetId === assetId)
        if (!info) return null
        try {
            const data = await readImageAsset(this.path, info)
            return data ? { data, mediaType: info.mediaType } : null
        } catch {
            return null
        }
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
        // Images used for the first time are registered in the file now, and their bytes queued for the next write.
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
        this.pendingAssets.push(...added)
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

    /** Close or reopen a branch (FR-059, FR-060). */
    setThreadStatus(threadId: string, status: ThreadStatus): void {
        this.commit({
            ...this.contents,
            discussion: setThreadStatus(this.deps.ctx, this.contents.discussion, threadId, status)
        })
    }

    /** Optional branch title (FR-058); an empty title removes it. */
    setThreadTitle(threadId: string, title: string): void {
        this.commit({
            ...this.contents,
            discussion: setThreadTitle(this.deps.ctx, this.contents.discussion, threadId, title)
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
            filePath: this.path,
            fileName: this.fileName,
            discussion: this.contents.discussion,
            readState: this.contents.readState,
            localParticipantId,
            missingAssetIds: this.missingAssetIds,
            saveError: this._saveError,
            saving: this.saving,
            notices: this.notices
        }
    }

    /** Saves a read-state change (FR-121); the participant is added to the file on this first write (FR-022). */
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
        this.contents = next
        this.scheduleSave()
        this.onChange()
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
                await this.deps.writer(
                    this.path,
                    snapshot,
                    assets.length > 0 ? { newAssets: assets } : undefined
                )
                // saved: these images now come from the file, so their memory can be released
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

function withDefaults(deps: SessionDeps): Required<SessionDeps> {
    return { ctx: deps.ctx, writer: deps.writer ?? ((p, c, o) => defaultWriter(p, c, o)) }
}

export function describeSaveError(err: unknown): string {
    if (err instanceof DocumentError) return describeError(err.code)
    if (err instanceof DomainError) return describeError(err.code)
    return describeError('WRITE_FAILED')
}
