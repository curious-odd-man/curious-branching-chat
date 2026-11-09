import { useMemo } from 'react'
import {
    branchLabel,
    groupedForest,
    type GroupedBranchNode,
    type UnreadSummary
} from '@shared/domain'
import { ru } from '@shared/i18n/ru'
import type { DiscussionData } from '@shared/types'

interface Props {
    discussion: DiscussionData
    currentThreadId: string
    mainThreadId: string
    /** Unread messages per thread, and in the branches below it (FR-113). */
    unread: UnreadSummary
    onSelect(threadId: string): void
}

/** Side panel: the main discussion, then active and closed branches as trees (FR-030 to FR-033, FR-061). */
export function BranchPanel({
    discussion,
    currentThreadId,
    mainThreadId,
    unread,
    onSelect
}: Props): React.JSX.Element {
    const active = useMemo(() => groupedForest(discussion, 'open'), [discussion])
    const closed = useMemo(() => groupedForest(discussion, 'closed'), [discussion])

    const renderNodes = (nodes: GroupedBranchNode[], depth: number): React.ReactNode =>
        nodes.map((node) => {
            const t = node.thread
            return (
                <li key={t.threadId}>
                    <button
                        type="button"
                        className={
                            t.threadId === currentThreadId ? 'panel-item active' : 'panel-item'
                        }
                        style={{ paddingLeft: `${0.6 + depth * 0.9}rem` }}
                        aria-current={t.threadId === currentThreadId ? 'true' : undefined}
                        data-testid="panel-branch"
                        data-thread-id={t.threadId}
                        title={t.quoteText ?? ''}
                        onClick={() => onSelect(t.threadId)}
                    >
                        <span className="panel-label">{branchLabel(t)}</span>
                        {node.hiddenParent && (
                            <small className="panel-hint">
                                {ru.branches.belongsTo(branchLabel(node.hiddenParent))}
                            </small>
                        )}
                        <UnreadMarks counts={unread.byThread.get(t.threadId)} />
                        <span className="panel-count">{t.messages.length}</span>
                    </button>
                    {node.children.length > 0 && <ul>{renderNodes(node.children, depth + 1)}</ul>}
                </li>
            )
        })

    return (
        <aside
            className="branch-panel"
            aria-label={ru.branches.panelTitle}
            data-testid="branch-panel"
        >
            <button
                type="button"
                className={
                    mainThreadId === currentThreadId ? 'panel-item main active' : 'panel-item main'
                }
                aria-current={mainThreadId === currentThreadId ? 'true' : undefined}
                data-testid="panel-main"
                onClick={() => onSelect(mainThreadId)}
            >
                <span className="panel-label">{ru.branches.mainThread}</span>
                <UnreadMarks counts={unread.byThread.get(mainThreadId)} />
            </button>

            <section data-testid="panel-active">
                <h2>{ru.branches.active}</h2>
                {active.length > 0 ? (
                    <ul>{renderNodes(active, 0)}</ul>
                ) : (
                    <p className="panel-empty">{ru.branches.noBranches}</p>
                )}
            </section>

            {closed.length > 0 && (
                <section data-testid="panel-closed">
                    <h2>{ru.branches.closed}</h2>
                    <ul>{renderNodes(closed, 0)}</ul>
                </section>
            )}
        </aside>
    )
}

/** Number of unread messages in the thread, and a dot when branches below it have unread messages. */
function UnreadMarks({
    counts
}: {
    counts: { own: number; descendants: number } | undefined
}): React.JSX.Element | null {
    if (!counts || (counts.own === 0 && counts.descendants === 0)) return null
    return (
        <>
            {counts.own > 0 && (
                <span
                    className="panel-unread"
                    data-testid="panel-unread"
                    title={ru.unread.panelCount(counts.own)}
                >
                    {counts.own}
                </span>
            )}
            {counts.descendants > 0 && (
                <span
                    className="panel-dot"
                    data-testid="panel-dot"
                    title={ru.unread.descendantsHint}
                    aria-label={ru.unread.descendantsHint}
                >
                    ●
                </span>
            )}
        </>
    )
}
