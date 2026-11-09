import type { MenuItemConstructorOptions } from 'electron'
import { ru } from '@shared/i18n/ru'
import type { RecentFileView } from '@shared/types/ipc'
import { MENU_RECENT_LIMIT } from '../windows/jumpListCategories'

/** The File > Open recent submenu: the newest files, files that are gone shown disabled, and "Clear list". */
export function recentSubmenu(
    files: readonly RecentFileView[],
    open: (path: string) => void,
    clear: () => void
): MenuItemConstructorOptions[] {
    if (files.length === 0) return [{ label: ru.recent.menuEmpty, enabled: false }]
    return [
        ...files.slice(0, MENU_RECENT_LIMIT).map((f): MenuItemConstructorOptions =>
            f.exists
                ? { label: f.name, toolTip: f.path, click: () => open(f.path) }
                : {
                      label: `${f.name} (${ru.recent.menuMissing})`,
                      toolTip: f.path,
                      enabled: false
                  }
        ),
        { type: 'separator' },
        { label: ru.recent.menuClear, click: clear }
    ]
}
