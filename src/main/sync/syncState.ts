import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import type { Envelope } from '@shared/sync'
import type { VerifiedEvent } from '@shared/sync'
import { StateFileWriter } from '../document/atomicWrite'

/**
 * Local sync state of one conversation (design section 18). JSON with the existing atomic write; bulky bytes
 * (received parts, parts still to send) are separate files. Never inside the shared folder.
 */

export type OutboxKind = 'event' | 'part' | 'receipt' | 'invitation' | 'invitation.part'

export interface OutboxItem {
    /** Event ID, part ID, receipt ID, or invitation ID: the ID in the file name. */
    id: string
    kind: OutboxKind
    recipientId: string
    fileName: string
    /** The envelope for this recipient; for parts the bytes are in `out-parts/`. */
    envelope: Envelope
    /** For parts: the file in `out-parts/` that holds the payload. */
    payloadFile?: string
    /** The message this item belongs to (for delivery marks). */
    messageId?: string
    writtenAt: string | null
    deliveredAt: string | null
    lastWriteAt: string | null
    /**
     * The roster member whose key seals this copy and whose receipt confirms it, if not `recipientId`: a re-invitation
     * goes to the inbox of the person's new ID, but to the member with the old ID (D-15).
     */
    memberId?: string
    /** No receipt for 30 days: the own file was deleted and the copy is not written again (D-34). */
    abandonedAt?: string
}

export interface LoadingEntry {
    eventId: string
    senderId: string
    clock: number
    createdAt: string
    /** The verified `message.sent` payload. */
    payload: VerifiedEvent<'message.sent'>['payload']
}

/** An attachment of another member whose bytes are still coming (FR-261, FR-268a). */
export interface AttachmentLoad {
    senderId: string
    messageId: string
    sha256: string
    size: number
    type: string
    parts: Array<{ partId: string; index: number; size: number; sha256: string }>
    /** The bytes are in the library (or were given up after a bad check). */
    done: boolean
    at: string
}

export interface StateData {
    version: 1
    conversationId: string
    ownId: string
    /** Last `senderSeq` used by this member. */
    senderSeq: number
    outbox: OutboxItem[]
    /** `${senderId}:${eventId}` of applied (or duplicate) events; parts are listed by part ID. */
    processed: string[]
    /** Used `senderSeq` values per sender (replay check, section 9.1). */
    seqs: Record<string, Record<string, string>>
    /** File names in the own inbox that are processed but could not be deleted (D-19). */
    keptFiles: string[]
    pending: VerifiedEvent[]
    /**
     * Files in the own inbox that are kept until their event is processed (waiting for a dependency, parts, or a
     * member): file name -> processing key and the ID to confirm in the receipt.
     */
    held: Record<string, { key: string; senderId: string; receiptId: string }>
    loading: Record<string, LoadingEntry>
    /** `${senderId}:${partId}` of stored parts: a part counts only for a message of the same sender. */
    receivedParts: string[]
    /** Files waiting for a newer app version (section 10), with the app version that saw them. */
    needsUpdate: Array<{ name: string; appVersion: string }>
    quarantine: Array<{ name: string; reason: string; at: string }>
    /** Files that did not open yet (section 9.6). */
    failures: Record<string, { size: number; mtimeMs: number; since: string }>
    peers: Record<string, { lastActivityAt: string }>
    /** Receipt files written by this member into other inboxes (cleanup after 7 days, D-34). */
    ownReceipts: Array<{ recipientId: string; fileName: string; writtenAt: string }>
    lastScanAt: string | null
    /** D-15, D-32: new keys of a member that another member sent; this member accepts or rejects them. */
    keyRequests: KeyRequest[]
    /**
     * D-32: this member was re-invited after key loss. Members from whom an event or receipt opened since then have
     * accepted the new keys; the others have not (yet).
     */
    rejoin: { at: string; heardFrom: string[] } | null
    /** Attachments of others that are loading. */
    attachmentLoads: AttachmentLoad[]
    /**
     * FR-268a: part files of attachments larger than this member's file size limit, with the attachment size; they
     * stay in the inbox and are read when the limit is raised.
     */
    deferred: Record<string, number>
    /** FR-268: the file size limit of each other member (`member.limits.set`; the higher `senderSeq` wins). */
    peerLimits: Record<string, { maxFileMb: number; seq: number }>
    /** FR-268: the own limit last sent to each member (absent: the default, 30 MB). */
    limitsSent: Record<string, number>
}

export interface KeyRequest {
    participantId: string
    signingPublicKey: string
    encryptionPublicKey: string
    fingerprint: string
    /** The member who re-invited the person. */
    requestedBy: string
    createdAt: string
    state: 'pending' | 'rejected'
}

const stateSchema = z
    .object({
        version: z.literal(1),
        conversationId: z.string(),
        ownId: z.string(),
        senderSeq: z.number().int().nonnegative()
    })
    .passthrough()

const SAFE_ID = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/

export function conversationDir(syncRoot: string, conversationId: string): string {
    if (!SAFE_ID.test(conversationId) || conversationId.includes('..'))
        throw new Error('conversation ID cannot be used as a folder name')
    return join(syncRoot, conversationId)
}

