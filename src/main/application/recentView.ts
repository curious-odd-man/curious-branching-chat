import type { DiscussionListItem } from '@shared/types/ipc'
import type { DiscussionSummary } from '../library/repository'

/** The discussions as the start screen and the menus show them: most recently used first. */
export function describeDiscussions(
    list: readonly DiscussionSummary[],
    unread: ReadonlyMap<string, number> = new Map(),
    drafts: ReadonlySet<string> = new Set()
): DiscussionListItem[] {
    return recentOrder(list).map((d) => ({
        id: d.id,
        title: d.title,
        lastMessageAt: d.lastMessageAt,
        messageCount: d.messageCount,
        synced: d.synced,
        unreadCount: unread.get(d.id) ?? 0,
        hasDraft: drafts.has(d.id)
    }))
}

/** Discussions in the order of the start screen and the recent menu: last opened, then last message, then created. */
export function recentOrder<
    T extends { openedAt: string | null; lastMessageAt: string | null; createdAt: string }
>(list: readonly T[]): T[] {
    const key = (d: T): string => d.openedAt ?? d.lastMessageAt ?? d.createdAt
    return [...list].sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0))
}
