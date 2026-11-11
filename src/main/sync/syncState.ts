import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import type { Envelope } from '@shared/sync'
import type { VerifiedEvent } from '@shared/sync'
import { writeFileAtomically } from '../document/atomicWrite'

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
        lastScanAt: null
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
                } as StateData
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

    async save(): Promise<void> {
        const text = JSON.stringify(this.data)
        await writeFileAtomically(join(this.dir, 'state.json'), (tmp) =>
            fs.writeFile(tmp, text, 'utf8')
        )
    }
}
