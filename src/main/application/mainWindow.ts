import { app, BrowserWindow, Menu } from 'electron'
import { buildContextMenu } from './contextMenu'
import { join } from 'node:path'

export function createMainWindow(): BrowserWindow {
    const win = new BrowserWindow({
        width: 1100,
        height: 760,
        minWidth: 720,
        minHeight: 480,
        show: false,
        webPreferences: {
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
    win.once('ready-to-show', () => win.show())

    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) void win.loadURL(devUrl)
    else void win.loadFile(join(__dirname, '../renderer/index.html'))
    return win
}
