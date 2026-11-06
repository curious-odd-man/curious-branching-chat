import { app, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { AppController } from './application/appController'
import { installAssetProtocol, registerAssetScheme } from './application/assetProtocol'
import { systemContext } from './application/clock'
import { createMainWindow } from './application/mainWindow'
import { installMenu } from './application/menu'
import { electronUi } from './application/ui'
import { installE2eHooks } from './e2e/hooks'
import { registerIpcHandlers } from './ipc/handlers'
import { SettingsStore } from './local-state/settings'
import { extractDiscussionPaths } from './windows/launchArgs'
import { applyGlobalSecurity } from './windows/security'

// Test builds only (`--mode e2e`): stub native dialogs and use an isolated profile (own settings and own
// single-instance lock). Release builds contain none of this.
if (__E2E_HOOKS__) {
  installE2eHooks()
  const userDataOverride = process.env['BRANCHCHAT_USER_DATA']
  if (userDataOverride) app.setPath('userData', userDataOverride)
}

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
    controller = new AppController({
      settings,
      ui: electronUi,
      ctx: systemContext,
      appVersion: app.getVersion(),
      createWindow: createMainWindow
    })
    installAssetProtocol(controller)
    applyGlobalSecurity()
    registerIpcHandlers(controller, settings)
    installMenu(controller)
    await controller.openPaths(earlyPaths)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) controller?.createWindow()
    })
  })

  app.on('window-all-closed', () => app.quit())
}
