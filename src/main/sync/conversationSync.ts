import {
    SYNC_PROTOCOL_VERSION,
    documentClock,
    normalizeSynced,
    withReplacedKeys,
    type NewMemberKeys,
    loadingMessage,
    partRanges,
    type LoadingMessage,
    type LocalEvent,
    FILE_SIZE_LIMIT_MB
} from '@shared/sync'
import type { DocumentContents, RichDoc, RosterMember } from '@shared/validation'
import { sha256Hex } from '../crypto/envelope'
import { fromB64 } from '../crypto/identity'
import { joinContent } from '../crypto/parts'
import type { SharedFolder } from '../transport/folderTransport'
import type { OutboxItem, SyncState } from './syncState'
import {
    type ConversationSyncDeps,
    type SyncHealth,
    type CopyState,
    type MessageDelivery,
    type MaintenanceReport,
    type ScanReport,
    EXTENSION
} from './syncTypes'
import { SyncCore } from './syncCore'

export * from './syncTypes'

/**
 * Sync of one conversation (design sections 13 to 18, sync-protocol.md section 9): outbox, inbox processing,
 * receipts, cleanup. One operation at a time; the state is saved after each operation. The work is done by the units
 * of `SyncCore` (sending, inbox reading, event processing, attachment loading); this class keeps the order of
 * operations and the public interface.
 */
export class ConversationSync {
    private chain: Promise<unknown> = Promise.resolve()

    private readonly core: SyncCore

    constructor(private readonly deps: ConversationSyncDeps) {
        this.core = new SyncCore(deps)
    }

    private get state(): SyncState {
        return this.deps.state
    }

    private inbox(participantId: string): SharedFolder {
        return this.core.inbox(participantId)
    }

