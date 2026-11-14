import { app, BrowserWindow, clipboard, dialog, Menu, session } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { ru } from '@shared/i18n/ru'
import { AppController } from './application/appController'
import { installAssetProtocol, registerAssetScheme } from './application/assetProtocol'
import { systemContext } from './application/clock'
import { createMainWindow } from './application/mainWindow'
import { buildMenu } from './application/menu'
import { describeRecent } from './application/recentView'
import { electronUi } from './application/ui'
import { IPC } from '@shared/types/ipc'
import {
    e2eBackgroundPorts,
    e2eKeyProtector,
    e2eRegistry,
    e2eUpdaterConfig,
    installE2eHooks
} from './e2e/hooks'
import { promises as fs } from 'node:fs'
import { BackgroundService } from './background/backgroundService'
import { electronLoginItem, electronNotifier, electronTray } from './background/electronPorts'
import { BACKGROUND_ARG } from './background/ports'
import { readDocument } from './document'
import { IdentityService } from './crypto/identityService'
import { KeyStore } from './crypto/keyStore'
import { safeStorageProtector } from './crypto/protector'
import { SyncRegistry } from './sync/registry'
import { SyncService } from './sync/syncService'
import { Onboarding } from './sync/onboarding'
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
import { guardConsoleStreams } from './windows/safeConsole'
import { applyGlobalSecurity } from './windows/security'

// A closed console pipe must not end the app (EPIPE from a log line).
guardConsoleStreams()

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
    let background: BackgroundService | null = null
    const earlyPaths: string[] = extractDiscussionPaths(process.argv.slice(1))
    // started by Windows at sign-in (FR-174): no window, only the tray
    const startedInBackground = process.argv.includes(BACKGROUND_ARG)

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
        // Encryption identity (FR-155 to FR-157): keys in the user data folder, protected by Windows DPAPI.
        const keys = new KeyStore(
            join(app.getPath('userData'), 'keys'),
            __E2E_HOOKS__ ? e2eKeyProtector() : safeStorageProtector,
            systemContext.now
        )
        // Synchronized discussions (release 1.2): the registry says which file and shared folder belong together.
        const registry = new SyncRegistry(join(app.getPath('userData'), 'sync'))
        await registry.load()
        const sync = new SyncService({
            userData: app.getPath('userData'),
            registry,
            keys,
            settings,
            now: systemContext.now,
            newId: randomUUID,
            appVersion: app.getVersion(),
            ...(__E2E_HOOKS__ && process.env['BRANCHCHAT_E2E_SCAN_MS']
                ? {
                      scanIntervalMs: Number(process.env['BRANCHCHAT_E2E_SCAN_MS']),
                      stableMs: 300
                  }
                : {}),
            log: (message) => console.log(`[sync] ${message}`),
            onNewMessages: (arrival) => background?.newMessages(arrival),
            onStatusChange: () => void background?.refresh()
        })
        controller = new AppController({
            settings,
            recent,
            sync,
            registry,
            ui: electronUi,
            ctx: systemContext,
            appVersion: app.getVersion(),
            createWindow: createMainWindow,
            onCloseCancelled: () => background?.closeCancelled()
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
        const identity = new IdentityService({
            keys,
            settings,
            now: systemContext.now,
            writeClipboard: (text) => clipboard.writeText(text),
            pickBundlePath: async (parent, defaultName) => {
                const options = {
                    title: ru.identity.saveTitle,
                    defaultPath: join(app.getPath('documents'), defaultName),
                    filters: [{ name: ru.identity.fileFilter, extensions: ['bckey'] }]
                }
                const result = parent
                    ? await dialog.showSaveDialog(parent, options)
                    : await dialog.showSaveDialog(options)
                return result.canceled || !result.filePath ? null : result.filePath
            }
        })
        const onboarding = new Onboarding({
            userData: app.getPath('userData'),
            keys,
            settings,
            registry,
            sync,
            ctx: systemContext,
            appVersion: app.getVersion()
        })
        // Release 1.4: tray, notifications, start with Windows (D-16, D-33, D-36, D-38, D-42)
        const ports = __E2E_HOOKS__
            ? e2eBackgroundPorts()
            : { tray: electronTray(), notifier: electronNotifier(), loginItem: electronLoginItem() }
        background = new BackgroundService({
            settings,
            sync,
            windows: {
                get windowCount() {
                    return ctrl.windowCount
                },
                isActive: (path) => ctrl.isActive(path),
                showAny: () => ctrl.showAny(),
                openPath: async (path) => {
                    await ctrl.openPath(path, undefined)
                },
                showMessage: (path, threadId, messageId) =>
                    ctrl.showMessage(path, threadId, messageId)
            },
            ...ports,
            fileExists: (path) =>
                fs
                    .access(path)
                    .then(() => true)
                    .catch(() => false),
            pickDiscussionFile: async () => {
                const result = await dialog.showOpenDialog({
                    title: ru.tray.findTitle,
                    properties: ['openFile'],
                    filters: [{ name: ru.fileType.name, extensions: ['branchchat'] }]
                })
                return result.canceled ? null : (result.filePaths[0] ?? null)
            },
            readDocumentId: (path) =>
                readDocument(path)
                    .then((d) => d.contents.manifest.documentId)
                    .catch(() => null),
            showError: async (message) => {
                await dialog.showMessageBox({ type: 'warning', title: ru.app.name, message })
            },
            quit: () => app.quit(),
            log: (message) => console.log(`[background] ${message}`)
        })
        const bg = background
        registerIpcHandlers(controller, settings, recent, association, updates, identity, sync, {
            onboarding,
            ui: electronUi,
            background: bg
        })
        // The File > Open recent menu, the taskbar jump list and every window follow the recent files list.
        const refreshRecent = async (): Promise<void> => {
            const files = await describeRecent(recent.list())
            Menu.setApplicationMenu(buildMenu(ctrl, updates, recent, files, () => bg.requestQuit()))
            applyJumpList(files)
            ctrl.broadcast(IPC.recentChanged, files)
        }
        recent.onChange(() => void refreshRecent())
        await refreshRecent()
        // Started without a file: reopen the most recent discussion if the person wants that and it still exists.
        // A file given on the command line always wins (the last file is not opened as well).
        let initialPaths = earlyPaths
        const last = recent.list()[0]
        if (
            initialPaths.length === 0 &&
            !startedInBackground &&
            settings.get().openLastFileOnStartup &&
            last
        ) {
            const [view] = await describeRecent([last])
            if (view?.exists) initialPaths = [last.path]
        }
        await sync.start()
        await bg.start()
        if (startedInBackground && initialPaths.length === 0) {
            // no synchronized discussion any more: nothing to do in the background
            if (!bg.keepsRunning) app.quit()
            return
        }
        await controller.openPaths(initialPaths)
        void association.offerAtStartup()

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) controller?.createWindow()
        })
    })

    app.on('before-quit', () => background?.quitStarted())
    // D-33: with a synchronized discussion the app stays in the tray; "Выход" closes it
    app.on('window-all-closed', () => {
        if (background) void background.windowsGone()
        else app.quit()
    })
}
