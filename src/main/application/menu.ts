import { app, dialog, Menu, type MenuItemConstructorOptions } from 'electron'
import { texts } from '@shared/i18n'
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
    /** "Выход": the whole application closes, also from the tray. */
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
            label: texts().menu.file,
            submenu: [
                {
                    label: texts().menu.newDiscussion,
                    accelerator: acceleratorOf('newDiscussion'),
                    click: () => controller.sendMenuCommand('new')
                },
                {
                    label: texts().menu.open,
                    accelerator: acceleratorOf('open'),
                    click: () => controller.sendMenuCommand('open')
                },
                {
                    label: texts().recent.menuTitle,
                    submenu: recentSubmenu(
                        discussions,
                        recentLimit,
                        (id) => void controller.openFromMenu(id)
                    )
                },
                { type: 'separator' },
                {
                    label: texts().menu.newShared,
                    click: () => controller.sendMenuCommand('new-shared')
                },
                {
                    label: texts().menu.joinShared,
                    click: () => controller.sendMenuCommand('join-shared')
                },
                {
                    label: texts().menu.makeShared,
                    click: () => controller.sendMenuCommand('make-shared')
                },
                {
                    label: texts().menu.inviteMember,
                    click: () => controller.sendMenuCommand('invite-member')
                },
                {
                    label: texts().menu.exportDiscussion,
                    click: () =>
                        void controller
                            .exportDiscussion(controller.focusedEntry())
                            .catch(() => undefined)
                },
                { type: 'separator' },
                { label: texts().menu.backupNow, click: () => backupNow() },
                { label: texts().menu.restore, click: () => controller.sendMenuCommand('restore') },
                { type: 'separator' },
                {
                    label: texts().menu.settings,
                    accelerator: acceleratorOf('settings'),
                    click: () => controller.sendMenuCommand('settings')
                },
                { type: 'separator' },
                { label: texts().menu.closeWindow, role: 'close' },
                // Alt+F4 closes only the window (Windows default); with a synchronized discussion the app stays in
                // the tray. "Выход" closes the whole application.
                { label: texts().menu.exit, click: () => exit() }
            ]
        },
        {
            label: texts().menu.edit,
            submenu: [
                { label: texts().menu.undo, role: 'undo' },
                { label: texts().menu.redo, role: 'redo' },
                { type: 'separator' },
                { label: texts().menu.cut, role: 'cut' },
                { label: texts().menu.copy, role: 'copy' },
                { label: texts().menu.paste, role: 'paste' },
                { label: texts().menu.selectAll, role: 'selectAll' }
            ]
        },
        {
            label: texts().menu.view,
            submenu: [
                // the keys are handled for each window (several keys, the keypad, the mouse wheel): the menu only
                // shows them
                {
                    label: texts().menu.zoomIn,
                    accelerator: acceleratorOf('zoomIn'),
                    registerAccelerator: false,
                    click: () => zoom('in')
                },
                {
                    label: texts().menu.zoomOut,
                    accelerator: acceleratorOf('zoomOut'),
                    registerAccelerator: false,
                    click: () => zoom('out')
                },
                {
                    label: texts().menu.zoomReset,
                    accelerator: acceleratorOf('zoomReset'),
                    registerAccelerator: false,
                    click: () => zoom('reset')
                },
                { type: 'separator' },
                {
                    label: texts().menu.jumpToDate,
                    accelerator: acceleratorOf('jumpToDate'),
                    click: () => controller.sendMenuCommand('jump-to-date')
                },
                {
                    label: texts().menu.find,
                    accelerator: acceleratorOf('find'),
                    click: () => controller.sendMenuCommand('find')
                },
                {
                    label: texts().menu.findAll,
                    accelerator: acceleratorOf('findAll'),
                    click: () => controller.sendMenuCommand('find-all')
                },
                {
                    label: texts().menu.branchMap,
                    accelerator: acceleratorOf('branchMap'),
                    click: () => controller.sendMenuCommand('branch-map')
                }
            ]
        },
        {
            label: texts().menu.help,
            submenu: [
                {
                    label: texts().menu.shortcuts,
                    accelerator: acceleratorOf('shortcuts'),
                    click: () => controller.sendMenuCommand('shortcuts')
                },
                { label: texts().menu.checkUpdates, click: () => void updates.checkManually() },
                { label: texts().menu.saveReport, click: () => saveReport() },
                { type: 'separator' },
                {
                    label: texts().menu.about,
                    click: () =>
                        void dialog.showMessageBox({
                            type: 'info',
                            title: texts().app.name,
                            message: texts().app.name,
                            detail: texts().app.version(app.getVersion()),
                            buttons: ['OK'],
                            noLink: true
                        })
                }
            ]
        }
    ]
    return Menu.buildFromTemplate(template)
}
