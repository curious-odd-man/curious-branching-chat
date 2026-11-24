import {
    MAX_RECEIPT_IDS,
    SYNC_PROTOCOL_VERSION,
    documentClock,
    addOwnDelivery,
    missingOwnDelivery,
    partRanges,
    type Envelope,
    type EventType,
    type OutgoingEvent,
    type MessageAttachmentsPayload,
    FILE_SIZE_LIMIT_MB,
    MAX_READ_IDS_PER_EVENT
} from '@shared/sync'
import { sealEvent, sha256Hex } from '../crypto/envelope'
import { fromB64 } from '../crypto/identity'
import { planMessageParts } from '../crypto/parts'
import type { OutboxItem } from './syncState'
import {
    RECEIPT_MAX_AGE_MS,
    UNCONFIRMED_MAX_AGE_MS,
    type MaintenanceReport,
    EXTENSION
} from './syncTypes'
import type { SharedFolder } from '../transport/folderTransport'
import type { SyncCore } from './syncCore'

/**
 * Sending (design sections 13, 14, 16): envelopes, the outbox with parts, writing, retries, receipts, cleanup, the own
 * file size limit (FR-268).
 */
export class SyncSender {
    constructor(private readonly core: SyncCore) {}

    private get deps(): SyncCore['deps'] {
        return this.core.deps
    }

    private get state(): SyncCore['state'] {
        return this.core.state
    }

    private inbox(participantId: string): SharedFolder {
        return this.core.inbox(participantId)
    }

    ownLimitMb(): number {
        const mb = Math.round(this.deps.maxFileBytes() / (1024 * 1024))
        return Math.min(FILE_SIZE_LIMIT_MB.max, Math.max(FILE_SIZE_LIMIT_MB.min, mb))
    }

    /**
     * FR-268: each other member learns the own limit with `member.limits.set`: after a change, after joining, and for
     * a new member. A member that has not got a value counts with the default (30 MB), so the default is not sent:
     * a discussion where nobody changed the setting gets no new event type (older versions ask for an update).
     */
    async announceLimitsUnlocked(): Promise<void> {
        const s = this.state.data
        const contents = await this.deps.document.read()
        const mb = this.ownLimitMb()
        const targets = (contents.sync?.members ?? [])
            .map((m) => m.participantId)
            .filter(
                (id) =>
                    id !== this.deps.ownId &&
                    (s.limitsSent[id] ?? FILE_SIZE_LIMIT_MB.default) !== mb
            )
        if (targets.length === 0) return
        await this.enqueue(
            {
                type: 'member.limits.set',
                payload: { maxFileMb: mb },
                clock: documentClock(contents),
                createdAt: this.deps.now()
            },
            targets
        )
        for (const id of targets) this.state.limitSent(id, mb)
        await this.state.save()
        await this.flushUnlocked()
    }

