import type { JumpListCategory } from 'electron'
import type { RecentFileView } from '@shared/types/ipc'
import { ru } from '@shared/i18n/ru'

/** The taskbar jump list and the File menu show at most this many entries (Windows limits the jump list anyway). */
export const MENU_RECENT_LIMIT = 20

/**
 * The "Недавние" category of the taskbar jump list. Each entry starts BranchChat with the file as an argument, so it
 * works whether or not the .branchchat association is registered. Missing files are left out.
 */
export function jumpListCategories(
  files: readonly RecentFileView[],
  execPath: string
): JumpListCategory[] {
  const items = files
    .filter((f) => f.exists)
    .slice(0, MENU_RECENT_LIMIT)
    .map((f) => ({
      type: 'task' as const,
      title: f.name,
      description: f.path,
      program: execPath,
      args: `"${f.path}"`,
      iconPath: execPath,
      iconIndex: 0
    }))
  return items.length === 0 ? [] : [{ type: 'custom', name: ru.recent.jumpListCategory, items }]
}
