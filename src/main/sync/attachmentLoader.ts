import type { MessageAttachmentsPayload, VerifiedEvent } from '@shared/sync'
import { sha256Hex } from '../crypto/envelope'
import { UNCONFIRMED_MAX_AGE_MS } from './syncTypes'
import type { SyncCore } from './syncCore'

/** Attachments of others (FR-261, FR-268a): loads per file, joining and checking the parts, storing the bytes. */
export class AttachmentLoader {
    constructor(private readonly core: SyncCore) {}

    private get deps(): SyncCore['deps'] {
        return this.core.deps
    }

    private get state(): SyncCore['state'] {
        return this.core.state
    }

    /** The files of a message of another member start loading (their parts may come in any order). */
    async noteAttachments(event: VerifiedEvent): Promise<void> {
        const p = event.payload as MessageAttachmentsPayload
        for (const a of p.attachments) {
            const have = (await this.deps.document.hasBlob?.(a.sha256)) ?? false
            this.state.addAttachmentLoad({
                senderId: event.senderId,
                messageId: p.messageId,
                sha256: a.sha256,
                size: a.size,
                type: a.type,
                parts: a.parts.map((x) => ({ ...x })),
                done: have,
                at: this.deps.now()
            })
        }
    }

    /** Attachments whose parts are all here: joined, checked against size and hash, and stored (FR-266). */
    async completeAttachments(): Promise<void> {
        const s = this.state.data
        let stored = false
        for (const load of s.attachmentLoads) {
            if (load.done) continue
            if (!load.parts.every((p) => this.state.hasInPart(load.senderId, p.partId))) continue
            const chunks: Uint8Array[] = []
            for (const p of [...load.parts].sort((a, b) => a.index - b.index)) {
                const data = await this.state.readInPart(load.senderId, p.partId)
                if (data) chunks.push(data)
            }
            const data = Buffer.concat(chunks)
            this.state.finishAttachmentLoad(load)
            if (data.length === load.size && sha256Hex(data) === load.sha256) {
                await this.deps.document.storeBlob?.(load.sha256, data, load.type)
                stored = true
            } else
                this.deps.log?.(
                    `attachment ${load.sha256} of ${load.messageId}: bytes do not match`
                )
            await this.state.dropInParts(
                load.senderId,
                load.parts.map((p) => p.partId)
            )
        }
        // a finished load is kept for 31 days, so late copies of its parts are confirmed (D-34: 30 days)
        const nowMs = Date.parse(this.deps.now())
        this.state.forgetAttachmentLoads(nowMs, UNCONFIRMED_MAX_AGE_MS + 24 * 60 * 60_000)
        if (stored) this.deps.onAttachments?.()
    }
}
