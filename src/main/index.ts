import { app, BrowserWindow, clipboard, dialog, Menu, session } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { release } from 'node:os'
import { ru } from '@shared/i18n/ru'
import { AppController } from './application/appController'
import { installAssetProtocol, registerAssetScheme } from './application/assetProtocol'
import { systemContext } from './application/clock'
import { createMainWindow } from './application/mainWindow'
import { buildMenu } from './application/menu'
import { describeDiscussions } from './application/recentView'
import { electronUi } from './application/ui'
import { IPC } from '@shared/types/ipc'
import {
    e2eBackgroundPorts,
    e2eKeyProtector,
    e2eLibraryFaults,
    e2eRegistry,
    e2eUpdaterConfig,
    installE2eHooks
} from './e2e/hooks'
import { BackgroundService } from './background/backgroundService'
import { electronLoginItem, electronNotifier, electronTray } from './background/electronPorts'
import { BACKGROUND_ARG } from './background/ports'
import { BackupService, LibraryService, Migration } from './library'
import { startLibrary } from './application/libraryStartup'
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
import { extractDiscussionIds, extractDiscussionPaths } from './windows/launchArgs'
import { guardConsoleStreams } from './windows/safeConsole'
import { Logger } from './log/logger'
import { saveDiagnosticsReport } from './log/saveReport'
import { ZoomService } from './windows/zoom'
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

// FR-321: the log file. Development and test runs also show the lines in the console.
const logger = new Logger({
    dir: join(app.getPath('userData'), 'logs'),
    ...(app.isPackaged ? {} : { mirror: (line: string) => console.log(line) })
})
const appLog = logger.area('app')
process.on('uncaughtExceptionMonitor', (err) => appLog.error('uncaught exception', err))
process.on('unhandledRejection', (reason) => appLog.error('unhandled rejection', reason))
// FR-301: set once the settings are loaded; windows made before that get the size when their page loads.
let zoom: ZoomService | null = null
app.on('web-contents-created', (_e, contents) => {
    if (contents.getType() === 'window') zoom?.attach(contents)
    const windowLog = logger.area('window')
    contents.on('render-process-gone', (_ev, details) =>
        windowLog.error(`window process ended: ${details.reason} (exit code ${details.exitCode})`)
    )
    contents.on('unresponsive', () => windowLog.warn('window does not respond'))
    contents.on('console-message', (event: unknown, ...rest: unknown[]) => {
        // Electron 45 gives one event object; older versions gave (event, level, message, line, source)
        const e = event as {
            level?: unknown
            message?: unknown
            lineNumber?: unknown
            sourceId?: unknown
        }
        const level = e.level ?? rest[0]
        if (level !== 'error' && level !== 3) return
        windowLog.error(
            `${String(e.message ?? rest[1])} (${String(e.sourceId ?? rest[3])}:${String(e.lineNumber ?? rest[2])})`
        )
    })
})

