import { z } from 'zod'
import { richDocSchema } from '../validation/richText'
import { IMAGE_MEDIA_TYPES } from '../validation/schemas'
import {
    SYNC_PROTOCOL_VERSION,
    fingerprintSchema,
    publicKeySchema,
    rosterMemberSchema
} from '../validation/roster'

/**
 * Wire schemas of the sync protocol, version 1 (docs/02-done/sync-protocol.md).
 * All objects are strict: an unknown key is refused. A new key needs a new protocol version (section 10).
 * Release 1.1 contains these schemas only; later releases send and apply the events.
 */

export { SYNC_PROTOCOL_VERSION }

/** Part payload size (4 MiB) and the largest inline content (3 MiB) (sections 7.1, 7.2). */
export const PART_SIZE = 4 * 1024 * 1024
export const MAX_INLINE_CONTENT_BYTES = 3 * 1024 * 1024
export const MAX_ENVELOPE_BYTES = 4 * 1024 * 1024
export const MAX_READ_IDS_PER_EVENT = 10_000
export const MAX_RECEIPT_IDS = 1_000

/**
 * A file in the shared root must keep the same size and modification time this long before it is read, and a file
 * that does not open is quarantined only after it stayed unchanged for the grace time (sync-protocol.md 9.6).
 */
export const STABLE_FILE_SECONDS = 2
export const INCOMPLETE_FILE_GRACE_MINUTES = 10

/** File size limit setting for shared-folder files, in MB (FR-166, D-11, D-30). */
export const FILE_SIZE_LIMIT_MB = { min: 5, max: 1000, default: 30 } as const

export const uuidSchema = z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'invalid id')
export const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, 'invalid sha256')
const isoUtc = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, 'timestamp must be ISO-8601 UTC (…Z)')
const wholeNumber = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
/** IDs that exist in documents created before sync (any non-empty string), e.g. message and thread IDs. */
const docId = z.string().min(1).max(200)

// --- Payloads (section 7) ---------------------------------------------------------------------------------------

export const partEntrySchema = z
    .object({
        partId: uuidSchema,
        kind: z.enum(['content', 'image']),
        assetId: sha256HexSchema.optional(),
        index: wholeNumber,
        size: z.number().int().positive().max(PART_SIZE),
        sha256: sha256HexSchema
    })
    .strict()
    .refine((p) => (p.kind === 'image') === (p.assetId !== undefined), {
        message: 'assetId is required for image parts and not allowed for content parts'
    })
export type PartEntry = z.infer<typeof partEntrySchema>

export const messageSentPayloadSchema = z
    .object({
        message: z
            .object({
                messageId: docId,
                threadId: docId,
                authorDisplayName: z.string().min(1),
                createdAt: isoUtc,
                content: richDocSchema.optional(),
                assetReferences: z.array(sha256HexSchema)
            })
            .strict(),
        images: z.array(
            z
                .object({
                    assetId: sha256HexSchema,
                    mediaType: z.enum(IMAGE_MEDIA_TYPES),
                    size: wholeNumber
                })
                .strict()
        ),
        parts: z.array(partEntrySchema)
    })
    .strict()
    .superRefine((p, ctx) => {
        const contentParts = p.parts.filter((x) => x.kind === 'content')
        if (p.message.content === undefined && contentParts.length === 0)
            ctx.addIssue({ code: 'custom', message: 'content is missing and no content parts' })
        if (p.message.content !== undefined && contentParts.length > 0)
            ctx.addIssue({ code: 'custom', message: 'content is inline and also in parts' })
        const partIds = new Set<string>()
        for (const part of p.parts) {
            if (partIds.has(part.partId))
                ctx.addIssue({ code: 'custom', message: `duplicate part ${part.partId}` })
            partIds.add(part.partId)
        }
        const imageIds = new Set(p.images.map((i) => i.assetId))
        for (const part of p.parts) {
            if (part.kind === 'image' && part.assetId && !imageIds.has(part.assetId))
                ctx.addIssue({ code: 'custom', message: `part for unlisted image ${part.assetId}` })
        }
        for (const image of p.images) {
            if (!p.message.assetReferences.includes(image.assetId))
                ctx.addIssue({ code: 'custom', message: `image ${image.assetId} not referenced` })
            if (!p.parts.some((x) => x.assetId === image.assetId))
                ctx.addIssue({ code: 'custom', message: `image ${image.assetId} has no parts` })
        }
        const groups = new Map<string, number[]>()
        for (const part of p.parts) {
            const key = part.kind === 'image' ? `image:${part.assetId}` : 'content'
            groups.set(key, [...(groups.get(key) ?? []), part.index])
        }
        for (const [key, indexes] of groups) {
            const sorted = [...indexes].sort((a, b) => a - b)
            if (sorted.some((v, i) => v !== i))
                ctx.addIssue({ code: 'custom', message: `${key}: part indexes must be 0..n-1` })
        }
    })
