import {
    app,
    Menu,
    Notification,
    Tray,
    nativeImage,
    type MenuItemConstructorOptions
} from 'electron'
import { join } from 'node:path'
import { ru } from '@shared/i18n/ru'
import { BACKGROUND_ARG, type LoginItemPort, type NotifierPort, type TrayPort } from './ports'

/** The icon file of the tray: shipped next to the app (extraResources), or the build folder in a development run. */
function trayIconPath(): string {
    return app.isPackaged
        ? join(process.resourcesPath, 'tray.ico')
        : join(app.getAppPath(), 'build', 'icon.ico')
}

export function electronTray(): TrayPort {
    let tray: Tray | null = null
    let click: () => void = () => undefined
    return {
        show(items, onAction, onClick) {
            click = onClick
            if (!tray) {
                tray = new Tray(nativeImage.createFromPath(trayIconPath()))
                tray.setToolTip(ru.tray.tooltip)
                // left click: open (D-42); right click shows the context menu (Windows default)
                tray.on('click', () => click())
            }
            const template: MenuItemConstructorOptions[] = items.map((item) =>
                item.kind === 'separator'
                    ? { type: 'separator' }
                    : item.kind === 'info'
                      ? { label: item.label, enabled: false }
                      : { label: item.label, click: () => onAction(item.id) }
            )
            tray.setContextMenu(Menu.buildFromTemplate(template))
        },
        hide() {
            tray?.destroy()
            tray = null
        }
    }
}

export function electronNotifier(): NotifierPort {
    // A reference keeps each notification alive until it is clicked or closed (otherwise the click can be lost).
    const alive = new Set<Notification>()
    return {
        show({ title, body, onClick }) {
            if (!Notification.isSupported()) return
            const n = new Notification({ title, body, silent: false })
            alive.add(n)
            n.on('click', () => {
                alive.delete(n)
                onClick()
            })
            n.on('close', () => alive.delete(n))
            n.show()
        }
    }
}

/** HKCU Run entry "BranchChat" (the uninstaller removes it, build/installer.nsh). */
export function electronLoginItem(): LoginItemPort {
    return {
        set(enabled) {
            if (process.platform !== 'win32' || !app.isPackaged) return
            app.setLoginItemSettings({
                openAtLogin: enabled,
                path: process.execPath,
                args: [BACKGROUND_ARG],
                name: 'BranchChat'
            })
        }
    }
}
