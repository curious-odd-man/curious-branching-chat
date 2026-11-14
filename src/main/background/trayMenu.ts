import { win32 } from 'node:path'
import { ru } from '@shared/i18n/ru'
import type { SyncHealth } from '../sync/conversationSync'

/** One registered synchronized discussion as the tray menu sees it. */
export interface TrayDiscussion {
    conversationId: string
    filePath: string
    /** False: the registered file is missing (D-27). */
    exists: boolean
    /** Null: the sync of this discussion did not start. */
    health: SyncHealth | null
}

export type TrayItem =
    | { kind: 'action'; id: string; label: string }
    | { kind: 'info'; label: string }
    | { kind: 'separator' }

/** Name of a discussion in the tray menu: the file name without the extension. */
export function discussionName(filePath: string): string {
    // win32 accepts both separators, so the name is right on any platform
    return win32.basename(filePath).replace(/\.branchchat$/i, '')
}

/**
 * The tray menu (D-33, D-35, D-27): open, the discussions (a missing file has "Найти файл…"), the sync state,
 * "Проверить папки", "Выход". Action IDs: `open`, `open:<conversationId>`, `find:<conversationId>`, `check`, `exit`.
 */
export function trayMenuModel(discussions: readonly TrayDiscussion[]): TrayItem[] {
    const items: TrayItem[] = [{ kind: 'action', id: 'open', label: ru.tray.open }]
    items.push({ kind: 'separator' }, { kind: 'info', label: ru.tray.discussions })
    if (discussions.length === 0) items.push({ kind: 'info', label: ru.tray.noDiscussions })
    const sorted = [...discussions].sort((a, b) =>
        discussionName(a.filePath).localeCompare(discussionName(b.filePath), 'ru')
    )
    for (const d of sorted) {
        const name = discussionName(d.filePath)
        if (d.exists) items.push({ kind: 'action', id: `open:${d.conversationId}`, label: name })
        else
            items.push(
                { kind: 'info', label: ru.tray.missingFile(name) },
                { kind: 'action', id: `find:${d.conversationId}`, label: ru.tray.findFile(name) }
            )
    }
    items.push({ kind: 'separator' })
    const problems: string[] = []
    for (const d of sorted) {
        const name = discussionName(d.filePath)
        const h = d.health
        if (!h) continue
        if (h.folder === 'missing') problems.push(ru.tray.status.missing(name))
        else if (h.folder === 'no-permission') problems.push(ru.tray.status.denied(name))
        else if (h.keyRequests.some((r) => r.state === 'pending'))
            problems.push(ru.tray.status.keys(name))
        else if (h.quarantined > 0 || h.needsUpdate) problems.push(ru.tray.status.problem(name))
    }
    if (problems.length === 0) {
        if (sorted.some((d) => d.health)) items.push({ kind: 'info', label: ru.tray.status.ok })
    } else for (const p of problems) items.push({ kind: 'info', label: p })
    items.push(
        { kind: 'action', id: 'check', label: ru.tray.checkFolders },
        { kind: 'separator' },
        { kind: 'action', id: 'exit', label: ru.tray.exit }
    )
    return items
}
