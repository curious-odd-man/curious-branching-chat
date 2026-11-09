import { app } from 'electron'
import type { RecentFileView } from '@shared/types/ipc'
import { jumpListCategories } from './jumpListCategories'

/** Windows only; other platforms have no jump list. Failures are not important (the list is a convenience). */
export function applyJumpList(files: readonly RecentFileView[]): void {
    if (process.platform !== 'win32') return
    try {
        app.setJumpList(jumpListCategories(files, process.execPath))
    } catch {
        // ignore
    }
}
