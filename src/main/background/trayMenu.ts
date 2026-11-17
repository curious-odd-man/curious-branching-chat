import { compareText, texts } from '@shared/i18n'
import type { SyncHealth } from '../sync/conversationSync'

/** One registered synchronized discussion as the tray menu sees it. */
export interface TrayDiscussion {
    conversationId: string
    title: string
    /** Null: the sync of this discussion did not start. */
    health: SyncHealth | null
}

export type TrayItem =
    | { kind: 'action'; id: string; label: string }
    | { kind: 'info'; label: string }
    | { kind: 'separator' }

/**
 * The tray menu (D-33, D-35): open, the discussions, the sync state, "Проверить папки", "Выход". Action IDs:
 * `open`, `open:<conversationId>`, `check`, `exit`.
 */
export function trayMenuModel(discussions: readonly TrayDiscussion[]): TrayItem[] {
    const items: TrayItem[] = [{ kind: 'action', id: 'open', label: texts().tray.open }]
    items.push({ kind: 'separator' }, { kind: 'info', label: texts().tray.discussions })
    if (discussions.length === 0) items.push({ kind: 'info', label: texts().tray.noDiscussions })
    const sorted = [...discussions].sort((a, b) => compareText(a.title, b.title))
    for (const d of sorted)
        items.push({ kind: 'action', id: `open:${d.conversationId}`, label: d.title })
    items.push({ kind: 'separator' })
    const problems: string[] = []
    for (const d of sorted) {
        const name = d.title
        const h = d.health
        if (!h) continue
        if (h.folder === 'missing') problems.push(texts().tray.status.missing(name))
        else if (h.folder === 'no-permission') problems.push(texts().tray.status.denied(name))
        else if (h.keyRequests.some((r) => r.state === 'pending'))
            problems.push(texts().tray.status.keys(name))
        else if (h.quarantined > 0 || h.needsUpdate)
            problems.push(texts().tray.status.problem(name))
    }
    if (problems.length === 0) {
        if (sorted.some((d) => d.health))
            items.push({ kind: 'info', label: texts().tray.status.ok })
    } else for (const p of problems) items.push({ kind: 'info', label: p })
    items.push(
        { kind: 'action', id: 'check', label: texts().tray.checkFolders },
        { kind: 'separator' },
        { kind: 'action', id: 'exit', label: texts().tray.exit }
    )
    return items
}
