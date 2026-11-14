import { z } from 'zod'
import { richDocSchema } from './richText'

/** Payload schemas for IPC channels. The renderer is never trusted. */
export const setNameSchema = z.object({ displayName: z.string().trim().min(1) }).strict()
export const openPathSchema = z.object({ path: z.string().min(1) }).strict()
export const appendMessageSchema = z
    .object({ threadId: z.string().min(1), content: richDocSchema })
    .strict()
export const draftSchema = z.object({ hasDraft: z.boolean() }).strict()
export const noPayloadSchema = z.undefined()
export const openLinkSchema = z.object({ url: z.string().min(1) }).strict()
export const createBranchSchema = z
    .object({
        sourceMessageId: z.string().min(1),
        selectionStart: z.number().int().nonnegative(),
        selectionEnd: z.number().int().nonnegative()
    })
    .strict()
export const setStatusSchema = z
    .object({ threadId: z.string().min(1), status: z.enum(['open', 'closed']) })
    .strict()
export const setTitleSchema = z.object({ threadId: z.string().min(1), title: z.string() }).strict()
export const markMessageSchema = z.object({ messageId: z.string().min(1) }).strict()
export const markThreadSchema = z.object({ threadId: z.string().min(1) }).strict()
export const stageImageSchema = z.object({ data: z.instanceof(Uint8Array) }).strict()
export const setAssociationSchema = z.object({ enabled: z.boolean() }).strict()
export const setAutoUpdateSchema = z.object({ enabled: z.boolean() }).strict()
export const setRecentLimitSchema = z.object({ limit: z.number().int().nonnegative() }).strict()
export const setOpenLastSchema = z.object({ enabled: z.boolean() }).strict()
export const sharedRootSchema = z.object({ root: z.string().min(1) }).strict()
export const sharedParseKeySchema = z
    .object({
        text: z
            .string()
            .min(1)
            .max(64 * 1024)
    })
    .strict()
export const sharedCreateSchema = z
    .object({
        root: z.string().min(1),
        keys: z
            .array(
                z
                    .string()
                    .min(1)
                    .max(64 * 1024)
            )
            .min(1)
            .max(100),
        mode: z.enum(['new', 'convert'])
    })
    .strict()
/** FR-177: re-invite a member who lost the keys, with the person's new key. */
export const sharedReinviteSchema = z
    .object({
        participantId: z.string().min(1).max(200),
        key: z
            .string()
            .min(1)
            .max(64 * 1024)
    })
    .strict()
/** D-32: accept or reject the new keys of a member. */
export const decideKeysSchema = z
    .object({ participantId: z.string().min(1).max(200), accept: z.boolean() })
    .strict()
/** FR-176: new members for the open, active discussion. */
export const sharedInviteSchema = z
    .object({
        keys: z
            .array(
                z
                    .string()
                    .min(1)
                    .max(64 * 1024)
            )
            .min(1)
            .max(100)
    })
    .strict()
export const joinImportSchema = z
    .object({ root: z.string().min(1), invitationId: z.string().min(1) })
    .strict()
export const setFileSizeLimitSchema = z.object({ mb: z.number().int().min(5).max(1000) }).strict()
export const setBackgroundFlagSchema = z
    .object({
        flag: z.enum(['notifyNewMessages', 'notifyShowText', 'startWithWindows']),
        enabled: z.boolean()
    })
    .strict()
export const recentPathSchema = z.object({ path: z.string().min(1) }).strict()
