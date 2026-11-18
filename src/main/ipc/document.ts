import { IPC } from '@shared/types/ipc'
import {
    appendMessageSchema,
    createBranchSchema,
    markMessageSchema,
    markThreadSchema,
    newDocumentSchema,
    noPayloadSchema,
    openDiscussionSchema,
    openPathSchema,
    setStatusSchema,
    setTitleSchema,
    stageImageSchema
} from '@shared/validation'
import type { IpcContext } from './context'

/** Documents: open, new, export, messages, read marks, branches, images. */
export function registerDocumentHandlers(ctx: IpcContext): void {
    const { handle, controller, settings, library, requireSession, withReadNotice } = ctx
    handle(IPC.documentNew, newDocumentSchema, (entry, p) => controller.newDocument(entry, p.title))
    handle(IPC.documentOpenDialog, noPayloadSchema, (entry) => controller.openWithDialog(entry))
    handle(IPC.documentOpenPath, openPathSchema, (entry, p) => controller.openPath(p.path, entry))
    handle(IPC.documentOpenId, openDiscussionSchema, (entry, p) =>
        controller.openDiscussion(p.id, entry)
    )
    handle(IPC.documentOpenIdNewWindow, openDiscussionSchema, (entry, p) =>
        controller.openDiscussion(p.id, entry, { newWindow: true })
    )
    handle(IPC.documentExport, noPayloadSchema, (entry) => controller.exportDiscussion(entry))
    handle(IPC.documentGetState, noPayloadSchema, (entry) =>
        entry ? controller.viewOf(entry) : null
    )

    handle(IPC.documentAppendMessage, appendMessageSchema, (entry, p) => {
        const { session, me } = withReadNotice(entry, { type: 'send', threadId: p.threadId })
        session.appendMessage(me, p.threadId, p.content, p.attachments ?? [])
        // the sent text is no draft any more (FR-251)
        void library.saveDraft(session.documentId, p.threadId, null).catch(() => undefined)
    })
    handle(IPC.readMarkMessage, markMessageSchema, (entry, p) => {
        const { session, me } = withReadNotice(entry, { type: 'message', messageId: p.messageId })
        session.markMessageRead(me, p.messageId)
        return null
    })
    handle(IPC.readMarkThread, markThreadSchema, (entry, p) => {
        const { session, me } = withReadNotice(entry, { type: 'thread', threadId: p.threadId })
        session.markThreadRead(me, p.threadId)
        return null
    })
    handle(IPC.readMarkAll, noPayloadSchema, (entry) => {
        const { session, me } = withReadNotice(entry, { type: 'all' })
        session.markAllRead(me)
        return null
    })
    handle(IPC.settingsAckReadNotice, noPayloadSchema, () => settings.acknowledgeReadNotice())
    handle(IPC.branchCreate, createBranchSchema, (entry, p) => {
        const { session, me } = withReadNotice(entry, {
            type: 'branch',
            messageId: p.sourceMessageId
        })
        return { threadId: session.createBranch(me, p) }
    })
    handle(IPC.branchSetStatus, setStatusSchema, (entry, p) => {
        requireSession(entry).setThreadStatus(settings.get().participantId, p.threadId, p.status)
        return null
    })
    handle(IPC.branchSetTitle, setTitleSchema, (entry, p) => {
        requireSession(entry).setThreadTitle(settings.get().participantId, p.threadId, p.title)
        return null
    })
    handle(IPC.documentRetrySave, noPayloadSchema, async (entry) => {
        await requireSession(entry).retrySave()
    })
    handle(IPC.imageStage, stageImageSchema, (entry, p) =>
        requireSession(entry).stageImage(
            Buffer.from(p.data.buffer, p.data.byteOffset, p.data.byteLength)
        )
    )
    handle(IPC.imagePick, noPayloadSchema, (entry) => controller.pickImage(entry))
}