export type MessageSentPayload = z.infer<typeof messageSentPayloadSchema>

export const messagePartPayloadSchema = z.object({ messageId: docId, partId: uuidSchema }).strict()

export const branchCreatedPayloadSchema = z
    .object({
        thread: z
            .object({
                threadId: docId,
                parentThreadId: docId,
                sourceMessageId: docId,
                quoteText: z.string().min(1),
                selectionStart: wholeNumber.optional(),
                selectionEnd: wholeNumber.optional(),
                title: z.string().optional(),
                createdAt: isoUtc
            })
            .strict()
    })
    .strict()

export const branchStatusSetPayloadSchema = z
    .object({ threadId: docId, status: z.enum(['open', 'closed']) })
    .strict()

export const branchTitleSetPayloadSchema = z.object({ threadId: docId, title: z.string() }).strict()

export const readStateAddedPayloadSchema = z
    .object({ messageIds: z.array(docId).min(1).max(MAX_READ_IDS_PER_EVENT) })
    .strict()

const memberWithoutHistory = rosterMemberSchema.omit({ previousKeys: true }).strict()

/** `delivery.added` (sync-protocol.md 7.11, D-40): messages that the sender has now received. */
export const deliveryAddedPayloadSchema = z
    .object({ messageIds: z.array(docId).min(1).max(MAX_READ_IDS_PER_EVENT) })
    .strict()

export const memberAddedPayloadSchema = z.object({ member: memberWithoutHistory }).strict()

export const memberKeysReplacedPayloadSchema = z
    .object({
        participantId: docId,
        signingPublicKey: publicKeySchema,
        encryptionPublicKey: publicKeySchema,
        fingerprint: fingerprintSchema
    })
    .strict()

export const profileUpdatedPayloadSchema = z.object({ displayName: z.string().min(1) }).strict()

export const receiptDeliveredPayloadSchema = z
    .object({ ids: z.array(uuidSchema).min(1).max(MAX_RECEIPT_IDS) })
    .strict()

export const invitationPartEntrySchema = z
    .object({
        partId: uuidSchema,
        index: wholeNumber,
        size: z.number().int().positive().max(PART_SIZE),
        sha256: sha256HexSchema
    })
    .strict()

export const invitationPayloadSchema = z
    .object({
        invitationId: uuidSchema,
        minProtocolVersion: z.number().int().positive(),
        replacesKeysOf: docId.optional(),
        snapshotSize: z.number().int().positive(),
        snapshotSha256: sha256HexSchema,
        parts: z.array(invitationPartEntrySchema).min(1)
    })
    .strict()
    .superRefine((p, ctx) => {
        const sorted = p.parts.map((x) => x.index).sort((a, b) => a - b)
        if (sorted.some((v, i) => v !== i))
            ctx.addIssue({ code: 'custom', message: 'part indexes must be 0..n-1' })
        const total = p.parts.reduce((sum, x) => sum + x.size, 0)
        if (total !== p.snapshotSize)
            ctx.addIssue({ code: 'custom', message: 'part sizes do not add up to snapshotSize' })
    })

export const invitationPartPayloadSchema = z
    .object({ invitationId: uuidSchema, partId: uuidSchema })
    .strict()

// --- Envelope (section 5) ---------------------------------------------------------------------------------------

export const PAYLOAD_SCHEMAS = {
    'message.sent': messageSentPayloadSchema,
    'message.part': messagePartPayloadSchema,
    'branch.created': branchCreatedPayloadSchema,
    'branch.status.set': branchStatusSetPayloadSchema,
    'branch.title.set': branchTitleSetPayloadSchema,
    'readstate.added': readStateAddedPayloadSchema,
    'delivery.added': deliveryAddedPayloadSchema,
    'member.added': memberAddedPayloadSchema,
    'member.keys.replaced': memberKeysReplacedPayloadSchema,
    'profile.updated': profileUpdatedPayloadSchema,
    'receipt.delivered': receiptDeliveredPayloadSchema,
    invitation: invitationPayloadSchema,
    'invitation.part': invitationPartPayloadSchema
} as const

