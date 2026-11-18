import { IPC } from '@shared/types/ipc'
import {
    noPayloadSchema,
    setAutoUpdateSchema,
    setBackgroundFlagSchema,
    setFileSizeLimitSchema,
    setLanguageSchema,
    setNameSchema,
    setOpenLastSchema,
    setRecentLimitSchema,
    setSidebarSchema,
    setTextSizeSchema
} from '@shared/validation'
import type { IpcContext } from './context'

/** Identity and settings. */
export function registerSettingsHandlers(ctx: IpcContext): void {
    const { handle, controller, settings, library, identity, sync, shared } = ctx
    handle(IPC.identityGet, noPayloadSchema, () => identity.view())

    handle(IPC.identityCopyBundle, noPayloadSchema, async () => {
        await identity.copyBundle()
        return null
    })
    handle(IPC.identitySaveBundle, noPayloadSchema, (entry) => identity.saveBundle(entry?.win))
    handle(IPC.settingsGet, noPayloadSchema, () => settings.get())
    handle(IPC.settingsSetName, setNameSchema, async (_e, p) => {
        const view = await settings.setDisplayName(p.displayName)
        // D-12: synchronized discussions send the new name to the other members
        if (view.displayName) await sync?.nameChanged(view.displayName)
        return view
    })

    handle(IPC.settingsSetAutoUpdate, setAutoUpdateSchema, (_e, p) =>
        settings.setAutoUpdateCheck(p.enabled)
    )
    handle(IPC.settingsSetRecentLimit, setRecentLimitSchema, async (_e, p) => {
        const updated = await settings.setRecentFilesLimit(p.limit)
        library.changed() // the File menu and the jump list show a different number
        return updated
    })
    handle(IPC.settingsSetBackgroundFlag, setBackgroundFlagSchema, (_e, p) =>
        shared?.background
            ? shared.background.setFlag(p.flag, p.enabled)
            : settings.setFlag(p.flag, p.enabled)
    )
    handle(IPC.settingsSetSidebar, setSidebarSchema, async (_e, p) => {
        const updated = await settings.setSidebar(p)
        controller.broadcast(IPC.settingsChanged, updated)
        return updated
    })
    handle(IPC.settingsSetTextSize, setTextSizeSchema, (_e, p) =>
        shared?.zoom ? shared.zoom.set(p.percent) : settings.setTextSize(p.percent)
    )
    handle(IPC.settingsSetFileSizeLimit, setFileSizeLimitSchema, async (_e, p) => {
        const before = settings.get().fileSizeLimitMb
        const updated = await settings.setFileSizeLimit(p.mb)
        // FR-268, FR-268a: the other members learn the new limit, and files that waited are read
        if (sync && before !== p.mb) void sync.limitChanged()
        // a file that is too large shows the new state in the windows
        controller.broadcast(IPC.settingsChanged, updated)
        return updated
    })
    handle(IPC.settingsSetOpenLast, setOpenLastSchema, (_e, p) =>
        settings.setOpenLastFileOnStartup(p.enabled)
    )
    // FR-292, FR-293: the language applies after a restart
    handle(IPC.settingsSetLanguage, setLanguageSchema, async (_e, p) => {
        const updated = await settings.setLanguage(p.language)
        controller.broadcast(IPC.settingsChanged, updated)
        return updated
    })
}
