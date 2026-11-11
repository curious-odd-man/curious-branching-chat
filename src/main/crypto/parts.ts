import {
    MAX_INLINE_CONTENT_BYTES,
    PART_SIZE,
    canonicalJson,
    partRanges,
    type MessageSentPayload,
    type PartEntry
} from '@shared/sync'
import type { RichDoc } from '@shared/validation'
import { richDocSchema } from '@shared/validation'
import { sha256Hex } from './envelope'

/** One part file to send: its entry in the signed header and its bytes. */
export interface PlannedPart {
    entry: PartEntry
    data: Uint8Array
}

/**
 * Splits a message into header and parts (D-10, D-30; sync-protocol.md 7.1): every new image is sent as parts; the
 * content is inline when its canonical JSON is at most 3 MiB, otherwise it is sent as parts too.
 */
export function planMessageParts(
    draft: MessageSentPayload,
    imageBytes: ReadonlyMap<string, Uint8Array>,
    newId: () => string,
    partSize = PART_SIZE
): { payload: MessageSentPayload; parts: PlannedPart[] } {
    const content = draft.message.content
    if (!content) throw new Error('the draft must carry its content')
    const parts: PlannedPart[] = []
    const split = (data: Uint8Array, kind: PartEntry['kind'], assetId?: string): void => {
        for (const r of partRanges(data.length, partSize)) {
            const slice = data.subarray(r.start, r.end)
            parts.push({
                entry: {
                    partId: newId(),
                    kind,
                    ...(assetId ? { assetId } : {}),
                    index: r.index,
                    size: slice.length,
                    sha256: sha256Hex(slice)
                },
                data: slice
            })
        }
    }
    const contentBytes = new TextEncoder().encode(canonicalJson(content))
    const inline = contentBytes.length <= MAX_INLINE_CONTENT_BYTES
    if (!inline) split(contentBytes, 'content')
    for (const image of draft.images) {
        const data = imageBytes.get(image.assetId)
        if (!data) throw new Error(`bytes of image ${image.assetId} are missing`)
        if (sha256Hex(data) !== image.assetId || data.length !== image.size)
            throw new Error(`bytes of image ${image.assetId} do not match`)
        split(data, 'image', image.assetId)
    }
    const { content: _c, ...withoutContent } = draft.message
    return {
        payload: {
            ...draft,
            message: inline ? draft.message : withoutContent,
            parts: parts.map((p) => p.entry)
        },
        parts
    }
}

export class PartsError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'PartsError'
    }
}

/** Joins the parts of one group in index order and checks every part and the total (sync-protocol.md 7.1). */
export function joinParts(
    entries: readonly PartEntry[],
    received: ReadonlyMap<string, Uint8Array>
): Uint8Array {
    const sorted = [...entries].sort((a, b) => a.index - b.index)
    const total = sorted.reduce((n, p) => n + p.size, 0)
    const out = new Uint8Array(total)
    let offset = 0
    for (const p of sorted) {
        const data = received.get(p.partId)
        if (!data) throw new PartsError(`part ${p.partId} is missing`)
        if (data.length !== p.size || sha256Hex(data) !== p.sha256)
            throw new PartsError(`part ${p.partId} does not match its header`)
        out.set(data, offset)
        offset += data.length
    }
    return out
}

/** Content of a message whose content travelled as parts. */
export function joinContent(
    payload: MessageSentPayload,
    received: ReadonlyMap<string, Uint8Array>
): RichDoc {
    const bytes = joinParts(
        payload.parts.filter((p) => p.kind === 'content'),
        received
    )
    let value: unknown
    try {
        value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch {
        throw new PartsError('content parts are not valid JSON')
    }
    const parsed = richDocSchema.safeParse(value)
    if (!parsed.success) throw new PartsError('content parts are not valid rich text')
    return parsed.data
}

/** Bytes of one image; their SHA-256 must be the asset ID (FR-131). */
export function joinImage(
    payload: MessageSentPayload,
    assetId: string,
    received: ReadonlyMap<string, Uint8Array>
): Uint8Array {
    const bytes = joinParts(
        payload.parts.filter((p) => p.kind === 'image' && p.assetId === assetId),
        received
    )
    if (sha256Hex(bytes) !== assetId) throw new PartsError(`image ${assetId} does not match its ID`)
    return bytes
}
