import {
    INCOMPLETE_FILE_GRACE_MINUTES,
    MAX_RECEIPT_IDS,
    STABLE_FILE_SECONDS,
    SYNC_PROTOCOL_VERSION,
    applyAll,
    documentClock,
    addOwnDelivery,
    missingOwnDelivery,
    isComplete,
    loadingMessage,
    partRanges,
    type Envelope,
    type EventType,
    type LoadingMessage,
    type LocalEvent,
    type MessageSentPayload,
    type VerifiedEvent
} from '@shared/sync'
import type { DocumentContents, RichDoc } from '@shared/validation'
import { openEvent, sealEvent, sha256Hex, type OpenedEvent } from '../crypto/envelope'
import { fromB64 } from '../crypto/identity'
import { PartsError, joinContent, joinImage, planMessageParts } from '../crypto/parts'
import type { FolderTransport, SharedEntry, SharedFolder } from '../transport/folderTransport'
import type { OutboxItem, OutboxKind, SyncState } from './syncState'

/** What the sync service needs from the discussion: the open window's session, or the file (design section 10). */
export interface DocumentPort {
    read(): Promise<DocumentContents>
    /**
     * Applies a change in the same write queue as local changes. `images` are image bytes to write into the file
     * (assets that the change registers). Returning null means "no change".
     */
    update(
        change: (contents: DocumentContents) => {
            contents: DocumentContents
            images: Array<{ assetId: string; data: Uint8Array }>
        } | null
    ): Promise<void>
    /** Bytes of an image of the discussion (for sending it as parts). */
    imageBytes(assetId: string): Promise<Uint8Array | null>
}

export interface OwnKeys {
    sign(data: Uint8Array): Promise<Uint8Array>
    open(sealed: Uint8Array): Promise<Uint8Array | null>
}

export interface ConversationSyncDeps {
    conversationId: string
    ownId: string
    transport: FolderTransport
    state: SyncState
    keys: OwnKeys
    document: DocumentPort
    now: () => string
    newId: () => string
    maxFileBytes: () => number
    appVersion: string
    /** Wait before a file counts as stable (sync-protocol.md 9.6); 0 in tests. */
    stableMs?: number
    /** Called when the loading messages or the sync status change (for the window). */
    onChange?: () => void
    log?: (message: string) => void
}

/** Folder state for the status line (D-35, FR-172). */
export type FolderHealth = 'ok' | 'missing' | 'no-permission'

export interface SyncHealth {
    folder: FolderHealth
    /** Files in the own inbox that could not be used (damaged, not from a member, too large). */
    quarantined: number
    /** Files that need a newer version of the application (sync-protocol.md section 10). */
    needsUpdate: boolean
    lastScanAt: string | null
}

export type CopyState = 'pending' | 'written' | 'delivered'

/** Delivery of one own message (D-09, FR-169): per recipient and for all recipients together. */
export interface MessageDelivery {
    state: CopyState
    members: Record<string, CopyState>
}

/** The retry rule and age-based cleanup (D-29, D-34). */
export const RETRY_INTERVAL_MS = 30 * 60_000
export const RECEIPT_MAX_AGE_MS = 7 * 24 * 60 * 60_000
export const UNCONFIRMED_MAX_AGE_MS = 30 * 24 * 60 * 60_000

export interface MaintenanceReport {
    rewritten: number
    receiptsDeleted: number
    abandoned: number
}

export interface ScanReport {
    applied: number
    receipts: number
    held: number
    quarantined: number
    needsUpdate: number
}

const EXTENSION: Record<OutboxKind, string> = {
    event: 'bcmsg',
    part: 'bcpart',
    receipt: 'bcrcpt',
    invitation: 'bcinv',
    'invitation.part': 'bcpart'
}

const DOCUMENT_TYPES = new Set<EventType>([
    'message.sent',
    'branch.created',
    'branch.status.set',
    'branch.title.set',
    'readstate.added',
    'delivery.added',
    'member.added',
    'profile.updated'
])

/**
 * Sync of one conversation (design sections 13 to 18, sync-protocol.md section 9): outbox, inbox processing,
 * receipts, cleanup. One operation at a time; the state is saved after each operation.
 */
export class ConversationSync {
    private chain: Promise<unknown> = Promise.resolve()
    /** First sight of a file: size, time, and when it was seen (sync-protocol.md 9.6). */
    private seen = new Map<string, { size: number; mtimeMs: number; at: number }>()
    private readonly stableMs: number
    private folder: FolderHealth = 'ok'

    constructor(private readonly deps: ConversationSyncDeps) {
        this.stableMs = deps.stableMs ?? STABLE_FILE_SECONDS * 1000
    }

    private get state(): SyncState {
        return this.deps.state
    }

    private inbox(participantId: string): SharedFolder {
        return { kind: 'inbox', participantId }
    }

    private serial<T>(fn: () => Promise<T>): Promise<T> {
        const next = this.chain.then(fn, fn)
        this.chain = next.catch(() => undefined)
        return next
    }

