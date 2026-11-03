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
