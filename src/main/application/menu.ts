import { app, dialog, Menu, type MenuItemConstructorOptions } from 'electron'
import { ru } from '@shared/i18n/ru'
import { acceleratorOf } from '@shared/shortcuts'
import type { DiscussionListItem } from '@shared/types/ipc'
import type { UpdateService } from '../updates/updateService'
import { recentSubmenu } from './recentMenu'
import type { AppController } from './appController'

export function buildMenu(
    controller: AppController,
    updates: UpdateService,
    discussions: readonly DiscussionListItem[],
    recentLimit: number,
    /** "Выход": the whole application closes, also from the tray (release 1.4). */
    exit: () => void = () => app.quit(),
    /** "Справка > Сохранить отчёт…" (FR-323). */
    saveReport: () => void = () => undefined,
    /** "Вид": text size (FR-301). */
    zoom: (direction: 'in' | 'out' | 'reset') => void = () => undefined,
    /** "Резервная копия сейчас" (FR-207). */
    backupNow: () => void = () => undefined
): Menu {
    const template: MenuItemConstructorOptions[] = [
        {
            label: ru.menu.file,
            submenu: [
                {
                    label: ru.menu.newDiscussion,
                    accelerator: acceleratorOf('newDiscussion'),
                    click: () => controller.sendMenuCommand('new')
                },
                {
                    label: ru.menu.open,
                    accelerator: acceleratorOf('open'),
                    click: () => controller.sendMenuCommand('open')
                },
                {
                    label: ru.recent.menuTitle,
                    submenu: recentSubmenu(
                        discussions,
                        recentLimit,
                        (id) => void controller.openFromMenu(id)
                    )
                },
                { type: 'separator' },
                { label: ru.menu.newShared, click: () => controller.sendMenuCommand('new-shared') },
                {
                    label: ru.menu.joinShared,
                    click: () => controller.sendMenuCommand('join-shared')
                },
                {
                    label: ru.menu.makeShared,
                    click: () => controller.sendMenuCommand('make-shared')
                },
                {
                    label: ru.menu.inviteMember,
                    click: () => controller.sendMenuCommand('invite-member')
                },
                {
                    label: ru.menu.exportDiscussion,
                    click: () =>
                        void controller
                            .exportDiscussion(controller.focusedEntry())
                            .catch(() => undefined)
                },
                { type: 'separator' },
                { label: ru.menu.backupNow, click: () => backupNow() },
                { label: ru.menu.restore, click: () => controller.sendMenuCommand('restore') },
                { type: 'separator' },
                {
                    label: ru.menu.settings,
                    accelerator: acceleratorOf('settings'),
                    click: () => controller.sendMenuCommand('settings')
                },
                { type: 'separator' },
                { label: ru.menu.closeWindow, role: 'close' },
                // Alt+F4 closes only the window (Windows default); with a synchronized discussion the app stays in
                // the tray. "Выход" closes the whole application.
                { label: ru.menu.exit, click: () => exit() }
            ]
        },
        {
            label: ru.menu.edit,
            submenu: [
                { label: ru.menu.undo, role: 'undo' },
                { label: ru.menu.redo, role: 'redo' },
                { type: 'separator' },
                { label: ru.menu.cut, role: 'cut' },
                { label: ru.menu.copy, role: 'copy' },
                { label: ru.menu.paste, role: 'paste' },
                { label: ru.menu.selectAll, role: 'selectAll' }
            ]
        },
        {
            label: ru.menu.view,
            submenu: [
                // the keys are handled for each window (several keys, the keypad, the mouse wheel): the menu only
                // shows them
                {
                    label: ru.menu.zoomIn,
                    accelerator: acceleratorOf('zoomIn'),
                    registerAccelerator: false,
                    click: () => zoom('in')
                },
                {
                    label: ru.menu.zoomOut,
                    accelerator: acceleratorOf('zoomOut'),
                    registerAccelerator: false,
                    click: () => zoom('out')
                },
                {
                    label: ru.menu.zoomReset,
                    accelerator: acceleratorOf('zoomReset'),
                    registerAccelerator: false,
                    click: () => zoom('reset')
                },
                { type: 'separator' },
                {
                    label: ru.menu.jumpToDate,
                    accelerator: acceleratorOf('jumpToDate'),
                    click: () => controller.sendMenuCommand('jump-to-date')
                },
                {
                    label: ru.menu.find,
                    accelerator: acceleratorOf('find'),
                    click: () => controller.sendMenuCommand('find')
                },
                {
                    label: ru.menu.findAll,
                    accelerator: acceleratorOf('findAll'),
                    click: () => controller.sendMenuCommand('find-all')
                },
                {
                    label: ru.menu.branchMap,
                    accelerator: acceleratorOf('branchMap'),
                    click: () => controller.sendMenuCommand('branch-map')
                }
            ]
        },
        {
            label: ru.menu.help,
            submenu: [
                {
                    label: ru.menu.shortcuts,
                    accelerator: acceleratorOf('shortcuts'),
                    click: () => controller.sendMenuCommand('shortcuts')
                },
                { label: ru.menu.checkUpdates, click: () => void updates.checkManually() },
                { label: ru.menu.saveReport, click: () => saveReport() },
                { type: 'separator' },
                {
                    label: ru.menu.about,
                    click: () =>
                        void dialog.showMessageBox({
                            type: 'info',
                            title: ru.app.name,
                            message: ru.app.name,
                            detail: ru.app.version(app.getVersion()),
                            buttons: ['OK'],
                            noLink: true
                        })
                }
            ]
        }
    ]
    return Menu.buildFromTemplate(template)
}
