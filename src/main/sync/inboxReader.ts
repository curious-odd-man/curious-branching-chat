import {
    INCOMPLETE_FILE_GRACE_MINUTES,
    STABLE_FILE_SECONDS,
    type Envelope,
    type MessageSentPayload,
    type VerifiedEvent
} from '@shared/sync'
import { openEvent, type OpenedEvent } from '../crypto/envelope'
import { fromB64 } from '../crypto/identity'
import type { SharedEntry, SharedFolder } from '../transport/folderTransport'
import { type ScanReport, DOCUMENT_TYPES } from './syncTypes'
import type { SyncCore } from './syncCore'

/**
 * Reading the own inbox (design section 15, sync-protocol.md 9): stable files, open and check, quarantine, replay
 * protection, and the first handling of each event.
 */
export class InboxReader {
    /** First sight of a file: size, time, and when it was seen (sync-protocol.md 9.6). */
    private seen = new Map<string, { size: number; mtimeMs: number; at: number }>()

    private readonly stableMs: number

    constructor(private readonly core: SyncCore) {
        this.stableMs = core.deps.stableMs ?? STABLE_FILE_SECONDS * 1000
    }

    private get deps(): SyncCore['deps'] {
        return this.core.deps
    }

    private get state(): SyncCore['state'] {
        return this.core.state
    }

    private inbox(participantId: string): SharedFolder {
        return this.core.inbox(participantId)
    }

    async scanUnlocked(): Promise<ScanReport> {
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
            this.core.folder = 'missing'
            this.deps.onChange?.()
            return report
        }
        if (this.core.folder === 'missing') this.core.folder = 'ok'
        const entries = await this.deps.transport.list(this.inbox(this.deps.ownId))
        const present = new Set(entries.map((e) => e.name))
        // forget files that are gone (deleted by the sync product, or cleaned up)
        this.state.forgetMissingFiles(present)
        for (const name of [...this.seen.keys()]) if (!present.has(name)) this.seen.delete(name)

        const confirm = new Map<string, Set<string>>() // senderId -> IDs for the receipt
        const toDelete: SharedEntry[] = []
        const nowMs = Date.parse(this.deps.now())

        const limit = this.deps.maxFileBytes()
        // headers before parts, so a part finds its attachment in the same scan
        const ordered = [...entries].sort(
            (a, b) => Number(a.extension === 'bcpart') - Number(b.extension === 'bcpart')
        )
        for (const entry of ordered) {
            const deferred = s.deferred[entry.name]
            if (deferred !== undefined && deferred > limit) continue // FR-268a: until the limit is raised
            if (s.keptFiles.includes(entry.name) || s.held[entry.name]) continue
            if (s.quarantine.some((q) => q.name === entry.name)) continue
            if (entry.extension === 'bcinv' || entry.extension === 'bckey') continue // the join wizard reads these
            const update = s.needsUpdate.find((n) => n.name === entry.name)
            if (update && update.appVersion === this.deps.appVersion) continue
            if (!this.isStable(entry, nowMs)) continue
            await this.processFile(entry, nowMs, report, confirm, toDelete)
        }

        // events that waited for a dependency may apply now
        report.applied += await this.core.events.drainPending(confirm, toDelete)
        await this.core.events.completeLoading(confirm, toDelete, report)
        await this.core.loader.completeAttachments()

