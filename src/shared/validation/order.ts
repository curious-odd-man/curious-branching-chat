import type { ChangeStamp, DiscussionData, Message, Thread } from './schemas'

/**
 * Logical-clock order (FR-152, FR-153; sync-protocol.md section 8).
 * Messages of a thread: (clock, authorId, messageId). Threads: (clock, createdBy, threadId). Strings compare by
 * UTF-16 code units, so every computer sorts the same way.
 */

function compareStrings(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0
}

export function compareMessages(a: Message, b: Message): number {
    return (
        a.clock - b.clock ||
        compareStrings(a.authorId, b.authorId) ||
        compareStrings(a.messageId, b.messageId)
    )
}

export function compareThreads(a: Thread, b: Thread): number {
    return (
        a.clock - b.clock ||
        compareStrings(a.createdBy, b.createdBy) ||
        compareStrings(a.threadId, b.threadId)
    )
}

/** True if `a` is a later change than `b` under last writer wins (FR-153). */
export function isLaterStamp(a: ChangeStamp, b: ChangeStamp): boolean {
    return a.clock !== b.clock ? a.clock > b.clock : compareStrings(a.by, b.by) > 0
}

/** The highest clock used anywhere in the discussion. */
export function maxClock(d: DiscussionData): number {
    let max = 0
    for (const t of d.threads) {
        if (t.clock > max) max = t.clock
        if (t.statusSet && t.statusSet.clock > max) max = t.statusSet.clock
        if (t.titleSet && t.titleSet.clock > max) max = t.titleSet.clock
        for (const m of t.messages) if (m.clock > max) max = m.clock
    }
    return max
}

/** Clock for a new local change: one higher than every clock in the discussion (FR-152). */
export function nextClock(d: DiscussionData): number {
    return maxClock(d) + 1
}

function isSorted<T>(items: readonly T[], compare: (a: T, b: T) => number): boolean {
    for (let i = 1; i < items.length; i++) if (compare(items[i - 1]!, items[i]!) > 0) return false
    return true
}

/**
 * Sorts threads and the messages of each thread, and makes `sequence` equal the position.
 * Returns the same object when nothing changes, so callers can skip a save.
 */
export function normalizeOrder(d: DiscussionData): DiscussionData {
    let changed = !isSorted(d.threads, compareThreads)
    const threads = [...d.threads].sort(compareThreads).map((t) => {
        const sorted = isSorted(t.messages, compareMessages)
        const messages = sorted ? t.messages : [...t.messages].sort(compareMessages)
        const needsSequence = messages.some((m, i) => m.sequence !== i)
        if (sorted && !needsSequence) return t
        changed = true
        return {
            ...t,
            messages: messages.map((m, i) => (m.sequence === i ? m : { ...m, sequence: i }))
        }
    })
    return changed ? { ...d, threads } : d
}

/** Problems with the order (used by the integrity check before every save). */
export function orderProblems(d: DiscussionData): string[] {
    const problems: string[] = []
    if (!isSorted(d.threads, compareThreads)) problems.push('threads are not in clock order')
    for (const t of d.threads) {
        if (!isSorted(t.messages, compareMessages))
            problems.push(`thread ${t.threadId}: messages are not in clock order`)
    }
    return problems
}