    /**
     * D-41: every message of another author that is in the own copy counts as received by this member; the other
     * members learn it from `delivery.added`. Covers new messages, the history of an invitation, and recovery.
     * The event is stored (and the state saved) before the document changes: after a crash between the two steps,
     * the next scan sends the same IDs again, which does no harm.
     */
    async deliverUnlocked(): Promise<void> {
        const contents = await this.deps.document.read()
        const missing = missingOwnDelivery(contents, this.deps.ownId)
        if (missing.length === 0) return
        const recipients = (contents.sync?.members ?? [])
            .map((m) => m.participantId)
            .filter((id) => id !== this.deps.ownId)
        for (let i = 0; i < missing.length; i += MAX_READ_IDS_PER_EVENT)
            await this.enqueue(
                {
                    type: 'delivery.added',
                    payload: { messageIds: missing.slice(i, i + MAX_READ_IDS_PER_EVENT) },
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

    envelope(
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

    async enqueue(e: OutgoingEvent, recipients: readonly string[]): Promise<void> {
        if (recipients.length === 0) return
        const eventId = this.deps.newId()
        let payload: unknown = e.payload
        const parts: Array<{ partId: string; sha256: string; file: string }> = []
        if (e.type === 'message.sent') {
            const draft = e.payload
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
        // FR-261: the files of a message travel as `attachment.part` events (as images do as `message.part`)
        const attachmentParts: Array<{ partId: string; sha256: string; file: string }> = []
        if (e.type === 'message.attachments') {
            const draft = e.payload
            const attachments: MessageAttachmentsPayload['attachments'] = []
            for (const a of draft.attachments) {
                const data =
                    a.size === 0 ? new Uint8Array() : await this.deps.document.blobBytes?.(a.sha256)
                if (!data || data.length !== a.size)
                    throw new Error(`attachment ${a.sha256} is not available`)
                const entries: MessageAttachmentsPayload['attachments'][number]['parts'] = []
                for (const r of a.size === 0 ? [] : partRanges(a.size)) {
                    const bytes = data.subarray(r.start, r.end)
                    const partId = this.deps.newId()
                    const sha256 = sha256Hex(bytes)
                    entries.push({ partId, index: r.index, size: bytes.length, sha256 })
                    attachmentParts.push({
                        partId,
                        sha256,
                        file: await this.state.storeOutPart(partId, bytes)
                    })
                }
                attachments.push({ ...a, parts: entries })
            }
            payload = { messageId: draft.messageId, attachments }
        }
        const seq = this.state.nextSenderSeq()
        const messageId =
            e.type === 'message.sent'
                ? e.payload.message.messageId
                : e.type === 'message.attachments'
                  ? e.payload.messageId
                  : undefined
        for (const r of recipients)
            this.state.queue({
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
                this.state.queue({
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
        // attachment parts do not count for the delivery mark of the message: a member with a smaller limit gets
        // the message but not the file (FR-268a)
        for (const p of attachmentParts) {
            const partSeq = this.state.nextSenderSeq()
            const partEventId = this.deps.newId()
            for (const r of recipients)
                this.state.queue({
                    id: p.partId,
                    kind: 'part',
                    recipientId: r,
                    fileName: `${p.partId}.${EXTENSION.part}`,
                    envelope: this.envelope(
                        'attachment.part',
                        r,
                        partEventId,
                        partSeq,
                        e.clock,
                        e.createdAt,
                        { messageId, partId: p.partId },
                        p.sha256
                    ),
                    payloadFile: p.file,
                    writtenAt: null,
                    deliveredAt: null,
                    lastWriteAt: null
                })
        }
    }

    async flushUnlocked(): Promise<void> {
        const contents = await this.deps.document.read()
        const keyOf = new Map(
            (contents.sync?.members ?? []).map((m) => [
                m.participantId,
                fromB64(m.encryptionPublicKey)
            ])
        )
        for (const item of this.state.data.outbox) {
            if (item.writtenAt) continue
            const key = keyOf.get(item.memberId ?? item.recipientId)
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
    noteWriteError(err: unknown): void {
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'EACCES' || code === 'EPERM') this.core.folder = 'no-permission'
        else if (code === 'ENOENT' || code === 'ROOT_MISSING') this.core.folder = 'missing'
    }

    async maintainUnlocked(): Promise<MaintenanceReport> {
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
        const tooOld = s.outbox.filter(
            (item) =>
                item.writtenAt &&
                !item.deliveredAt &&
                !item.abandonedAt &&
                nowMs - Date.parse(item.writtenAt) >= UNCONFIRMED_MAX_AGE_MS
        )
        const abandoned = await this.deleteOwn(tooOld.map((i) => [i.recipientId, i.fileName]))
        for (const item of tooOld) {
            if (abandoned.get(item.fileName) === 'failed') continue // try again at the next maintenance
            item.abandonedAt = this.deps.now()
            report.abandoned++
        }
        for (const item of s.outbox) {
            if (!item.writtenAt || item.deliveredAt || item.abandonedAt) continue
            const activity = s.peers[item.memberId ?? item.recipientId]?.lastActivityAt
            const lastWrite = item.lastWriteAt ?? item.writtenAt
            if (!activity || Date.parse(activity) <= Date.parse(lastWrite)) continue
            const key = keyOf.get(item.memberId ?? item.recipientId)
            if (!key) continue
            try {
                await this.writeItem(item, key)
                report.rewritten++
            } catch (err) {
                this.noteWriteError(err)
            }
        }
        await this.dropDeliveredParts()

        const old = s.ownReceipts.filter(
            (r) => nowMs - Date.parse(r.writtenAt) >= RECEIPT_MAX_AGE_MS
        )
        const removed = await this.deleteOwn(old.map((r) => [r.recipientId, r.fileName]))
        const keep: typeof s.ownReceipts = []
        for (const r of s.ownReceipts) {
            if (!old.includes(r)) keep.push(r)
            else if (removed.get(r.fileName) === 'failed') keep.push(r)
            else report.receiptsDeleted++
        }
        this.state.setOwnReceipts(keep)
        return report
    }

    async writeItem(item: OutboxItem, recipientKey: Uint8Array): Promise<void> {
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
        this.state.written(item, this.deps.now())
        if (this.core.folder !== 'ok') this.core.folder = 'ok'
    }

    async applyReceipt(env: Envelope<'receipt.delivered'>): Promise<void> {
        const ids = new Set(env.payload.ids)
        const now = this.deps.now()
        const done: Array<[string, string]> = []
        for (const item of this.state.data.outbox) {
            if ((item.memberId ?? item.recipientId) !== env.senderId || !ids.has(item.id)) continue
            if (!item.deliveredAt) this.state.delivered(item, now)
            // also for a second receipt: the sync product brought back a delayed copy, which the recipient confirms
            done.push([item.recipientId, item.fileName])
        }
        // D-43: the writer deletes its own files after the receipt (the recipient never does)
        await this.deleteOwn(done)
        await this.dropDeliveredParts()
        this.deps.onChange?.()
    }

    /**
     * D-43: deletes own files (recipient ID, file name) from the inboxes of others, with the conflict copies that the
     * sync product made of them (`<id> (1).<ext>`). Only the writer deletes a file: on a My Drive folder, a member
     * who does not own a file cannot delete it; Google Drive moves it to the owner's My Drive root instead.
     */
    async deleteOwn(
        files: ReadonlyArray<readonly [recipientId: string, fileName: string]>
    ): Promise<Map<string, 'deleted' | 'missing' | 'failed'>> {
        const result = new Map<string, 'deleted' | 'missing' | 'failed'>()
        const byInbox = new Map<string, string[]>()
        for (const [recipientId, name] of files)
            byInbox.set(recipientId, [...(byInbox.get(recipientId) ?? []), name])
        for (const [recipientId, names] of byInbox) {
            const folder = this.inbox(recipientId)
            for (const name of names)
                result.set(name, await this.deps.transport.delete(folder, name))
            const own = new Set(names)
            // a folder that cannot be listed (a link, no permission): the copies stay until a later run
            const entries = await this.deps.transport.list(folder).catch(() => [])
            for (const entry of entries) {
                const original = `${entry.id}.${entry.extension}`
                if (entry.name !== original && own.has(original))
                    await this.deps.transport.delete(folder, entry.name)
            }
        }
        return result
    }

    async dropDeliveredParts(): Promise<void> {
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

    async sendReceipts(confirm: Map<string, Set<string>>): Promise<number> {
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
                    this.state.addOwnReceipt({
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
}