    /** At start: remove interrupted writes, create the own folders, write what is still unwritten. */
    start(): Promise<void> {
        return this.serial(async () => {
            await this.deps.transport.cleanStaging()
            await this.deps.transport.ensureLayout(this.deps.conversationId, this.deps.ownId)
            await this.flushUnlocked()
            await this.deliverUnlocked()
            await this.maintainUnlocked()
            await this.state.save()
        })
    }

    /**
     * D-41: every message of another author that is in the own copy counts as received by this member; the other
     * members learn it from `delivery.added`. Covers new messages, the history of an invitation, and recovery.
     * The event is stored (and the state saved) before the document changes: after a crash between the two steps,
     * the next scan sends the same IDs again, which does no harm.
     */
    private async deliverUnlocked(): Promise<void> {
        const contents = await this.deps.document.read()
        const missing = missingOwnDelivery(contents, this.deps.ownId)
        if (missing.length === 0) return
        const recipients = (contents.sync?.members ?? [])
            .map((m) => m.participantId)
            .filter((id) => id !== this.deps.ownId)
        for (let i = 0; i < missing.length; i += 10_000)
            await this.enqueue(
                {
                    type: 'delivery.added',
                    payload: { messageIds: missing.slice(i, i + 10_000) },
                    clock: documentClock(contents),
                    createdAt: this.deps.now()
                },
                recipients
            )
        await this.state.save()
        await this.deps.document.update((c) => {
            const next = addOwnDelivery(c, this.deps.ownId, missing)
            return next === c ? null : { contents: next, images: [] }
        })
        await this.flushUnlocked()
        await this.state.save()
    }

    // --- outgoing ---------------------------------------------------------------------------------------------

    /**
     * Sends local changes (design section 14). `after` is the discussion after the change, which has the roster
     * (recipients) and the images to send.
     */
    send(events: readonly LocalEvent[], after: DocumentContents): Promise<void> {
        return this.serial(async () => {
            const recipients = (after.sync?.members ?? [])
                .map((m) => m.participantId)
                .filter((id) => id !== this.deps.ownId)
            for (const e of events) await this.enqueue(e, recipients)
            await this.state.save()
            await this.flushUnlocked()
            await this.state.save()
        })
    }

    private envelope(
        type: EventType,
        recipientId: string,
        eventId: string,
        senderSeq: number,
        clock: number,
        createdAt: string,
        payload: unknown,
        payloadSha256?: string
    ): Envelope {
        return {
            protocolVersion: SYNC_PROTOCOL_VERSION,
            eventId,
            type,
            conversationId: this.deps.conversationId,
            senderId: this.deps.ownId,
            recipientId,
            senderSeq,
            clock,
            createdAt,
            payload,
            ...(payloadSha256 ? { payloadSha256 } : {})
        } as Envelope
    }

    private async enqueue(e: LocalEvent, recipients: readonly string[]): Promise<void> {
        if (recipients.length === 0) return
        const eventId = this.deps.newId()
        let payload: unknown = e.payload
        const parts: Array<{ partId: string; sha256: string; file: string }> = []
        if (e.type === 'message.sent') {
            const draft = e.payload as MessageSentPayload
            const bytes = new Map<string, Uint8Array>()
            for (const image of draft.images) {
                const data = await this.deps.document.imageBytes(image.assetId)
                if (!data) throw new Error(`image ${image.assetId} is not available`)
                bytes.set(image.assetId, data)
            }
            const planned = planMessageParts(draft, bytes, this.deps.newId)
            payload = planned.payload
            for (const p of planned.parts) {
                parts.push({
                    partId: p.entry.partId,
                    sha256: p.entry.sha256,
                    file: await this.state.storeOutPart(p.entry.partId, p.data)
                })
            }
        }
        const seq = this.state.nextSenderSeq()
        const messageId =
            e.type === 'message.sent'
                ? (e.payload as MessageSentPayload).message.messageId
                : undefined
        for (const r of recipients)
            this.state.data.outbox.push({
                id: eventId,
                kind: 'event',
                recipientId: r,
                fileName: `${eventId}.${EXTENSION.event}`,
                envelope: this.envelope(e.type, r, eventId, seq, e.clock, e.createdAt, payload),
                ...(messageId ? { messageId } : {}),
                writtenAt: null,
                deliveredAt: null,
                lastWriteAt: null
            })
        // parts are written after their header, so a reader usually knows the message before its parts
        for (const p of parts) {
            const partSeq = this.state.nextSenderSeq()
            const partEventId = this.deps.newId()
            for (const r of recipients)
                this.state.data.outbox.push({
                    id: p.partId,
                    kind: 'part',
                    recipientId: r,
                    fileName: `${p.partId}.${EXTENSION.part}`,
                    envelope: this.envelope(
                        'message.part',
                        r,
                        partEventId,
                        partSeq,
                        e.clock,
                        e.createdAt,
                        { messageId, partId: p.partId },
                        p.sha256
                    ),
                    payloadFile: p.file,
                    ...(messageId ? { messageId } : {}),
                    writtenAt: null,
                    deliveredAt: null,
                    lastWriteAt: null
                })
        }
    }