function empty(conversationId: string, ownId: string): StateData {
    return {
        version: 1,
        conversationId,
        ownId,
        senderSeq: 0,
        outbox: [],
        processed: [],
        seqs: {},
        keptFiles: [],
        pending: [],
        held: {},
        loading: {},
        receivedParts: [],
        needsUpdate: [],
        quarantine: [],
        failures: {},
        peers: {},
        ownReceipts: [],
        lastScanAt: null,
        keyRequests: [],
        rejoin: null,
        attachmentLoads: [],
        deferred: {},
        peerLimits: {},
        limitsSent: {}
    }
}

export class SyncState {
    data: StateData
    private processedSet = new Set<string>()

    private constructor(
        readonly dir: string,
        data: StateData
    ) {
        this.data = data
        this.processedSet = new Set(data.processed)
    }

    /**
     * `now` seeds the sequence of a fresh state: it starts at the time in milliseconds, so a member whose state was
     * lost continues with higher numbers than before (sync-protocol.md section 5).
     */
    static async open(
        dir: string,
        conversationId: string,
        ownId: string,
        now: () => number = Date.now
    ): Promise<SyncState> {
        await fs.mkdir(dir, { recursive: true })
        let data = { ...empty(conversationId, ownId), senderSeq: now() }
        try {
            const raw = JSON.parse(await fs.readFile(join(dir, 'state.json'), 'utf8')) as unknown
            const base = stateSchema.safeParse(raw)
            if (
                base.success &&
                base.data.conversationId === conversationId &&
                base.data.ownId === ownId
            )
                data = {
                    ...empty(conversationId, ownId),
                    ...(raw as Partial<StateData>)
                }
        } catch {
            // missing or unreadable: start empty; events are deduplicated by the discussion itself (apply rules)
        }
        return new SyncState(dir, data)
    }

    get stagingDir(): string {
        return join(this.dir, 'staging')
    }
    private get inParts(): string {
        return join(this.dir, 'in-parts')
    }
    private get outParts(): string {
        return join(this.dir, 'out-parts')
    }

    isProcessed(key: string): boolean {
        return this.processedSet.has(key)
    }

    markProcessed(key: string): void {
        if (this.processedSet.has(key)) return
        this.processedSet.add(key)
        this.data.processed.push(key)
    }

    nextSenderSeq(): number {
        this.data.senderSeq += 1
        return this.data.senderSeq
    }

    /** Received parts and waiting image bytes are stored per sender, so nobody can replace another's part. */
    private inPartFile(senderId: string, id: string): string {
        return join(this.inParts, createHash('sha256').update(`${senderId}:${id}`).digest('hex'))
    }

    hasInPart(senderId: string, id: string): boolean {
        return this.data.receivedParts.includes(`${senderId}:${id}`)
    }

    async storeInPart(senderId: string, id: string, data: Uint8Array): Promise<void> {
        await fs.mkdir(this.inParts, { recursive: true })
        await fs.writeFile(this.inPartFile(senderId, id), data)
        const key = `${senderId}:${id}`
        if (!this.data.receivedParts.includes(key)) this.data.receivedParts.push(key)
    }

    async readInPart(senderId: string, id: string): Promise<Uint8Array | null> {
        try {
            return new Uint8Array(await fs.readFile(this.inPartFile(senderId, id)))
        } catch {
            return null
        }
    }

    async dropInParts(senderId: string, ids: readonly string[]): Promise<void> {
        for (const id of ids) await fs.rm(this.inPartFile(senderId, id), { force: true })
        const drop = new Set(ids.map((id) => `${senderId}:${id}`))
        this.data.receivedParts = this.data.receivedParts.filter((p) => !drop.has(p))
    }

    async storeOutPart(partId: string, data: Uint8Array): Promise<string> {
        await fs.mkdir(this.outParts, { recursive: true })
        await fs.writeFile(join(this.outParts, partId), data)
        return partId
    }

    async readOutPart(file: string): Promise<Uint8Array | null> {
        try {
            return new Uint8Array(await fs.readFile(join(this.outParts, file)))
        } catch {
            return null
        }
    }

    async dropOutPart(file: string): Promise<void> {
        await fs.rm(join(this.outParts, file), { force: true })
    }

    // ---- changes of the state (code review S-1): the engine reads `data`, but changes it only here -------------------

    /** A copy to write (an event, a part, a receipt, an invitation) for one recipient. */
    queue(item: OutboxItem): void {
        this.data.outbox.push(item)
    }

    /** An inbox file that waits for an event before it (or for its message). */
    hold(name: string, entry: { key: string; senderId: string; receiptId: string }): void {
        this.data.held[name] = entry
    }

    release(name: string): void {
        delete this.data.held[name]
    }

    /** A file that cannot be used; it is never read again. */
    quarantine(name: string, reason: string, at: string): void {
        delete this.data.held[name]
        delete this.data.failures[name]
        this.data.quarantine.push({ name, reason, at })
    }

