import { app } from 'electron'
import type { DiscussionListItem } from '@shared/types/ipc'
import { jumpListCategories } from './jumpListCategories'

/** Windows only; other platforms have no jump list. Failures are not important (the list is a convenience). */
export function applyJumpList(list: readonly DiscussionListItem[], limit: number): void {
    if (process.platform !== 'win32') return
    try {
        app.setJumpList(jumpListCategories(list, process.execPath, limit))
    } catch {
        // ignore
    }
}
