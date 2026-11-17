import { branchLabel } from '@shared/domain'
import { texts } from '@shared/i18n'
import type { Thread } from '@shared/types'

interface Props {
    thread: Thread
    /** Threads from the main thread down to this branch (FR-061). */
    path: Thread[]
    onSelect(threadId: string): void
    onGoToSource(): void
    onSetTitle(title: string): void
    onSetStatus(status: 'open' | 'closed'): void
}

/** Top of a branch: where it sits, what it quotes, its title, and closing/reopening it. */
export function BranchHeader({
    thread,
    path,
    onSelect,
    onGoToSource,
    onSetTitle,
    onSetStatus
}: Props): React.JSX.Element {
    const closed = thread.status === 'closed'
    return (
        <header className="branch-header" data-testid="branch-header">
            <nav
                className="crumbs"
                aria-label={texts().branches.pathLabel}
                data-testid="branch-path"
            >
                {path.map((t, index) => {
                    const last = index === path.length - 1
                    const label =
                        t.parentThreadId === undefined
                            ? texts().branches.mainThread
                            : branchLabel(t)
                    return (
                        <span key={t.threadId} className="crumb">
                            {last ? (
                                <strong aria-current="page">{label}</strong>
                            ) : (
                                <button type="button" onClick={() => onSelect(t.threadId)}>
                                    {label}
                                </button>
                            )}
                            {!last && <span aria-hidden="true"> › </span>}
                        </span>
                    )
                })}
            </nav>
            {thread.quoteText && (
                <blockquote
                    className="branch-quote"
                    data-testid="branch-quote"
                    aria-label={texts().branches.quoteLabel}
                >
                    {thread.quoteText}
                </blockquote>
            )}
            <div className="branch-actions">
                <input
                    // remounts when the branch or its title changes elsewhere, so the field always shows the saved title
                    key={`${thread.threadId}:${thread.title ?? ''}`}
                    data-testid="branch-title"
                    aria-label={texts().branches.titleLabel}
                    placeholder={texts().branches.titlePlaceholder}
                    defaultValue={thread.title ?? ''}
                    onBlur={(e) => {
                        if (e.target.value.trim() !== (thread.title ?? ''))
                            onSetTitle(e.target.value)
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur()
                    }}
                />
                <button type="button" data-testid="go-to-source" onClick={onGoToSource}>
                    {texts().branches.goToSource}
                </button>
                <button
                    type="button"
                    data-testid="branch-toggle"
                    onClick={() => onSetStatus(closed ? 'open' : 'closed')}
                >
                    {closed ? texts().branches.reopen : texts().branches.close}
                </button>
            </div>
        </header>
    )
}