    /**
     * Invites one member (sync-protocol.md 7.10): the snapshot is the complete `.branchchat` file, split into parts.
     * Header and parts are encrypted to the invitee and signed by this member. Returns the invitation ID.
     */
    invite(recipientId: string, snapshot: Uint8Array, contents: DocumentContents): Promise<string> {
        return this.serial(async () => {
            const invitationId = this.deps.newId()
            const clock = documentClock(contents)
            const createdAt = this.deps.now()
            const parts = partRanges(snapshot.length).map((r) => {
                const data = snapshot.subarray(r.start, r.end)
                return {
                    partId: this.deps.newId(),
                    index: r.index,
                    size: data.length,
                    sha256: sha256Hex(data),
                    data
                }
            })
            const seq = this.state.nextSenderSeq()
            this.state.data.outbox.push({
                id: invitationId,
                kind: 'invitation',
                recipientId,
                fileName: `${invitationId}.${EXTENSION.invitation}`,
                envelope: this.envelope(
                    'invitation',
                    recipientId,
                    invitationId,
                    seq,
                    clock,
                    createdAt,
                    {
                        invitationId,
                        minProtocolVersion: SYNC_PROTOCOL_VERSION,
                        snapshotSize: snapshot.length,
                        snapshotSha256: sha256Hex(snapshot),
                        parts: parts.map(({ partId, index, size, sha256 }) => ({
                            partId,
                            index,
                            size,
                            sha256
                        }))
                    }
                ),
                writtenAt: null,
                deliveredAt: null,
                lastWriteAt: null
            })
            for (const p of parts) {
                const file = await this.state.storeOutPart(p.partId, p.data)
                this.state.data.outbox.push({
                    id: p.partId,
                    kind: 'invitation.part',
                    recipientId,
                    fileName: `${p.partId}.${EXTENSION['invitation.part']}`,
                    envelope: this.envelope(
                        'invitation.part',
                        recipientId,
                        this.deps.newId(),
                        this.state.nextSenderSeq(),
                        clock,
                        createdAt,
                        { invitationId, partId: p.partId },
                        p.sha256
                    ),
                    payloadFile: file,
                    writtenAt: null,
                    deliveredAt: null,
                    lastWriteAt: null
                })
            }
            await this.state.save()
            await this.flushUnlocked()
            await this.state.save()
            return invitationId
        })
    }

    /** "joined" when the invitee confirmed the invitation (design 12.3, step 8). */
    invitationStatus(): Record<string, 'invited' | 'joined'> {
        const out: Record<string, 'invited' | 'joined'> = {}
        for (const item of this.state.data.outbox) {
            if (item.kind !== 'invitation') continue
            if (item.deliveredAt) out[item.recipientId] = 'joined'
            else out[item.recipientId] ??= 'invited'
        }
        return out
    }

    /** After an import: confirm the invitation to the inviter and remove its files from the own inbox. */
    confirmInvitation(
        inviterId: string,
        ids: readonly string[],
        fileNames: readonly string[]
    ): Promise<void> {
        return this.serial(async () => {
            await this.sendReceipts(new Map([[inviterId, new Set(ids)]]))
            for (const name of fileNames) {
                const r = await this.deps.transport.delete(this.inbox(this.deps.ownId), name)
                if (r === 'failed' && !this.state.data.keptFiles.includes(name))
                    this.state.data.keptFiles.push(name)
            }
            await this.state.save()
        })
    }

    /** Writes every copy that is not written yet. A failed write is retried at the next flush with the same ID. */
    flush(): Promise<void> {
        return this.serial(async () => {
            await this.flushUnlocked()
            await this.state.save()
        })
    }

    private async flushUnlocked(): Promise<void> {
        const contents = await this.deps.document.read()
        const keyOf = new Map(
            (contents.sync?.members ?? []).map((m) => [
                m.participantId,
                fromB64(m.encryptionPublicKey)
            ])
        )
        for (const item of this.state.data.outbox) {
            if (item.writtenAt) continue
            const key = keyOf.get(item.recipientId)
            if (!key) continue
            try {
                await this.writeItem(item, key)
            } catch (err) {
                this.noteWriteError(err)
                this.deps.log?.(`write of ${item.fileName} failed: ${(err as Error).message}`)
            }
        }
    }