    /** Waits until the running operation is finished (no new one starts by itself after `stop` of the service). */
    async idle(): Promise<void> {
        await this.chain
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
            await this.core.sender.flushUnlocked()
            await this.core.sender.deliverUnlocked()
            await this.core.sender.maintainUnlocked()
            await this.core.sender.announceLimitsUnlocked()
            await this.state.save()
        })
    }

    /** FR-268: tells the other members the own file size limit (after a change of the setting). */
    announceLimits(): Promise<void> {
        return this.serial(async () => {
            await this.core.sender.announceLimitsUnlocked()
            await this.state.save()
        })
    }

    /**
     * FR-268: the other members whose file size limit is smaller than `bytes` (an attachment), with the limit; a
     * member without a known value counts with the default (30 MB).
     */
    async receiversBelow(
        bytes: number
    ): Promise<Array<{ participantId: string; maxFileMb: number }>> {
        const contents = await this.deps.document.read()
        const out: Array<{ participantId: string; maxFileMb: number }> = []
        for (const m of contents.sync?.members ?? []) {
            if (m.participantId === this.deps.ownId) continue
            const mb =
                this.state.data.peerLimits[m.participantId]?.maxFileMb ?? FILE_SIZE_LIMIT_MB.default
            if (mb * 1024 * 1024 < bytes)
                out.push({ participantId: m.participantId, maxFileMb: mb })
        }
        return out
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
            for (const e of events) await this.core.sender.enqueue(e, recipients)
            await this.state.save()
            await this.core.sender.flushUnlocked()
            await this.state.save()
        })
    }

    /**
     * Invites one member (sync-protocol.md 7.10): the snapshot is the complete `.branchchat` file, split into parts.
     * Header and parts are encrypted to the invitee and signed by this member. Returns the invitation ID.
     */
    /**
     * D-13, FR-176: this member adds new members to the roster and tells every earlier member with `member.added`.
     * The new members get the discussion through an invitation (the caller sends it after this). Returns the
     * discussion with the new roster.
     */
    addMembers(members: readonly RosterMember[]): Promise<DocumentContents> {
        return this.serial(async () => {
            const before = await this.deps.document.read()
            const sync = before.sync
            if (!sync) throw new Error('not a synchronized discussion')
            const known = new Set(sync.members.map((m) => m.participantId))
            const fresh = members.filter((m) => !known.has(m.participantId))
            if (fresh.length === 0) return before
            const earlier = sync.members
                .map((m) => m.participantId)
                .filter((id) => id !== this.deps.ownId)
            const createdAt = this.deps.now()
            for (const m of fresh)
                await this.core.sender.enqueue(
                    {
                        type: 'member.added',
                        payload: { member: { ...m, addedBy: this.deps.ownId } },
                        clock: documentClock(before),
                        createdAt
                    },
                    earlier
                )
            // the event is stored before the document changes (as in deliverUnlocked)
            await this.state.save()
            let after = before
            await this.deps.document.update((c) => {
                const s = c.sync!
                const ids = new Set(s.members.map((m) => m.participantId))
                const add = fresh.filter((m) => !ids.has(m.participantId))
                if (add.length === 0) return null
                const next = normalizeSynced({
                    ...c,
                    sync: {
                        ...s,
                        members: [...s.members, ...add].sort((a, b) =>
                            a.participantId < b.participantId
                                ? -1
                                : a.participantId > b.participantId
                                  ? 1
                                  : 0
                        )
                    }
                })
                after = next
                return { contents: next, images: [] }
            })
            await this.core.sender.flushUnlocked()
            await this.core.sender.announceLimitsUnlocked()
            await this.state.save()
            this.deps.onChange?.()
            return after
        })
    }

    /**
     * D-15, FR-177: this member re-invites a person who lost the keys. The roster gets the new keys (the old ones go to
     * `previousKeys`), every other member gets `member.keys.replaced` and must accept it, and own copies for the person
     * that have no receipt are sealed again with the new key. The caller sends the re-invitation after this.
     */
    replaceKeys(participantId: string, keys: NewMemberKeys): Promise<DocumentContents> {
        return this.serial(async () => {
            const before = await this.deps.document.read()
            const member = before.sync?.members.find((m) => m.participantId === participantId)
            if (!member || participantId === this.deps.ownId) throw new Error('not another member')
            if (member.fingerprint === keys.fingerprint) return before
            const others = (before.sync?.members ?? [])
                .map((m) => m.participantId)
                .filter((id) => id !== this.deps.ownId && id !== participantId)
            const createdAt = this.deps.now()
            await this.core.sender.enqueue(
                {
                    type: 'member.keys.replaced',
                    payload: { participantId, ...keys },
                    clock: documentClock(before),
                    createdAt
                },
                others
            )
            await this.state.save()
            const after = await this.useKeys(participantId, keys, createdAt)
            await this.core.sender.flushUnlocked()
            await this.state.save()
            this.deps.onChange?.()
            return after
        })
    }

    /** The roster takes the new keys, and own copies for the member without a receipt are sealed again. */
    private async useKeys(
        participantId: string,
        keys: NewMemberKeys,
        replacedAt: string
    ): Promise<DocumentContents> {
        let after: DocumentContents | null = null
        await this.deps.document.update((c) => {
            const next = withReplacedKeys(c, participantId, keys, replacedAt)
            if (next === c) return null
            after = next
            return { contents: next, images: [] }
        })
        const key = fromB64(keys.encryptionPublicKey)
        for (const item of this.state.data.outbox) {
            if ((item.memberId ?? item.recipientId) !== participantId) continue
            if (!item.writtenAt || item.deliveredAt || item.abandonedAt) continue
            // the person cannot open the copy sealed with the old key: write it again with the new one
            try {
                await this.core.sender.writeItem(item, key)
            } catch (err) {
                this.core.sender.noteWriteError(err)
            }
        }
        return after ?? (await this.deps.document.read())
    }

    /**
     * D-32: this member accepts or rejects the new keys of another member. A rejection keeps the old keys and can be
     * changed later by accepting.
     */
    decideKeys(participantId: string, accept: boolean): Promise<void> {
        return this.serial(async () => {
            const s = this.state.data
            const request = s.keyRequests.find((r) => r.participantId === participantId)
            if (!request) return
            if (!accept) this.state.rejectKeyRequest(request)
            else {
                await this.useKeys(
                    participantId,
                    {
                        signingPublicKey: request.signingPublicKey,
                        encryptionPublicKey: request.encryptionPublicKey,
                        fingerprint: request.fingerprint
                    },
                    request.createdAt
                )
                this.state.removeKeyRequest(request)
                // events of the person that waited for the key can be read now
                this.state.clearFailures()
            }
            await this.state.save()
            this.deps.onChange?.()
        })
    }

    /**
     * D-32: after a re-invitation this member uses its old ID with new keys. Files in the own inbox that the new key
     * cannot open were written for the old key: they are ignored (the invitation has the whole discussion).
     */
    startRejoin(inviterId: string): Promise<void> {
        return this.serial(async () => {
            const s = this.state.data
            for (const entry of await this.deps.transport.list(this.inbox(this.deps.ownId))) {
                if (s.keptFiles.includes(entry.name)) continue
                const opens = await this.deps.transport
                    .read(entry.folder, entry.name, this.deps.maxFileBytes())
                    .then(async (bytes) => (await this.deps.keys.open(bytes)) !== null)
                    .catch(() => false)
                if (!opens) this.state.keepFile(entry.name)
            }
            this.state.startRejoin(this.deps.now(), inviterId)
            await this.state.save()
        })
    }

    /**
     * Sends the discussion to a new member (design 12.2). With `rejoin` (D-15), the member keeps the old ID
     * (`memberId`), but the person still uses the new ID: the files go to the inbox of that ID and name it as the
     * recipient; the roster key of the member (already the new key) seals them.
     */
    invite(
        recipientId: string,
        snapshot: Uint8Array,
        contents: DocumentContents,
        rejoin?: { inboxId: string }
    ): Promise<string> {
        const memberId = recipientId
        const replacesKeysOf = rejoin ? memberId : undefined
        recipientId = rejoin?.inboxId ?? recipientId
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
            this.state.queue({
                id: invitationId,
                kind: 'invitation',
                recipientId,
                fileName: `${invitationId}.${EXTENSION.invitation}`,
                envelope: this.core.sender.envelope(
                    'invitation',
                    recipientId,
                    invitationId,
                    seq,
                    clock,
                    createdAt,
                    {
                        invitationId,
                        minProtocolVersion: SYNC_PROTOCOL_VERSION,
                        ...(replacesKeysOf ? { replacesKeysOf } : {}),
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
                lastWriteAt: null,
                ...(rejoin ? { memberId } : {})
            })
            for (const p of parts) {
                const file = await this.state.storeOutPart(p.partId, p.data)
                this.state.queue({
                    id: p.partId,
                    kind: 'invitation.part',
                    recipientId,
                    fileName: `${p.partId}.${EXTENSION['invitation.part']}`,
                    envelope: this.core.sender.envelope(
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
                    lastWriteAt: null,
                    ...(rejoin ? { memberId } : {})
                })
            }
            await this.state.save()
            await this.core.sender.flushUnlocked()
            await this.state.save()
            return invitationId
        })
    }

    /** "joined" when the invitee confirmed the invitation (design 12.3, step 8). */
    invitationStatus(): Record<string, 'invited' | 'joined'> {
        const out: Record<string, 'invited' | 'joined'> = {}
        for (const item of this.state.data.outbox) {
            if (item.kind !== 'invitation') continue
            // the latest invitation of a member decides (a re-invitation comes after the first one)
            out[item.memberId ?? item.recipientId] = item.deliveredAt ? 'joined' : 'invited'
        }
        return out
    }

    /** After an import: confirm the invitation to the inviter and remove its files from the own inbox. */
    confirmInvitation(
        inviterId: string,
        ids: readonly string[],
        fileNames: readonly string[],
        inboxId: string = this.deps.ownId
    ): Promise<void> {
        return this.serial(async () => {
            await this.core.sender.sendReceipts(new Map([[inviterId, new Set(ids)]]))
            for (const name of fileNames) {
                const r = await this.deps.transport.delete(this.inbox(inboxId), name)
                // a file left in another inbox (a re-invitation) is not this inbox's business
                if (r === 'failed' && inboxId === this.deps.ownId) this.state.keepFile(name)
            }
            await this.state.save()
        })
    }

    /** Writes every copy that is not written yet. A failed write is retried at the next flush with the same ID. */
    flush(): Promise<void> {
        return this.serial(async () => {
            await this.core.sender.flushUnlocked()
            await this.state.save()
        })
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
            const r = await this.core.sender.maintainUnlocked()
            await this.state.save()
            this.deps.onChange?.()
            return r
        })
    }

    // --- incoming ---------------------------------------------------------------------------------------------

    /** Reads the own inbox once (design section 15). Watch events and timers only call this. */
    scan(): Promise<ScanReport> {
        return this.serial(() => this.core.reader.scanUnlocked())
    }

    // --- views ------------------------------------------------------------------------------------------------

    /** Messages that are still loading, for the window (D-30, D-37). */
    loadingMessages(): Promise<LoadingMessage[]> {
        return this.serial(async () => {
            const out: LoadingMessage[] = []
            for (const l of Object.values(this.state.data.loading)) {
                const received = this.core.events.partsOf(l.senderId, l.payload)
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
            folder: this.core.folder,
            quarantined: this.state.data.quarantine.length,
            needsUpdate: this.needsUpdate,
            lastScanAt: this.state.data.lastScanAt,
            keyRequests: this.state.data.keyRequests.map((r) => ({
                participantId: r.participantId,
                fingerprint: r.fingerprint,
                state: r.state
            })),
            rejoinHeardFrom: this.state.data.rejoin?.heardFrom ?? null
        }
    }

    /** Files that wait for a newer app version (section 10). */
    get needsUpdate(): boolean {
        return this.state.data.needsUpdate.some((n) => n.appVersion === this.deps.appVersion)
    }
}
