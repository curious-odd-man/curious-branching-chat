import type { RichDoc } from '../validation/richText'
import { PART_SIZE, type MessageSentPayload, type PartEntry } from './schemas'

/**
 * A message whose header has arrived but some parts have not (D-30, D-37). It lives in the local sync state, not in
 * the discussion file, until all parts are present.
 */
export interface LoadingImage {
    assetId: string
    partsTotal: number
    partsReceived: number
    bytesTotal: number
    bytesReceived: number
}

export interface LoadingMessage {
    messageId: string
    threadId: string
    authorId: string
    authorDisplayName: string
    createdAt: string
    clock: number
    partsTotal: number
    partsReceived: number
    bytesTotal: number
    bytesReceived: number
    /** The text, once the content (inline or in parts) is present: shown as a partial message. */
    content: RichDoc | null
    images: LoadingImage[]
}

/** Progress of a loading message from its signed header and the IDs of the parts received so far. */
export function loadingMessage(
    senderId: string,
    clock: number,
    payload: MessageSentPayload,
    receivedPartIds: ReadonlySet<string>,
    assembledContent: RichDoc | null
): LoadingMessage {
    const got = (p: PartEntry): boolean => receivedPartIds.has(p.partId)
    const sum = (parts: readonly PartEntry[], pick: (p: PartEntry) => boolean): number =>
        parts.filter(pick).reduce((n, p) => n + p.size, 0)
    const images = payload.images.map((image) => {
        const parts = payload.parts.filter((p) => p.assetId === image.assetId)
        return {
            assetId: image.assetId,
            partsTotal: parts.length,
            partsReceived: parts.filter(got).length,
            bytesTotal: sum(parts, () => true),
            bytesReceived: sum(parts, got)
        }
    })
    return {
        messageId: payload.message.messageId,
        threadId: payload.message.threadId,
        authorId: senderId,
        authorDisplayName: payload.message.authorDisplayName,
        createdAt: payload.message.createdAt,
        clock,
        partsTotal: payload.parts.length,
        partsReceived: payload.parts.filter(got).length,
        bytesTotal: sum(payload.parts, () => true),
        bytesReceived: sum(payload.parts, got),
        content: payload.message.content ?? assembledContent,
        images
    }
}

/** True when every part listed in the header is present. */
export function isComplete(
    payload: MessageSentPayload,
    receivedPartIds: ReadonlySet<string>
): boolean {
    return payload.parts.every((p) => receivedPartIds.has(p.partId))
}

/** Byte ranges of the parts of a payload of `size` bytes (sync-protocol.md 7.1, 7.2). */
export function partRanges(
    size: number,
    partSize = PART_SIZE
): Array<{ index: number; start: number; end: number }> {
    if (!Number.isSafeInteger(size) || size <= 0)
        throw new Error('size must be a positive whole number')
    const ranges: Array<{ index: number; start: number; end: number }> = []
    for (let start = 0, index = 0; start < size; start += partSize, index++)
        ranges.push({ index, start, end: Math.min(size, start + partSize) })
    return ranges
}