    /** A write that the folder refused: no permission, or the folder is gone (D-35). */
    private noteWriteError(err: unknown): void {
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'EACCES' || code === 'EPERM') this.folder = 'no-permission'
        else if (code === 'ENOENT' || code === 'ROOT_MISSING') this.folder = 'missing'
    }

    /**
     * At start and every 30 minutes (D-29, D-34):
     * - a copy without a receipt is written again, but only if the recipient has shown activity (a valid event or
     *   receipt) since the copy was last written; without activity it is not written again, with no maximum;
     * - own receipts that are still in another inbox after 7 days are deleted;
     * - own files that never got a receipt are deleted after 30 days, and the copy is given up.
     */
    maintain(): Promise<MaintenanceReport> {
        return this.serial(async () => {
            const r = await this.maintainUnlocked()
            await this.state.save()
            this.deps.onChange?.()
            return r
        })
    }

    private async maintainUnlocked(): Promise<MaintenanceReport> {
        const report: MaintenanceReport = { rewritten: 0, receiptsDeleted: 0, abandoned: 0 }
        const s = this.state.data
        const nowMs = Date.parse(this.deps.now())
        const contents = await this.deps.document.read()
        const keyOf = new Map(
            (contents.sync?.members ?? []).map((m) => [
                m.participantId,
                fromB64(m.encryptionPublicKey)
            ])
        )
        for (const item of s.outbox) {
            if (!item.writtenAt || item.deliveredAt || item.abandonedAt) continue
            if (nowMs - Date.parse(item.writtenAt) >= UNCONFIRMED_MAX_AGE_MS) {
                const r = await this.deps.transport.delete(
                    this.inbox(item.recipientId),
                    item.fileName
                )
                if (r === 'failed') continue // try again at the next maintenance
                item.abandonedAt = this.deps.now()
                report.abandoned++
                continue
            }
            const activity = s.peers[item.recipientId]?.lastActivityAt
            const lastWrite = item.lastWriteAt ?? item.writtenAt
            if (!activity || Date.parse(activity) <= Date.parse(lastWrite)) continue
            const key = keyOf.get(item.recipientId)
            if (!key) continue
            try {
                await this.writeItem(item, key)
                report.rewritten++
            } catch (err) {
                this.noteWriteError(err)
            }
        }
        await this.dropDeliveredParts()

        const keep: typeof s.ownReceipts = []
        for (const r of s.ownReceipts) {
            if (nowMs - Date.parse(r.writtenAt) < RECEIPT_MAX_AGE_MS) {
                keep.push(r)
                continue
            }
            const result = await this.deps.transport.delete(this.inbox(r.recipientId), r.fileName)
            if (result === 'failed') keep.push(r)
            else report.receiptsDeleted++
        }
        s.ownReceipts = keep
        return report
    }

    private async writeItem(item: OutboxItem, recipientKey: Uint8Array): Promise<void> {
        let payload: Uint8Array = new Uint8Array()
        if (item.payloadFile) {
            const data = await this.state.readOutPart(item.payloadFile)
            if (!data) throw new Error('part bytes are missing')
            payload = data
        }
        const sealed = await sealEvent(
            item.envelope,
            payload,
            (d) => this.deps.keys.sign(d),
            recipientKey
        )
        await this.deps.transport.publish(this.inbox(item.recipientId), item.fileName, sealed)
        const now = this.deps.now()
        item.writtenAt ??= now
        item.lastWriteAt = now
        if (this.folder !== 'ok') this.folder = 'ok'
    }

    // --- incoming ---------------------------------------------------------------------------------------------

    /** Reads the own inbox once (design section 15). Watch events and timers only call this. */
    scan(): Promise<ScanReport> {
        return this.serial(() => this.scanUnlocked())
    }

    private async scanUnlocked(): Promise<ScanReport> {
        const report: ScanReport = {
            applied: 0,
            receipts: 0,
            held: 0,
            quarantined: 0,
            needsUpdate: 0
        }
        const s = this.state.data
        if (!(await this.deps.transport.rootExists())) {
            // Drive for Desktop is closed, the drive letter changed, or the folder was removed (D-35)
            this.folder = 'missing'
            this.deps.onChange?.()
            return report
        }
        if (this.folder === 'missing') this.folder = 'ok'
        const entries = await this.deps.transport.list(this.inbox(this.deps.ownId))
        const present = new Set(entries.map((e) => e.name))
        // forget files that are gone (deleted by the sync product, or cleaned up)
        s.keptFiles = s.keptFiles.filter((n) => present.has(n))
        for (const name of Object.keys(s.failures)) if (!present.has(name)) delete s.failures[name]
        for (const name of [...this.seen.keys()]) if (!present.has(name)) this.seen.delete(name)

        const confirm = new Map<string, Set<string>>() // senderId -> IDs for the receipt
        const toDelete: SharedEntry[] = []
        const nowMs = Date.parse(this.deps.now())

        for (const entry of entries) {
            if (s.keptFiles.includes(entry.name) || s.held[entry.name]) continue
            if (s.quarantine.some((q) => q.name === entry.name)) continue
            if (entry.extension === 'bcinv' || entry.extension === 'bckey') continue // the join wizard reads these
            const update = s.needsUpdate.find((n) => n.name === entry.name)
            if (update && update.appVersion === this.deps.appVersion) continue
            if (!this.isStable(entry, nowMs)) continue
            await this.processFile(entry, nowMs, report, confirm, toDelete)
        }

        // events that waited for a dependency may apply now
        report.applied += await this.drainPending(confirm, toDelete)
        await this.completeLoading(confirm, toDelete, report)

        await this.deliverUnlocked()
        report.receipts += await this.sendReceipts(confirm)
        for (const entry of toDelete) {
            const r = await this.deps.transport.delete(entry.folder, entry.name)
            // D-19: if the sync product refuses, remember the file as processed and ignore it from now on
            if (r === 'failed' && !s.keptFiles.includes(entry.name)) s.keptFiles.push(entry.name)
        }
        s.lastScanAt = this.deps.now()
        report.held = Object.keys(s.held).length
        await this.state.save()
        this.deps.onChange?.()
        return report
    }

    private isStable(entry: SharedEntry, nowMs: number): boolean {
        if (this.stableMs === 0) return true
        const prev = this.seen.get(entry.name)
        if (!prev || prev.size !== entry.size || prev.mtimeMs !== entry.mtimeMs) {
            this.seen.set(entry.name, { size: entry.size, mtimeMs: entry.mtimeMs, at: nowMs })
            return false
        }
        return nowMs - prev.at >= this.stableMs
    }

    private quarantine(entry: SharedEntry, reason: string, report: ScanReport): void {
        this.state.data.quarantine.push({ name: entry.name, reason, at: this.deps.now() })
        delete this.state.data.failures[entry.name]
        report.quarantined++
        this.deps.log?.(`quarantined ${entry.name}: ${reason}`)
    }

    private notOpened(entry: SharedEntry, nowMs: number, reason: string, report: ScanReport): void {
        const s = this.state.data
        const f = s.failures[entry.name]
        if (!f || f.size !== entry.size || f.mtimeMs !== entry.mtimeMs) {
            s.failures[entry.name] = {
                size: entry.size,
                mtimeMs: entry.mtimeMs,
                since: this.deps.now()
            }
            return
        }
        // section 9.6: only a file that stays the same and still fails for the grace time is quarantined
        if (
            reason === 'unopened' &&
            nowMs - Date.parse(f.since) >= INCOMPLETE_FILE_GRACE_MINUTES * 60_000
        )
            this.quarantine(entry, 'does not open', report)
    }

    private async processFile(
        entry: SharedEntry,
        nowMs: number,
        report: ScanReport,
        confirm: Map<string, Set<string>>,
        toDelete: SharedEntry[]
    ): Promise<void> {
        let bytes: Uint8Array
        try {
            bytes = await this.deps.transport.read(
                entry.folder,
                entry.name,
                this.deps.maxFileBytes()
            )
        } catch (err) {
            const code = (err as { code?: string }).code
            if (code === 'TOO_LARGE') this.quarantine(entry, 'larger than the limit', report)
            return // otherwise: not readable right now; next scan
        }
        const contents = await this.deps.document.read()
        const opened: OpenedEvent = await openEvent(bytes, {
            open: (sealed) => this.deps.keys.open(sealed),
            conversationId: this.deps.conversationId,
            recipientId: this.deps.ownId,
            signingKeysOf: (senderId) => {
                const m = contents.sync?.members.find((x) => x.participantId === senderId)
                if (!m || senderId === this.deps.ownId) return null
                return [
                    m.signingPublicKey,
                    ...(m.previousKeys ?? []).map((k) => k.signingPublicKey)
                ].map(fromB64)
            }
        })
        if (opened.status === 'unopened') return this.notOpened(entry, nowMs, 'unopened', report)
        // a member whose `member.added` has not arrived yet: try again later, never quarantine
        if (opened.status === 'unknown-sender')
            return this.notOpened(entry, nowMs, 'unknown-sender', report)
        if (opened.status === 'invalid') return this.quarantine(entry, opened.reason, report)
        delete this.state.data.failures[entry.name]
        if (opened.status === 'needs-update') {
            this.markNeedsUpdate(entry, report)
            return
        }

        const env = opened.envelope
        this.state.data.peers[env.senderId] = { lastActivityAt: this.deps.now() }

        if (env.type === 'receipt.delivered') {
            await this.applyReceipt(env as Envelope<'receipt.delivered'>)
            toDelete.push(entry)
            return
        }
        if (env.type === 'invitation' || env.type === 'invitation.part') {
            toDelete.push(entry) // a late copy of the invitation that this member already imported
            return
        }
        // replay check (section 9.1)
        const seqs = (this.state.data.seqs[env.senderId] ??= {})
        const usedBy = seqs[String(env.senderSeq)]
        if (usedBy !== undefined && usedBy !== env.eventId)
            return this.quarantine(entry, 'sequence number used twice', report)
        seqs[String(env.senderSeq)] = env.eventId

        const receiptId =
            env.type === 'message.part' ? (env.payload as { partId: string }).partId : env.eventId
        const key =
            env.type === 'message.part'
                ? `part:${env.senderId}:${receiptId}`
                : `${env.senderId}:${env.eventId}`
        if (this.state.isProcessed(key)) {
            this.addConfirm(confirm, env.senderId, receiptId)
            toDelete.push(entry)
            return
        }

        if (env.type === 'member.keys.replaced') {
            // release 1.5 accepts key changes; until then the event waits (implementation plan, section 2.2)
            this.markNeedsUpdate(entry, report)
            return
        }

        if (env.type === 'message.part') {
            await this.state.storeInPart(env.senderId, receiptId, opened.payload)
            this.state.markProcessed(key)
            this.addConfirm(confirm, env.senderId, receiptId)
            toDelete.push(entry)
            return
        }

        if (!DOCUMENT_TYPES.has(env.type))
            return this.quarantine(entry, `unexpected ${env.type}`, report)

        const event: VerifiedEvent = {
            eventId: env.eventId,
            type: env.type,
            senderId: env.senderId,
            clock: env.clock,
            createdAt: env.createdAt,
            payload: env.payload
        } as VerifiedEvent
        this.state.data.held[entry.name] = { key, senderId: env.senderId, receiptId }

        if (
            event.type === 'message.sent' &&
            (event.payload as MessageSentPayload).parts.length > 0
        ) {
            const payload = event.payload as MessageSentPayload
            this.state.data.loading[payload.message.messageId] = {
                eventId: event.eventId,
                senderId: event.senderId,
                clock: event.clock,
                createdAt: event.createdAt,
                payload
            }
            return // completeLoading applies it when all parts are present
        }
        this.state.data.pending.push(event)
    }

    private markNeedsUpdate(entry: SharedEntry, report: ScanReport): void {
        const s = this.state.data
        s.needsUpdate = s.needsUpdate.filter((n) => n.name !== entry.name)
        s.needsUpdate.push({ name: entry.name, appVersion: this.deps.appVersion })
        report.needsUpdate++
    }

    private addConfirm(confirm: Map<string, Set<string>>, senderId: string, id: string): void {
        const set = confirm.get(senderId) ?? new Set<string>()
        set.add(id)
        confirm.set(senderId, set)
    }

    /** Applies everything in the pending queue that can be applied now (section 9.3). */
    private async drainPending(
        confirm: Map<string, Set<string>>,
        toDelete: SharedEntry[]
    ): Promise<number> {
        const s = this.state.data
        if (s.pending.length === 0) return 0
        // image bytes of complete messages that wait for a dependency are kept in the parts store
        const stored = new Map<string, { data: Uint8Array; senderId: string }>()
        for (const e of s.pending) {
            if (e.type !== 'message.sent') continue
            for (const image of (e.payload as MessageSentPayload).images) {
                const data = await this.state.readInPart(e.senderId, imageFile(image.assetId))
                if (data)
                    stored.set(`${e.eventId}:${image.assetId}`, { data, senderId: e.senderId })
            }
        }
        let applied = 0
        const finished: string[] = []
        const rejected: Array<{ key: string; reason: string }> = []
        const usedImages: Array<{ senderId: string; assetId: string }> = []
        await this.deps.document.update((contents) => {
            const r = applyAll(contents, s.pending)
            finished.push(...[...r.applied.map((a) => a.event), ...r.duplicates].map(eventKey))
            rejected.push(...r.rejected.map((x) => ({ key: eventKey(x.event), reason: x.reason })))
            applied = r.applied.length
            s.pending = r.pending
            if (r.applied.length === 0) return null
            const images: Array<{ assetId: string; data: Uint8Array }> = []
            for (const a of r.applied)
                for (const id of a.newAssetIds) {
                    const found = stored.get(`${a.event.eventId}:${id}`)
                    if (!found) continue
                    images.push({ assetId: id, data: found.data })
                    usedImages.push({ senderId: found.senderId, assetId: id })
                }
            return { contents: r.contents, images }
        })
        this.finishHeld(finished, confirm, toDelete)
        this.rejectHeld(rejected)
        for (const u of usedImages) await this.state.dropInParts(u.senderId, [imageFile(u.assetId)])
        return applied
    }

    /** Held files of events that break a rule go to the local quarantine; no receipt is sent for them. */
    private rejectHeld(rejected: ReadonlyArray<{ key: string; reason: string }>): void {
        for (const { key, reason } of rejected) {
            this.deps.log?.(`rejected ${key}: ${reason}`)
            for (const [name, h] of Object.entries(this.state.data.held)) {
                if (h.key !== key) continue
                delete this.state.data.held[name]
                this.state.data.quarantine.push({ name, reason, at: this.deps.now() })
            }
        }
    }

    /** Releases held files of processed events: confirm them and delete them. */
    private finishHeld(
        keys: string[],
        confirm: Map<string, Set<string>>,
        toDelete: SharedEntry[]
    ): void {
        const done = new Set(keys)
        for (const [name, h] of Object.entries(this.state.data.held)) {
            if (!done.has(h.key)) continue
            this.state.markProcessed(h.key)
            this.addConfirm(confirm, h.senderId, h.receiptId)
            toDelete.push({
                folder: this.inbox(this.deps.ownId),
                name,
                id: h.receiptId,
                extension: 'bcmsg',
                size: 0,
                mtimeMs: 0
            })
            delete this.state.data.held[name]
        }
    }

    /** Messages whose parts are all present: join, check, and apply them (D-30). */
    private async completeLoading(
        confirm: Map<string, Set<string>>,
        toDelete: SharedEntry[],
        report: ScanReport
    ): Promise<void> {
        const s = this.state.data
        for (const [messageId, l] of Object.entries(s.loading)) {
            const received = this.partsOf(l.senderId, l.payload)
            if (!isComplete(l.payload, received)) continue
            const parts = new Map<string, Uint8Array>()
            for (const p of l.payload.parts) {
                const data = await this.state.readInPart(l.senderId, p.partId)
                if (data) parts.set(p.partId, data)
            }
            const key = eventKey({ senderId: l.senderId, eventId: l.eventId } as VerifiedEvent)
            let content: RichDoc
            const images: Array<{ assetId: string; data: Uint8Array }> = []
            try {
                content = l.payload.message.content ?? joinContent(l.payload, parts)
                for (const image of l.payload.images)
                    images.push({
                        assetId: image.assetId,
                        data: joinImage(l.payload, image.assetId, parts)
                    })
            } catch (err) {
                if (!(err instanceof PartsError)) throw err
                this.deps.log?.(`message ${messageId}: ${err.message}`)
                delete s.loading[messageId]
                for (const [name, h] of Object.entries(s.held))
                    if (h.key === key) {
                        delete s.held[name]
                        s.quarantine.push({ name, reason: err.message, at: this.deps.now() })
                        report.quarantined++
                    }
                await this.state.dropInParts(
                    l.senderId,
                    l.payload.parts.map((p) => p.partId)
                )
                continue
            }
            const event: VerifiedEvent = {
                eventId: l.eventId,
                type: 'message.sent',
                senderId: l.senderId,
                clock: l.clock,
                createdAt: l.createdAt,
                payload: { ...l.payload, message: { ...l.payload.message, content } }
            }
            delete s.loading[messageId]
            await this.state.dropInParts(
                l.senderId,
                l.payload.parts.map((p) => p.partId)
            )
            await this.applyComplete(event, images, confirm, toDelete, report)
        }
    }

    private async applyComplete(
        event: VerifiedEvent,
        images: Array<{ assetId: string; data: Uint8Array }>,
        confirm: Map<string, Set<string>>,
        toDelete: SharedEntry[],
        report: ScanReport
    ): Promise<void> {
        const s = this.state.data
        let status = ''
        let reason = ''
        await this.deps.document.update((contents) => {
            const r = applyAll(contents, [event])
            if (r.applied.length > 0) {
                status = 'applied'
                const wanted = new Set(r.applied[0]!.newAssetIds)
                return { contents: r.contents, images: images.filter((i) => wanted.has(i.assetId)) }
            }
            status =
                r.duplicates.length > 0
                    ? 'duplicate'
                    : r.rejected.length > 0
                      ? 'rejected'
                      : 'pending'
            reason = r.rejected[0]?.reason ?? ''
            return null
        })
        if (status === 'pending') {
            // complete, but its thread (or another dependency) has not arrived: it waits like any other event, and
            // its image bytes wait in the parts store until it is applied (drainPending)
            s.pending.push(event)
            for (const i of images)
                await this.state.storeInPart(event.senderId, imageFile(i.assetId), i.data)
            return
        }
        if (status === 'rejected') {
            this.rejectHeld([{ key: eventKey(event), reason }])
            report.quarantined++
            return
        }
        if (status === 'applied') report.applied++
        this.finishHeld([eventKey(event)], confirm, toDelete)
    }

    private async applyReceipt(env: Envelope<'receipt.delivered'>): Promise<void> {
        const ids = new Set(env.payload.ids)
        const now = this.deps.now()
        for (const item of this.state.data.outbox) {
            if (item.recipientId !== env.senderId || !ids.has(item.id) || item.deliveredAt) continue
            item.deliveredAt = now
            // D-19: the sender deletes its own files after the receipt
            await this.deps.transport.delete(this.inbox(item.recipientId), item.fileName)
        }
        await this.dropDeliveredParts()
        this.deps.onChange?.()
    }

    private async dropDeliveredParts(): Promise<void> {
        const s = this.state.data
        const byFile = new Map<string, boolean>()
        for (const item of s.outbox) {
            if (!item.payloadFile) continue
            byFile.set(
                item.payloadFile,
                (byFile.get(item.payloadFile) ?? true) && item.deliveredAt !== null
            )
        }
        for (const [file, allDelivered] of byFile)
            if (allDelivered) await this.state.dropOutPart(file)
    }

    private async sendReceipts(confirm: Map<string, Set<string>>): Promise<number> {
        if (confirm.size === 0) return 0
        const contents = await this.deps.document.read()
        const keyOf = new Map(
            (contents.sync?.members ?? []).map((m) => [
                m.participantId,
                fromB64(m.encryptionPublicKey)
            ])
        )
        let count = 0
        for (const [senderId, idSet] of confirm) {
            const key = keyOf.get(senderId)
            if (!key) continue
            const ids = [...idSet]
            for (let i = 0; i < ids.length; i += MAX_RECEIPT_IDS) {
                const receiptId = this.deps.newId()
                const env = this.envelope(
                    'receipt.delivered',
                    senderId,
                    receiptId,
                    0,
                    documentClock(contents),
                    this.deps.now(),
                    { ids: ids.slice(i, i + MAX_RECEIPT_IDS) }
                )
                const fileName = `${receiptId}.${EXTENSION.receipt}`
                try {
                    const sealed = await sealEvent(
                        env,
                        new Uint8Array(),
                        (d) => this.deps.keys.sign(d),
                        key
                    )
                    await this.deps.transport.publish(this.inbox(senderId), fileName, sealed)
                    this.state.data.ownReceipts.push({
                        recipientId: senderId,
                        fileName,
                        writtenAt: this.deps.now()
                    })
                    count++
                } catch (err) {
                    this.noteWriteError(err)
                    // the sender writes the copy again later (D-29) and this member confirms it then
                    this.deps.log?.(`receipt to ${senderId} failed: ${(err as Error).message}`)
                }
            }
        }
        return count
    }

    // --- views ------------------------------------------------------------------------------------------------

    /** Messages that are still loading, for the window (D-30, D-37). */
    loadingMessages(): Promise<LoadingMessage[]> {
        return this.serial(async () => {
            const out: LoadingMessage[] = []
            for (const l of Object.values(this.state.data.loading)) {
                const received = this.partsOf(l.senderId, l.payload)
                let content: RichDoc | null = l.payload.message.content ?? null
                if (!content) {
                    const contentParts = l.payload.parts.filter((p) => p.kind === 'content')
                    if (contentParts.every((p) => received.has(p.partId))) {
                        const parts = new Map<string, Uint8Array>()
                        for (const p of contentParts) {
                            const d = await this.state.readInPart(l.senderId, p.partId)
                            if (d) parts.set(p.partId, d)
                        }
                        try {
                            content = joinContent(l.payload, parts)
                        } catch {
                            content = null
                        }
                    }
                }
                out.push(loadingMessage(l.senderId, l.clock, l.payload, received, content))
            }
            return out
        })
    }

    /** IDs of the parts of a message that this member has received from the message's sender. */
    private partsOf(senderId: string, payload: MessageSentPayload): Set<string> {
        return new Set(
            payload.parts
                .filter((p) => this.state.hasInPart(senderId, p.partId))
                .map((p) => p.partId)
        )
    }

    /**
     * Delivery of own messages (D-09, FR-169), stored only on this computer: "written" when the header and all parts
     * are in the shared folder, "delivered" when the recipient confirmed all of them.
     */
    deliveries(): Record<string, MessageDelivery> {
        const byMessage = new Map<string, Map<string, OutboxItem[]>>()
        for (const item of this.state.data.outbox) {
            if (!item.messageId || (item.kind !== 'event' && item.kind !== 'part')) continue
            const perMember = byMessage.get(item.messageId) ?? new Map<string, OutboxItem[]>()
            perMember.set(item.recipientId, [...(perMember.get(item.recipientId) ?? []), item])
            byMessage.set(item.messageId, perMember)
        }
        const rank: Record<CopyState, number> = { pending: 0, written: 1, delivered: 2 }
        const out: Record<string, MessageDelivery> = {}
        for (const [messageId, perMember] of byMessage) {
            const members: Record<string, CopyState> = {}
            for (const [recipientId, items] of perMember)
                members[recipientId] = items.every((i) => i.deliveredAt)
                    ? 'delivered'
                    : items.every((i) => i.writtenAt)
                      ? 'written'
                      : 'pending'
            const states = Object.values(members)
            const state = states.reduce<CopyState>(
                (min, s) => (rank[s] < rank[min] ? s : min),
                'delivered'
            )
            out[messageId] = { state, members }
        }
        return out
    }

    health(): SyncHealth {
        return {
            folder: this.folder,
            quarantined: this.state.data.quarantine.length,
            needsUpdate: this.needsUpdate,
            lastScanAt: this.state.data.lastScanAt
        }
    }

    /** Files that wait for a newer app version (section 10). */
    get needsUpdate(): boolean {
        return this.state.data.needsUpdate.some((n) => n.appVersion === this.deps.appVersion)
    }
}

const eventKey = (e: VerifiedEvent): string => `${e.senderId}:${e.eventId}`
/** File in the parts store for the bytes of a complete image that waits (no ':' in Windows file names). */
const imageFile = (assetId: string): string => `image-${assetId}`
