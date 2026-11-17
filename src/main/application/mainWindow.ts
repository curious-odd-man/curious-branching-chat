import { app, BrowserWindow, Menu } from 'electron'
import { buildContextMenu } from './contextMenu'
import { join } from 'node:path'

/**
 * Test builds only (set by the e2e helper, see `src/main/e2e/hooks.ts`): windows open outside the visible screen and never
 * take the focus, so a test run does not interrupt the person at the computer. Release builds never read it.
 */
let quiet = false

export function setQuietWindows(value: boolean): void {
    quiet = value
}

export function quietWindows(): boolean {
    return quiet
}

/** Shows a window; in quiet mode without activating it. */
export function showWindow(win: BrowserWindow): void {
    if (quiet) win.showInactive()
    else win.show()
}

export function createMainWindow(): BrowserWindow {
    const win = new BrowserWindow({
        width: 1100,
        height: 760,
        minWidth: 720,
        minHeight: 480,
        show: false,
        ...(quiet ? { x: -30000, y: -30000, skipTaskbar: true } : {}),
        webPreferences: {
            // a quiet window is off the screen: keep timers and drawing at full speed
            ...(quiet ? { backgroundThrottling: false } : {}),
            preload: join(__dirname, '../preload/index.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
            spellcheck: true,
            // No developer tools in the installed application (the menu has none either).
            devTools: !app.isPackaged
        }
    })
    // The window title is set by the application (file name), not by the page's <title>.
    win.on('page-title-updated', (event) => event.preventDefault())
    win.webContents.on('context-menu', (_event, params) => {
        const items = buildContextMenu(win.webContents, params)
        if (items.length > 0) Menu.buildFromTemplate(items).popup()
    })
    win.once('ready-to-show', () => showWindow(win))

    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) void win.loadURL(devUrl)
    else void win.loadFile(join(__dirname, '../renderer/index.html'))
    return win
}
