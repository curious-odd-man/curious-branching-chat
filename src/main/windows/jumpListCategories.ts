import type { JumpListCategory } from 'electron'
import type { DiscussionListItem } from '@shared/types/ipc'
import { texts } from '@shared/i18n'
import { DISCUSSION_ARG } from './launchArgs'

/** The taskbar jump list and the File menu show at most this many entries (Windows limits the jump list anyway). */
export const MENU_RECENT_LIMIT = 20

/** The "Недавние" category of the taskbar jump list. Each entry starts BranchChat with the discussion's ID. */
export function jumpListCategories(
    list: readonly DiscussionListItem[],
    execPath: string,
    limit = MENU_RECENT_LIMIT
): JumpListCategory[] {
    const items = list.slice(0, Math.min(limit, MENU_RECENT_LIMIT)).map((d) => ({
        type: 'task' as const,
        title: d.title,
        description: d.title,
        program: execPath,
        args: `${DISCUSSION_ARG}${d.id}`,
        iconPath: execPath,
        iconIndex: 0
    }))
    return items.length === 0
        ? []
        : [{ type: 'custom', name: texts().recent.jumpListCategory, items }]
}
