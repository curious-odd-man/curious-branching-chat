import { IPC } from '@shared/types/ipc'
import {
    attachmentBytesSchema,
    attachmentPathsSchema,
    attachmentReceiversSchema,
    attachmentRefSchema,
    noPayloadSchema,
    reactionToggleSchema,
    setAttachmentLimitSchema
} from '@shared/validation'
import { findAttachment } from '../application/attachments'
import type { IpcContext } from './context'

/** Reactions and attachments (FR-231 to FR-234, FR-261 to FR-268a). */
export function registerAttachmentHandlers(ctx: IpcContext): void {
    const { handle, controller, settings, sync, requireSession, requireName, requireAttachments } =
        ctx
    // ---- reactions and attachments ---------------------------------------------------------------------------
    handle(IPC.reactionToggle, reactionToggleSchema, (entry, p) => {
        // FR-234: no read mark, so no read notice
        requireSession(entry).toggleReaction(requireName(), p.messageId, p.emoji)
        return null
    })
    handle(IPC.attachmentPick, noPayloadSchema, (entry) => {
        requireSession(entry)
        return requireAttachments().pick(entry?.win)
    })
    handle(IPC.attachmentAddPaths, attachmentPathsSchema, (entry, p) => {
        requireSession(entry)
        return requireAttachments().addPaths(p.paths)
    })
    handle(IPC.attachmentAddBytes, attachmentBytesSchema, (entry, p) => {
        requireSession(entry)
        return requireAttachments().addBytes(
            p.name,
            p.type,
            Buffer.from(p.data.buffer, p.data.byteOffset, p.data.byteLength)
        )
    })
    handle(IPC.attachmentSave, attachmentRefSchema, (entry, p) => {
        const session = requireSession(entry)
        const { attachment } = findAttachment(
            session.current.discussion.threads,
            p.messageId,
            p.index
        )
        return requireAttachments().saveAs(entry?.win, attachment)
    })
    handle(IPC.attachmentOpen, attachmentRefSchema, (entry, p) => {
        const session = requireSession(entry)
        const found = findAttachment(session.current.discussion.threads, p.messageId, p.index)
        return requireAttachments().open(entry?.win, found.attachment, found.message)
    })
    handle(IPC.attachmentReceivers, attachmentReceiversSchema, async (entry, p) => {
        const session = requireSession(entry)
        if (!sync || !session.synced) return []
        return sync.receiversBelow(session.documentId, p.size)
    })
    handle(IPC.settingsSetAttachmentLimit, setAttachmentLimitSchema, async (_e, p) => {
        const updated = await settings.setAttachmentLimit(p.mb)
        controller.broadcast(IPC.settingsChanged, updated)
        return updated
    })
}
