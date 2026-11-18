import {
    daySeparators,
    previousDayKey,
    resolveQuoteRange,
    type ThreadContext
} from '@shared/domain'
import { texts } from '@shared/i18n'
import type { DocumentView } from '@shared/types/ipc'
import { richTextToPlain } from '@shared/validation'
import { formatDayLabel } from '../../i18n/format'
import type { ListRow } from './MessageList'

type Loading = DocumentView['loading'][number]

/** The same order as messages in a thread (FR-152): clock, then author ID, then message ID. */
export function compareByClock(
    a: { clock: number; authorId: string; messageId: string },
    b: { clock: number; authorId: string; messageId: string }
): number {
    const s = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0)
    return a.clock - b.clock || s(a.authorId, b.authorId) || s(a.messageId, b.messageId)
}

/**
 * The rows of the message list of a thread: the inherited context first (read-only), then the own messages of the
 * thread (FR-053, requirements 4.5), with the loading messages in their place (FR-152, D-37) and a separator before the
 * first message of each later day (FR-241).
 */
export function buildThreadRows(
    context: ThreadContext,
    loadingMessages: readonly Loading[],
    today: string
): ListRow[] {
    const thread = context.thread
    const out: ListRow[] = []
    if (thread.parentThreadId !== undefined && context.inherited.length > 0) {
        out.push({ kind: 'divider', id: 'context-start', label: texts().branches.contextCaption })
        for (const message of context.inherited) {
            const isSource = message.messageId === thread.sourceMessageId
            const highlight = isSource
                ? resolveQuoteRange(richTextToPlain(message.content), thread)
                : null
            out.push({ kind: 'message', message, inherited: true, highlight })
        }
        out.push({ kind: 'divider', id: 'context-end', label: texts().branches.contextDivider })
    }
    const loading = loadingMessages
        .filter((l) => l.threadId === thread.threadId)
        .sort((a, b) => compareByClock(a, b))
    let li = 0
    for (const message of context.own) {
        while (li < loading.length && compareByClock(loading[li]!, message) < 0)
            out.push({ kind: 'loading', loading: loading[li++]! })
        out.push({ kind: 'message', message, inherited: false, highlight: null })
    }
    while (li < loading.length) out.push({ kind: 'loading', loading: loading[li++]! })
    const yesterday = previousDayKey(today)
    const separators = daySeparators(out, (r) =>
        r.kind === 'message'
            ? r.message.createdAt
            : r.kind === 'loading'
              ? r.loading.createdAt
              : null
    )
    for (const { index, day } of [...separators].reverse())
        out.splice(index, 0, {
            kind: 'day',
            id: `day-${day}`,
            day,
            label: formatDayLabel(day, today, yesterday)
        })
    return out
}
