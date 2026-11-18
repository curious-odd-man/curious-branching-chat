import { app } from 'electron'
import { IPC } from '@shared/types/ipc'
import {
    noPayloadSchema,
    openLinkSchema,
    setAssociationSchema,
    zoomChangeSchema
} from '@shared/validation'
import { openExternalLink } from '../windows/security'
import type { IpcContext } from './context'

/** App info, focus, links, restart, file association, and updates. */
export function registerAppHandlers(ctx: IpcContext): void {
    const { handle, controller, association, updates, shared } = ctx
    handle(IPC.appInfo, noPayloadSchema, () => ({ name: app.getName(), version: app.getVersion() }))
    handle(IPC.zoomChange, zoomChangeSchema, async (_e, p) => {
        await shared?.zoom?.change(p.direction)
        return null
    })
    handle(IPC.focusTake, noPayloadSchema, (entry) => controller.takeFocusRequest(entry))
    handle(IPC.updateGetState, noPayloadSchema, () => updates.get())
    // The work continues in the background; progress and results arrive as state changes (FR-095).
    handle(IPC.updateCheck, noPayloadSchema, () => {
        void updates.checkManually()
        return null
    })
    handle(IPC.updateDownload, noPayloadSchema, () => {
        void updates.download()
        return null
    })
    handle(IPC.updateInstall, noPayloadSchema, () => {
        updates.install()
        return null
    })
    handle(IPC.updateShowDialog, noPayloadSchema, () => {
        updates.showDialog()
        return null
    })
    handle(IPC.updateDismiss, noPayloadSchema, () => {
        updates.dismissDialog()
        return null
    })
    handle(IPC.updateOpenReleasePage, noPayloadSchema, () => updates.openReleasePage())
    handle(IPC.associationGet, noPayloadSchema, () => association.info())
    handle(IPC.associationSet, setAssociationSchema, (_e, p) => association.set(p.enabled))

    handle(IPC.linkOpen, openLinkSchema, (_entry, p) => openExternalLink(p.url))
    handle(IPC.appRelaunch, noPayloadSchema, () => {
        setTimeout(() => shared?.restart?.(), 100)
        return null
    })
}
