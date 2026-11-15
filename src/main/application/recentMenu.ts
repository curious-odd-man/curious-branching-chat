import type { MenuItemConstructorOptions } from 'electron'
import { ru } from '@shared/i18n/ru'
import type { DiscussionListItem } from '@shared/types/ipc'

/** The File > recent submenu: the most recently used discussions. */
export function recentSubmenu(
    list: readonly DiscussionListItem[],
    limit: number,
    open: (id: string) => void
): MenuItemConstructorOptions[] {
    const shown = list.slice(0, limit)
    if (shown.length === 0) return [{ label: ru.recent.menuEmpty, enabled: false }]
    return shown.map((d): MenuItemConstructorOptions => ({
        label: d.title,
        click: () => open(d.id)
    }))
}
