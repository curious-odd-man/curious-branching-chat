import { z } from 'zod'
import { richDocSchema } from './richText'
import type { SyncInfo } from './roster'

export const FORMAT_NAME = 'branchchat'
/** Version 2 adds logical clocks (FR-151 to FR-153) and the optional roster entry `sync.json` (FR-154). */
export const CURRENT_SCHEMA_VERSION = 2

const isoUtc = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, 'timestamp must be ISO-8601 UTC (…Z)')

const id = z.string().min(1)

/** Lamport clock (FR-152): a whole number from 0. */
export const clockSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

/** Clock and participant of the last change of a last-writer-wins value (FR-153). */
export const changeStampSchema = z.object({ clock: clockSchema, by: id }).passthrough()
export type ChangeStamp = z.infer<typeof changeStampSchema>

/** Objects use passthrough so unknown optional fields survive a load/save cycle (FR-015). */
export const manifestSchema = z
    .object({
        format: z.literal(FORMAT_NAME),
        schemaVersion: z.number().int().positive(),
        documentId: id,
        createdAt: isoUtc,
        generator: z.object({ name: z.string(), version: z.string() }).passthrough().optional()
    })
    .passthrough()
export type Manifest = z.infer<typeof manifestSchema>

export const participantSchema = z
    .object({ participantId: id, displayName: z.string().min(1) })
    .passthrough()
export type Participant = z.infer<typeof participantSchema>

export const messageSchema = z
    .object({
        messageId: id,
        threadId: id,
        sequence: z.number().int().nonnegative(),
        /** Logical clock; messages of a thread are ordered by (clock, authorId, messageId) (FR-152). */
        clock: clockSchema,
        authorId: id,
        /** Display name of the author when the message was written (FR-024). */
        authorDisplayName: z.string().min(1),
        createdAt: isoUtc,
        content: richDocSchema,
        assetReferences: z.array(id)
    })
    .passthrough()
export type Message = z.infer<typeof messageSchema>

export const threadStatusSchema = z.enum(['open', 'closed'])
export type ThreadStatus = z.infer<typeof threadStatusSchema>

export const threadSchema = z
    .object({
        threadId: id,
        parentThreadId: id.optional(),
        sourceMessageId: id.optional(),
        quoteText: z.string().optional(),
        selectionStart: z.number().int().nonnegative().optional(),
        selectionEnd: z.number().int().nonnegative().optional(),
        title: z.string().optional(),
        status: threadStatusSchema,
        createdAt: isoUtc,
        createdBy: id,
        /** Logical clock of the branch's creation; the main thread has 0 (FR-152). */
        clock: clockSchema,
        /** Last status change; absent = never changed (clock 0 by the creator) (FR-153). */
        statusSet: changeStampSchema.optional(),
        /** Last title change; absent = never changed (FR-153). */
        titleSet: changeStampSchema.optional(),
        messages: z.array(messageSchema)
    })
    .passthrough()
export type Thread = z.infer<typeof threadSchema>

export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
export const ASSET_PATH_PATTERN = /^assets\/images\/[0-9a-f]{64}\.(png|jpg|gif|webp)$/

export const assetSchema = z
    .object({
        assetId: id,
        path: z.string().regex(ASSET_PATH_PATTERN, 'invalid asset path'),
        mediaType: z.enum(IMAGE_MEDIA_TYPES),
        size: z.number().int().nonnegative(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/)
    })
    .passthrough()
export type AssetInfo = z.infer<typeof assetSchema>

export const discussionSchema = z
    .object({
        title: z.string(),
        createdAt: isoUtc,
        updatedAt: isoUtc,
        participants: z.array(participantSchema),
        threads: z.array(threadSchema),
        assets: z.array(assetSchema)
    })
    .passthrough()
export type DiscussionData = z.infer<typeof discussionSchema>

/** participantId -> IDs of messages that participant has read. Own messages are never listed. */
export const readStateSchema = z.record(id, z.array(id))
export type ReadState = z.infer<typeof readStateSchema>

export interface DocumentContents {
    manifest: Manifest
    discussion: DiscussionData
    readState: ReadState
    /** Roster of a synchronized discussion (ZIP entry `sync.json`); absent for a normal discussion (FR-154). */
    sync?: SyncInfo
}
