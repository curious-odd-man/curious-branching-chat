import { app, BrowserWindow, Menu, session } from 'electron'
import { randomUUID } from 'node:crypto'
import { AppController } from './application/appController'
import { installAssetProtocol, registerAssetScheme } from './application/assetProtocol'
import { systemContext } from './application/clock'
import { createMainWindow } from './application/mainWindow'
import { buildMenu } from './application/menu'
import { describeRecent } from './application/recentView'
import { electronUi } from './application/ui'
import { IPC } from '@shared/types/ipc'
import { e2eRegistry, e2eUpdaterConfig, installE2eHooks } from './e2e/hooks'
import { registerIpcHandlers } from './ipc/handlers'
import { RecentFilesStore } from './local-state/recentFiles'
import { SettingsStore } from './local-state/settings'
import { ElectronUpdaterPort } from './updates/electronUpdaterPort'
import { UpdateService } from './updates/updateService'
import { openExternalLink } from './windows/security'
import { AssociationService } from './windows/associationService'
import { createFileAssociation } from './windows/createAssociation'
import { applyJumpList } from './windows/jumpList'
import { extractDiscussionPaths } from './windows/launchArgs'
import { applyGlobalSecurity } from './windows/security'

// Test builds only (`--mode e2e`): stub native dialogs and use an isolated profile (own settings and own
// single-instance lock). Release builds contain none of this.
if (__E2E_HOOKS__) {
    installE2eHooks()
    const userDataOverride = process.env['BRANCHCHAT_USER_DATA']
    if (userDataOverride) app.setPath('userData', userDataOverride)
}

// Windows groups the taskbar button and notifications under this ID; it matches the installer's appId.
if (process.platform === 'win32') app.setAppUserModelId('app.branchchat.desktop')

// The scheme used to show embedded images must be registered before the app is ready.
registerAssetScheme()

// One application instance; a second launch (e.g. double-clicking another .branchchat file) is forwarded here.
const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
    app.quit()
} else {
    let controller: AppController | null = null
    const earlyPaths: string[] = extractDiscussionPaths(process.argv.slice(1))

    app.on('second-instance', (_event, argv) => {
        const paths = extractDiscussionPaths(argv.slice(1))
        if (!controller) earlyPaths.push(...paths)
        else void controller.openPaths(paths)
    })

    void app.whenReady().then(async () => {
        const settings = new SettingsStore(app.getPath('userData'), randomUUID)
        await settings.load()
        const recent = new RecentFilesStore(app.getPath('userData'))
        await recent.load()
        controller = new AppController({
            settings,
            recent,
            ui: electronUi,
            ctx: systemContext,
            appVersion: app.getVersion(),
            createWindow: createMainWindow
        })
        installAssetProtocol(controller)
        applyGlobalSecurity()
        // Spell checking uses the Windows spell checker (offline). Russian and English are requested; a language only works
        // if it is installed in Windows (Settings > Time & language).
        if (process.platform === 'win32')
            session.defaultSession.setSpellCheckerLanguages(['ru', 'en-US'])
        const association = new AssociationService(
            createFileAssociation(__E2E_HOOKS__ ? e2eRegistry() : null),
            settings,
            electronUi
        )
        // Updates (FR-093 to FR-107): a first check shortly after start, then every few hours, unless turned off.
        const testUpdates = __E2E_HOOKS__ ? e2eUpdaterConfig() : null
        const ctrl = controller
        const updates = new UpdateService({
            port: new ElectronUpdaterPort(testUpdates?.options),
            currentVersion: app.getVersion(),
            publish: (view) => ctrl.broadcast(IPC.updateChanged, view),
            openLink: openExternalLink,
            autoCheckEnabled: () => settings.get().autoUpdateCheck,
            log: (message) => console.log(`[updates] ${message}`)
        })
        setTimeout(() => void updates.checkAutomatically(), testUpdates?.startupDelayMs ?? 20_000)
        setInterval(
            () => void updates.checkAutomatically(),
            testUpdates?.intervalMs ?? 6 * 60 * 60 * 1000
        )
        registerIpcHandlers(controller, settings, recent, association, updates)
        // The File > Open recent menu, the taskbar jump list and every window follow the recent files list.
        const refreshRecent = async (): Promise<void> => {
            const files = await describeRecent(recent.list())
            Menu.setApplicationMenu(buildMenu(ctrl, updates, recent, files))
            applyJumpList(files)
            ctrl.broadcast(IPC.recentChanged, files)
        }
        recent.onChange(() => void refreshRecent())
        await refreshRecent()
        // Started without a file: reopen the most recent discussion if the person wants that and it still exists.
        // A file given on the command line always wins (the last file is not opened as well).
        let initialPaths = earlyPaths
        const last = recent.list()[0]
        if (initialPaths.length === 0 && settings.get().openLastFileOnStartup && last) {
            const [view] = await describeRecent([last])
            if (view?.exists) initialPaths = [last.path]
        }
        await controller.openPaths(initialPaths)
        void association.offerAtStartup()

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) controller?.createWindow()
        })
    })

    app.on('window-all-closed', () => app.quit())
}
