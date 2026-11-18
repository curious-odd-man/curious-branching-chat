import { applyAll, isComplete, type MessageSentPayload, type VerifiedEvent } from '@shared/sync'
import { compareMessages, type RichDoc } from '@shared/validation'
import { PartsError, joinContent, joinImage } from '../crypto/parts'
import type { SharedEntry, SharedFolder } from '../transport/folderTransport'
import { type ScanReport, eventKey, imageFile } from './syncTypes'
import type { SyncCore } from './syncCore'

/**
 * Applying events (sync-protocol.md 9.3): the pending queue, messages that load in parts, held files, and the report
 * of arrived messages.
 */
export class EventProcessor {
    /** IDs of messages of others that the running scan applied (for notifications). */
    private arrived = new Set<string>()

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

    noteArrived(event: VerifiedEvent): void {
        if (event.type !== 'message.sent' || event.senderId === this.deps.ownId) return
        this.arrived.add((event.payload as MessageSentPayload).message.messageId)
    }

    async reportArrived(): Promise<void> {
        if (this.arrived.size === 0) return
        const ids = this.arrived
        this.arrived = new Set()
        if (!this.deps.onNewMessages) return
        const contents = await this.deps.document.read()
        const messages = contents.discussion.threads
            .flatMap((t) => t.messages)
            .filter((m) => ids.has(m.messageId) && m.authorId !== this.deps.ownId)
            .sort(compareMessages)
        if (messages.length > 0) this.deps.onNewMessages(messages, contents)
    }

    /** Applies everything in the pending queue that can be applied now (section 9.3). */
    async drainPending(
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
            for (const a of r.applied) this.noteArrived(a.event)
            this.state.setPending(r.pending)
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
    rejectHeld(rejected: ReadonlyArray<{ key: string; reason: string }>): void {
        for (const { key, reason } of rejected) {
            this.deps.log?.(`rejected ${key}: ${reason}`)
            for (const [name, h] of Object.entries(this.state.data.held)) {
                if (h.key !== key) continue
                this.state.quarantine(name, reason, this.deps.now())
            }
        }
    }

    /** Releases held files of processed events: confirm them and delete them. */
    finishHeld(keys: string[], confirm: Map<string, Set<string>>, toDelete: SharedEntry[]): void {
        const done = new Set(keys)
        for (const [name, h] of Object.entries(this.state.data.held)) {
            if (!done.has(h.key)) continue
            this.state.markProcessed(h.key)
            this.core.reader.addConfirm(confirm, h.senderId, h.receiptId)
            toDelete.push({
                folder: this.inbox(this.deps.ownId),
                name,
                id: h.receiptId,
                extension: 'bcmsg',
                size: 0,
                mtimeMs: 0
            })
            this.state.release(name)
        }
    }

    /** Messages whose parts are all present: join, check, and apply them (D-30). */
    async completeLoading(
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
                this.state.stopLoading(messageId)
                for (const [name, h] of Object.entries(s.held))
                    if (h.key === key) {
                        this.state.quarantine(name, err.message, this.deps.now())
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
            this.state.stopLoading(messageId)
            await this.state.dropInParts(
                l.senderId,
                l.payload.parts.map((p) => p.partId)
            )
            await this.applyComplete(event, images, confirm, toDelete, report)
        }
    }

    async applyComplete(
        event: VerifiedEvent,
        images: Array<{ assetId: string; data: Uint8Array }>,
        confirm: Map<string, Set<string>>,
        toDelete: SharedEntry[],
        report: ScanReport
    ): Promise<void> {
        let status = ''
        let reason = ''
        await this.deps.document.update((contents) => {
            const r = applyAll(contents, [event])
            if (r.applied.length > 0) {
                status = 'applied'
                this.noteArrived(event)
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
            this.state.addPending(event)
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

    /** IDs of the parts of a message that this member has received from the message's sender. */
    partsOf(senderId: string, payload: MessageSentPayload): Set<string> {
        return new Set(
            payload.parts
                .filter((p) => this.state.hasInPart(senderId, p.partId))
                .map((p) => p.partId)
        )
    }
}