// One application instance; a second launch (e.g. double-clicking another .branchchat file) is forwarded here.
const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
    app.quit()
} else {
    let controller: AppController | null = null
    let background: BackgroundService | null = null
    const earlyPaths: string[] = extractDiscussionPaths(process.argv.slice(1))
    const earlyIds: string[] = extractDiscussionIds(process.argv.slice(1))
    // started by Windows at sign-in (FR-174): no window, only the tray
    const startedInBackground = process.argv.includes(BACKGROUND_ARG)

    app.on('second-instance', (_event, argv) => {
        const paths = extractDiscussionPaths(argv.slice(1))
        const ids = extractDiscussionIds(argv.slice(1))
        if (!controller) {
            earlyPaths.push(...paths)
            earlyIds.push(...ids)
        } else void controller.openPaths(paths, ids)
    })

    void app.whenReady().then(async () => {
        appLog.info(
            `start ${app.getVersion()} (Electron ${process.versions.electron}, ${process.platform} ${release()} ${process.arch})${startedInBackground ? ', in the background' : ''}`
        )
        const settings = new SettingsStore(app.getPath('userData'), randomUUID)
        const zoomService = new ZoomService({
            current: () => settings.get().textSize,
            save: (percent) => settings.setTextSize(percent),
            publish: (view) => controller?.broadcast(IPC.settingsChanged, view)
        })
        zoom = zoomService
        await settings.load()
        // The recent files list of release 1.5 and older: read only, for the migration of those files (FR-206).
        const recent = new RecentFilesStore(app.getPath('userData'))
        await recent.load()
        // ADR-003: the discussions of this computer, in %APPDATA%\BranchChat (library.sqlite and blobs\);
        // a restore that was asked for, the check, and a damaged library are handled first (FR-207, FR-208)
        const libraryLog = logger.area('library')
        const opened = await startLibrary({
            appDir: app.getPath('userData'),
            folder: () => settings.get().backupFolder,
            appVersion: app.getVersion(),
            ask: async (message, detail, buttons) =>
                (
                    await dialog.showMessageBox({
                        type: 'warning',
                        title: ru.app.name,
                        message,
                        detail,
                        buttons,
                        defaultId: 0,
                        noLink: true
                    })
                ).response,
            log: libraryLog,
            formatDate: (iso) =>
                new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short' }).format(
                    new Date(iso)
                )
        })
        if (!opened) {
            app.quit()
            return
        }
        const library = new LibraryService(opened)
        if (__E2E_HOOKS__) e2eLibraryFaults(library.repo as never)
        const backups = new BackupService(opened, {
            appDir: app.getPath('userData'),
            folder: () => settings.get().backupFolder,
            appVersion: app.getVersion(),
            log: (message) => libraryLog.info(message)
        })
        // ADR-003 Q-07: image files that nothing uses any more are removed after 7 days
        void library.repo
            .removeUnusedBlobs(7 * 24 * 3600 * 1000)
            .then((n) => n > 0 && libraryLog.info(`${n} unused image files removed`))
            .catch((err) => libraryLog.warn(`cleanup of image files failed: ${String(err)}`))
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
            library,
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
            log: (message) => logger.area('sync').info(message),
            onNewMessages: (arrival) => background?.newMessages(arrival),
            onStatusChange: () => void background?.refresh()
        })
        controller = new AppController({
            settings,
            library,
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
            port: new ElectronUpdaterPort({
                ...testUpdates?.options,
                logger: logger.area('updates')
            }),
            currentVersion: app.getVersion(),
            publish: (view) => ctrl.broadcast(IPC.updateChanged, view),
            openLink: openExternalLink,
            autoCheckEnabled: () => settings.get().autoUpdateCheck,
            log: (message) => logger.area('updates').info(message)
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
            library,
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
                isActive: (id) => ctrl.isActive(id),
                showAny: () => ctrl.showAny(),
                openDiscussion: async (id) => {
                    await ctrl.openDiscussion(id, undefined)
                },
                showMessage: (id, threadId, messageId) => ctrl.showMessage(id, threadId, messageId)
            },
            ...ports,
            quit: () => app.quit(),
            log: (message) => logger.area('background').info(message)
        })
        const bg = background
        // FR-206: the files of release 1.x are offered for the library at the first start
        const migration = new Migration({
            library,
            recent: () => recent.list(),
            registry: () => registry.list(),
            ownId: () => settings.get().participantId,
            log: (message) => logger.area('library').info(message)
        })
        const migrationPending = (await migration.candidates()).length > 0
        registerIpcHandlers(controller, settings, library, association, updates, identity, sync, {
            onboarding,
            ui: electronUi,
            background: bg,
            zoom: zoomService,
            migration,
            backups,
            relaunch: () => {
                // test builds only end; the test starts the app again
                if (!__E2E_HOOKS__) app.relaunch()
                app.exit(0)
            }
        })
        // FR-207: a backup once a day: shortly after the first start of the day, then checked every full hour
        const backupDelay = __E2E_HOOKS__
            ? Number(process.env['BRANCHCHAT_E2E_BACKUP_DELAY_MS'] ?? -1)
            : 60_000
        if (backupDelay >= 0) {
            const daily = (): void =>
                void backups
                    .dailyIfDue()
                    .catch((err) => libraryLog.error('daily backup failed', err))
            setTimeout(daily, backupDelay).unref()
            const toNextHour = 3600_000 - (Date.now() % 3600_000)
            setTimeout(() => {
                daily()
                setInterval(daily, 3600_000).unref()
            }, toNextHour).unref()
        }
        // The File > recent menu, the taskbar jump list and every start screen follow the library.
        const refreshRecent = (): void => {
            const list = describeDiscussions(library.list())
            const limit = settings.get().recentFilesLimit
            Menu.setApplicationMenu(
                buildMenu(
                    ctrl,
                    updates,
                    list,
                    limit,
                    () => bg.requestQuit(),
                    () =>
                        void saveDiagnosticsReport({
                            logger,
                            userData: app.getPath('userData'),
                            appVersion: app.getVersion()
                        }).catch((err) => appLog.error('report failed', err)),
                    (direction) => void zoomService.change(direction),
                    () =>
                        void backups
                            .make('manual')
                            .then(async (r) => {
                                await dialog.showMessageBox({
                                    type: r.folderError ? 'warning' : 'info',
                                    title: ru.app.name,
                                    message: ru.backup.done(
                                        new Intl.DateTimeFormat('ru-RU', {
                                            dateStyle: 'long',
                                            timeStyle: 'short'
                                        }).format(new Date(r.backups[0]!.createdAt))
                                    ),
                                    ...(r.folderError
                                        ? { detail: ru.backup.folderFailed(r.folderError) }
                                        : {})
                                })
                            })
                            .catch((err) => libraryLog.error('backup failed', err))
                )
            )
            applyJumpList(list, limit)
            ctrl.broadcast(IPC.libraryChanged, list)
        }
        let refreshTimer: NodeJS.Timeout | null = null
        library.onChange(() => {
            // several changes in a row (an import, opening a discussion) build the menu once
            if (refreshTimer) return
            refreshTimer = setTimeout(() => {
                refreshTimer = null
                refreshRecent()
            }, 50)
        })
        refreshRecent()
        // Started without a file: reopen the most recent discussion if the person wants that.
        // A file or a discussion given on the command line always wins (the last one is not opened as well).
        const initialPaths = earlyPaths
        let initialIds = earlyIds
        const last = describeDiscussions(library.list())[0]
        if (
            initialPaths.length === 0 &&
            initialIds.length === 0 &&
            !startedInBackground &&
            !migrationPending && // the start window asks about the old files first
            settings.get().openLastFileOnStartup &&
            last
        )
            initialIds = [last.id]
        await sync.start()
        await bg.start()
        if (startedInBackground && initialPaths.length === 0 && initialIds.length === 0) {
            // no synchronized discussion any more: nothing to do in the background
            if (!bg.keepsRunning) app.quit()
            return
        }
        await controller.openPaths(initialPaths, initialIds)
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