    /** A file that could not be opened yet (it may still be syncing): first time with this size and time. */
    noteFailure(name: string, failure: { size: number; mtimeMs: number; since: string }): void {
        this.data.failures[name] = failure
    }

    clearFailure(name: string): void {
        delete this.data.failures[name]
    }

    /** All files are tried again (after new keys arrived). */
    clearFailures(): void {
        this.data.failures = {}
    }

    /** A file that this member keeps and does not try again (D-32, or a delete that failed). */
    keepFile(name: string): void {
        if (!this.data.keptFiles.includes(name)) this.data.keptFiles.push(name)
    }

    /** Forgets the records of inbox files that are gone. */
    forgetMissingFiles(present: ReadonlySet<string>): void {
        const d = this.data
        d.keptFiles = d.keptFiles.filter((n) => present.has(n))
        for (const name of Object.keys(d.failures)) if (!present.has(name)) delete d.failures[name]
        for (const name of Object.keys(d.deferred)) if (!present.has(name)) delete d.deferred[name]
    }

    scanned(at: string): void {
        this.data.lastScanAt = at
    }

    peerSeen(participantId: string, at: string): void {
        this.data.peers[participantId] = { lastActivityAt: at }
    }

    noteNeedsUpdate(name: string, appVersion: string): void {
        this.data.needsUpdate = [
            ...this.data.needsUpdate.filter((n) => n.name !== name),
            { name, appVersion }
        ]
    }

    addPending(event: VerifiedEvent): void {
        this.data.pending.push(event)
    }

    setPending(events: VerifiedEvent[]): void {
        this.data.pending = events
    }

    startLoading(messageId: string, entry: LoadingEntry): void {
        this.data.loading[messageId] = entry
    }

    stopLoading(messageId: string): void {
        delete this.data.loading[messageId]
    }

    addOwnReceipt(receipt: { recipientId: string; fileName: string; writtenAt: string }): void {
        this.data.ownReceipts.push(receipt)
    }

    setOwnReceipts(receipts: StateData['ownReceipts']): void {
        this.data.ownReceipts = receipts
    }

    /** D-32: one open key request per person; a newer one replaces the older one. */
    putKeyRequest(request: KeyRequest): void {
        this.data.keyRequests = [
            ...this.data.keyRequests.filter((r) => r.participantId !== request.participantId),
            request
        ]
    }

    removeKeyRequest(request: KeyRequest): void {
        this.data.keyRequests = this.data.keyRequests.filter((r) => r !== request)
    }

    startRejoin(at: string, inviterId: string): void {
        this.data.rejoin = { at, heardFrom: [inviterId] }
    }

    /** D-32: an event that opened with the new key shows that its sender accepted it. True if this is new. */
    heardAfterRejoin(participantId: string): boolean {
        const rejoin = this.data.rejoin
        if (!rejoin || rejoin.heardFrom.includes(participantId)) return false
        rejoin.heardFrom.push(participantId)
        return true
    }

    rejectKeyRequest(request: KeyRequest): void {
        request.state = 'rejected'
    }

    /** A copy was written to the shared folder (again). */
    written(item: OutboxItem, at: string): void {
        item.writtenAt ??= at
        item.lastWriteAt = at
    }

    /** The recipient confirmed the copy (D-19). */
    delivered(item: OutboxItem, at: string): void {
        item.deliveredAt = at
    }

    // FR-268, FR-268a: file size limits

    /** The limit of another member; the event with the higher `senderSeq` wins. */
    recordPeerLimit(participantId: string, maxFileMb: number, seq: number): void {
        const current = this.data.peerLimits[participantId]
        if (!current || seq > current.seq) this.data.peerLimits[participantId] = { maxFileMb, seq }
    }

    limitSent(participantId: string, maxFileMb: number): void {
        this.data.limitsSent[participantId] = maxFileMb
    }

    /** A part file of an attachment larger than the own limit: skipped until the limit is at least `size`. */
    defer(name: string, size: number): void {
        this.data.deferred[name] = size
    }

    undefer(name: string): void {
        delete this.data.deferred[name]
    }

    /** The files of a message of another member start loading (once per sender, message, and hash). */
    addAttachmentLoad(load: AttachmentLoad): void {
        const known = this.data.attachmentLoads.some(
            (l) =>
                l.senderId === load.senderId &&
                l.messageId === load.messageId &&
                l.sha256 === load.sha256
        )
        if (!known) this.data.attachmentLoads.push(load)
    }

    finishAttachmentLoad(load: AttachmentLoad): void {
        load.done = true
    }

    /** Finished loads are kept for `keepMs`, so late copies of their parts are confirmed. */
    forgetAttachmentLoads(nowMs: number, keepMs: number): void {
        this.data.attachmentLoads = this.data.attachmentLoads.filter(
            (l) => !l.done || nowMs - Date.parse(l.at) < keepMs
        )
    }

    private readonly writer = new StateFileWriter(() => join(this.dir, 'state.json'))

    async save(): Promise<void> {
        await this.writer.write(() => JSON.stringify(this.data))
    }
}
