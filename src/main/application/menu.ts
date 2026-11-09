import { app, dialog, Menu, type MenuItemConstructorOptions } from 'electron'
import { ru } from '@shared/i18n/ru'
import type { RecentFileView } from '@shared/types/ipc'
import type { RecentFilesStore } from '../local-state/recentFiles'
import type { UpdateService } from '../updates/updateService'
import { recentSubmenu } from './recentMenu'
import type { AppController } from './appController'

export function buildMenu(
  controller: AppController,
  updates: UpdateService,
  recent: RecentFilesStore,
  recentFiles: readonly RecentFileView[]
): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: ru.menu.file,
      submenu: [
        {
          label: ru.menu.newDiscussion,
          accelerator: 'CmdOrCtrl+N',
          click: () => controller.sendMenuCommand('new')
        },
        {
          label: ru.menu.open,
          accelerator: 'CmdOrCtrl+O',
          click: () => controller.sendMenuCommand('open')
        },
        {
          label: ru.recent.menuTitle,
          submenu: recentSubmenu(
            recentFiles,
            (path) => void controller.openFromMenu(path),
            () => void recent.clear()
          )
        },
        { type: 'separator' },
        {
          label: ru.menu.settings,
          accelerator: 'CmdOrCtrl+,',
          click: () => controller.sendMenuCommand('settings')
        },
        { type: 'separator' },
        { label: ru.menu.closeWindow, role: 'close' },
        { label: ru.menu.exit, accelerator: 'Alt+F4', click: () => app.quit() }
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
      label: ru.menu.help,
      submenu: [
        { label: ru.menu.checkUpdates, click: () => void updates.checkManually() },
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