export type EventType = keyof typeof PAYLOAD_SCHEMAS
export const EVENT_TYPES = Object.keys(PAYLOAD_SCHEMAS) as EventType[]
/** Event types whose frame carries a binary payload. */
export const PART_EVENT_TYPES: readonly EventType[] = ['message.part', 'invitation.part']

export type EventPayload<T extends EventType> = z.infer<(typeof PAYLOAD_SCHEMAS)[T]>

/** Fields common to all envelopes, before the type-specific payload is checked. */
export const envelopeBaseSchema = z
    .object({
        protocolVersion: z.number().int().positive(),
        eventId: uuidSchema,
        type: z.string().min(1).max(100),
        conversationId: docId,
        senderId: docId,
        recipientId: docId,
        senderSeq: wholeNumber,
        clock: wholeNumber,
        createdAt: isoUtc,
        payload: z.record(z.string(), z.unknown()),
        payloadSha256: sha256HexSchema.optional()
    })
    .strict()

export type EnvelopeBase = z.infer<typeof envelopeBaseSchema>

export interface Envelope<T extends EventType = EventType> extends Omit<
    EnvelopeBase,
    'type' | 'payload'
> {
    type: T
    payload: EventPayload<T>
}

export type EnvelopeCheck =
    | { status: 'ok'; envelope: Envelope }
    /** A newer protocol version or an unknown type: keep it pending and ask the person to update (section 10). */
    | { status: 'needs-update'; base: EnvelopeBase }
    | { status: 'invalid'; problems: string[] }

function issues(error: z.ZodError): string[] {
    return error.issues.slice(0, 8).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
}

/** Validates a decoded envelope object against the protocol (sections 5 and 7). */
export function checkEnvelope(value: unknown): EnvelopeCheck {
    const base = envelopeBaseSchema.safeParse(value)
    if (!base.success) return { status: 'invalid', problems: issues(base.error) }
    const env = base.data
    if (env.protocolVersion > SYNC_PROTOCOL_VERSION) return { status: 'needs-update', base: env }
    if (!(env.type in PAYLOAD_SCHEMAS)) return { status: 'needs-update', base: env }
    const type = env.type as EventType
    const payload = PAYLOAD_SCHEMAS[type].safeParse(env.payload)
    if (!payload.success) return { status: 'invalid', problems: issues(payload.error) }

    const problems: string[] = []
    const isPart = PART_EVENT_TYPES.includes(type)
    if (isPart && env.payloadSha256 === undefined) problems.push('payloadSha256 is required')
    if (!isPart && env.payloadSha256 !== undefined) problems.push('payloadSha256 is not allowed')
    if (type === 'receipt.delivered' && env.senderSeq !== 0)
        problems.push('receipts have senderSeq 0')
    if (type !== 'receipt.delivered' && env.senderSeq === 0) problems.push('senderSeq starts at 1')
    if (problems.length > 0) return { status: 'invalid', problems }

    return { status: 'ok', envelope: { ...env, type, payload: payload.data } as Envelope }
}

// --- Public-key bundle (section 4) -------------------------------------------------------------------------------

export const KEY_BUNDLE_FORMAT = 'branchchat-key'
export const KEY_BUNDLE_TEXT_PREFIX = 'BRANCHCHAT-KEY-1:'

export const keyBundleSchema = z
    .object({
        format: z.literal(KEY_BUNDLE_FORMAT),
        version: z.literal(1),
        participantId: docId,
        displayName: z.string().min(1).max(200),
        signingPublicKey: publicKeySchema,
        encryptionPublicKey: publicKeySchema,
        fingerprint: fingerprintSchema,
        createdAt: isoUtc,
        signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/, 'invalid signature')
    })
    .strict()
export type KeyBundle = z.infer<typeof keyBundleSchema>

// --- Shared-root marker (section 3.1) ----------------------------------------------------------------------------

export const conversationMarkerSchema = z
    .object({
        format: z.literal('branchchat-sync'),
        protocolVersion: z.number().int().positive(),
        conversationId: docId
    })
    .strict()

/** Names of files in the shared root that the application reads (section 3). Conflict copies are accepted. */
export const SHARED_FILE_NAME = /^([0-9a-f-]{36})(?: \(\d+\))?\.(bcmsg|bcpart|bcrcpt|bcinv|bckey)$/