        await this.core.sender.deliverUnlocked()
        report.receipts += await this.core.sender.sendReceipts(confirm)
        for (const entry of toDelete) {
            const r = await this.deps.transport.delete(entry.folder, entry.name)
            // D-19: if the sync product refuses, remember the file as processed and ignore it from now on
            if (r === 'failed') this.state.keepFile(entry.name)
        }
        this.state.scanned(this.deps.now())
        report.held = Object.keys(s.held).length
        await this.core.sender.announceLimitsUnlocked() // a new member (member.added) gets the own limit
        await this.state.save()
        this.deps.onChange?.()
        await this.core.events.reportArrived()
        return report
    }

    isStable(entry: SharedEntry, nowMs: number): boolean {
        if (this.stableMs === 0) return true
        const prev = this.seen.get(entry.name)
        if (!prev || prev.size !== entry.size || prev.mtimeMs !== entry.mtimeMs) {
            this.seen.set(entry.name, { size: entry.size, mtimeMs: entry.mtimeMs, at: nowMs })
            return false
        }
        return nowMs - prev.at >= this.stableMs
    }

    quarantine(entry: SharedEntry, reason: string, report: ScanReport): void {
        this.state.quarantine(entry.name, reason, this.deps.now())
        report.quarantined++
        this.deps.log?.(`quarantined ${entry.name}: ${reason}`)
    }

    notOpened(entry: SharedEntry, nowMs: number, reason: string, report: ScanReport): void {
        const s = this.state.data
        const f = s.failures[entry.name]
        if (!f || f.size !== entry.size || f.mtimeMs !== entry.mtimeMs) {
            this.state.noteFailure(entry.name, {
                size: entry.size,
                mtimeMs: entry.mtimeMs,
                since: this.deps.now()
            })
            return
        }
        // section 9.6: only a file that stays the same and still fails for the grace time is quarantined
        if (
            (reason === 'unopened' || reason === 'bad-signature') &&
            nowMs - Date.parse(f.since) >= INCOMPLETE_FILE_GRACE_MINUTES * 60_000
        )
            this.quarantine(
                entry,
                reason === 'bad-signature' ? 'signature is not valid' : 'does not open',
                report
            )
    }

    async processFile(
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
        if (opened.status === 'invalid') {
            // D-32: a member with new keys that this member has not accepted (yet): the file waits, and while a
            // request exists it is never quarantined; without one, it waits for the grace time (the request can come
            // later than the person's first files)
            if (opened.senderId && opened.reason === 'signature is not valid') {
                if (this.state.data.keyRequests.some((r) => r.participantId === opened.senderId))
                    return
                return this.notOpened(entry, nowMs, 'bad-signature', report)
            }
            return this.quarantine(entry, opened.reason, report)
        }
        this.state.clearFailure(entry.name)
        if (opened.status === 'needs-update') {
            this.markNeedsUpdate(entry, report)
            return
        }

        const env = opened.envelope
        this.state.peerSeen(env.senderId, this.deps.now())
        // D-32: an event that opened with the new key shows that its sender accepted it
        if (this.state.heardAfterRejoin(env.senderId)) this.deps.onChange?.()

        if (env.type === 'receipt.delivered') {
            await this.core.sender.applyReceipt(env as Envelope<'receipt.delivered'>)
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

        const isPart = env.type === 'message.part' || env.type === 'attachment.part'
        const receiptId = isPart ? (env.payload as { partId: string }).partId : env.eventId
        const key = isPart ? `part:${env.senderId}:${receiptId}` : `${env.senderId}:${env.eventId}`
        if (this.state.isProcessed(key)) {
            this.addConfirm(confirm, env.senderId, receiptId)
            toDelete.push(entry)
            return
        }

        if (env.type === 'member.keys.replaced') {
            await this.keyRequest(env as Envelope<'member.keys.replaced'>)
            this.state.markProcessed(key)
            this.addConfirm(confirm, env.senderId, receiptId)
            toDelete.push(entry)
            this.deps.onChange?.()
            return
        }

        if (env.type === 'member.limits.set') {
            const p = env.payload as { maxFileMb: number }
            this.state.recordPeerLimit(env.senderId, p.maxFileMb, env.senderSeq)
            this.state.markProcessed(key)
            this.addConfirm(confirm, env.senderId, receiptId)
            toDelete.push(entry)
            return
        }

        if (env.type === 'attachment.part') {
            const load = this.state.data.attachmentLoads.find(
                (l) => l.senderId === env.senderId && l.parts.some((x) => x.partId === receiptId)
            )
            if (!load) {
                // the list of files has not arrived yet: the part waits in the inbox (no receipt)
                return
            }
            const part = load.parts.find((x) => x.partId === receiptId)!
            if (part.sha256 !== env.payloadSha256 || part.size !== opened.payload.length)
                return this.quarantine(entry, 'part does not match its attachment', report)
            if (!load.done && load.size > this.deps.maxFileBytes()) {
                // FR-268a: larger than this member's limit; read when the limit is raised (until the sender gives up)
                this.state.defer(entry.name, load.size)
                return
            }
            this.state.undefer(entry.name)
            if (!load.done) await this.state.storeInPart(env.senderId, receiptId, opened.payload)
            this.state.markProcessed(key)
            this.addConfirm(confirm, env.senderId, receiptId)
            toDelete.push(entry)
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
        }
        this.state.hold(entry.name, { key, senderId: env.senderId, receiptId })

        if (event.type === 'message.attachments') await this.core.loader.noteAttachments(event)

        if (
            event.type === 'message.sent' &&
            (event.payload as MessageSentPayload).parts.length > 0
        ) {
            const payload = event.payload as MessageSentPayload
            this.state.startLoading(payload.message.messageId, {
                eventId: event.eventId,
                senderId: event.senderId,
                clock: event.clock,
                createdAt: event.createdAt,
                payload
            })
            return // completeLoading applies it when all parts are present
        }
        this.state.addPending(event)
    }

    /** D-32: another member re-invited a person with new keys; this member decides (status line). */
    async keyRequest(env: Envelope<'member.keys.replaced'>): Promise<void> {
        const p = env.payload
        const s = this.state.data
        if (p.participantId === this.deps.ownId || p.participantId === env.senderId) return
        // the request is only kept while this copy has the person with other keys
        const contents = await this.deps.document.read()
        const member = contents.sync?.members.find((m) => m.participantId === p.participantId)
        if (!member || member.fingerprint === p.fingerprint) return
        const earlier = s.keyRequests.find((r) => r.participantId === p.participantId)
        if (earlier && Date.parse(earlier.createdAt) >= Date.parse(env.createdAt)) return
        this.state.putKeyRequest({
            participantId: p.participantId,
            signingPublicKey: p.signingPublicKey,
            encryptionPublicKey: p.encryptionPublicKey,
            fingerprint: p.fingerprint,
            requestedBy: env.senderId,
            createdAt: env.createdAt,
            state: 'pending'
        })
    }

    markNeedsUpdate(entry: SharedEntry, report: ScanReport): void {
        this.state.noteNeedsUpdate(entry.name, this.deps.appVersion)
        report.needsUpdate++
    }

    addConfirm(confirm: Map<string, Set<string>>, senderId: string, id: string): void {
        const set = confirm.get(senderId) ?? new Set<string>()
        set.add(id)
        confirm.set(senderId, set)
    }
}
