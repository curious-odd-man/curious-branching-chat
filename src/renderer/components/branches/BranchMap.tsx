import { useEffect, useMemo, useRef, useState } from 'react'
import { branchLabel, mainThread, type UnreadSummary } from '@shared/domain'
import { texts } from '@shared/i18n'
import type { DiscussionData, Thread } from '@shared/types'
import { Modal } from '../Modal'

interface Props {
    discussion: DiscussionData
    currentThreadId: string
    unread: UnreadSummary
    onSelect(threadId: string): void
    onClose(): void
}

interface Row {
    thread: Thread
    depth: number
    /** Shown only because a branch below it matches the filter. */
    context: boolean
}

/**
 * FR-271 to FR-273: all branches as a tree (title, state, messages, unread), the current one marked; filters "только
 * открытые" and "с непрочитанными"; arrows, Home, End, and Enter work like in a list.
 */
export function BranchMap({
    discussion,
    currentThreadId,
    unread,
    onSelect,
    onClose
}: Props): React.JSX.Element {
    const [onlyOpen, setOnlyOpen] = useState(false)
    const [onlyUnread, setOnlyUnread] = useState(false)
    const rows = useMemo(() => {
        const children = new Map<string, Thread[]>()
        for (const t of discussion.threads)
            if (t.parentThreadId !== undefined) {
                const list = children.get(t.parentThreadId) ?? []
                list.push(t)
                children.set(t.parentThreadId, list)
            }
        const matches = (t: Thread): boolean =>
            (!onlyOpen || t.parentThreadId === undefined || t.status === 'open') &&
            (!onlyUnread || (unread.byThread.get(t.threadId)?.own ?? 0) > 0)
        const out: Row[] = []
        const walk = (t: Thread, depth: number): boolean => {
            const at = out.length
            out.push({ thread: t, depth, context: false })
            let below = false
            for (const c of children.get(t.threadId) ?? []) below = walk(c, depth + 1) || below
            const self = matches(t)
            if (!self && !below && t.parentThreadId !== undefined) {
                out.length = at // nothing to show in this part of the tree
                return false
            }
            out[at]!.context = !self
            return true
        }
        walk(mainThread(discussion), 0)
        return out
    }, [discussion, onlyOpen, onlyUnread, unread])

    const initial = Math.max(
        0,
        rows.findIndex((r) => r.thread.threadId === currentThreadId)
    )
    const [focus, setFocus] = useState(initial)
    const items = useRef<Array<HTMLLIElement | null>>([])
    useEffect(() => {
        setFocus((f) => Math.min(f, Math.max(0, rows.length - 1)))
    }, [rows.length])
    useEffect(() => {
        items.current[focus]?.focus()
    }, [focus, rows])

    const onKeyDown = (e: React.KeyboardEvent): void => {
        if (e.key === 'ArrowDown') setFocus((f) => Math.min(rows.length - 1, f + 1))
        else if (e.key === 'ArrowUp') setFocus((f) => Math.max(0, f - 1))
        else if (e.key === 'Home') setFocus(0)
        else if (e.key === 'End') setFocus(rows.length - 1)
        else if (e.key === 'Enter' || e.key === ' ') {
            const row = rows[focus]
            if (row) onSelect(row.thread.threadId)
        } else if (e.key === 'Escape') onClose()
        else return
        e.preventDefault()
    }

    return (
        <Modal labelledBy="branch-map-title">
            <div className="dialog wide" data-testid="branch-map">
                <h2 id="branch-map-title">{texts().branchMap.title}</h2>
                <div className="branch-map-filters">
                    <label>
                        <input
                            type="checkbox"
                            data-testid="branch-map-open"
                            checked={onlyOpen}
                            onChange={(e) => setOnlyOpen(e.target.checked)}
                        />{' '}
                        {texts().branchMap.onlyOpen}
                    </label>
                    <label>
                        <input
                            type="checkbox"
                            data-testid="branch-map-unread"
                            checked={onlyUnread}
                            onChange={(e) => setOnlyUnread(e.target.checked)}
                        />{' '}
                        {texts().branchMap.onlyUnread}
                    </label>
                </div>
                <ul
                    className="branch-map"
                    role="tree"
                    aria-label={texts().branchMap.title}
                    onKeyDown={onKeyDown}
                >
                    {rows.map((row, i) => {
                        const t = row.thread
                        const isMain = t.parentThreadId === undefined
                        const own = unread.byThread.get(t.threadId)?.own ?? 0
                        const current = t.threadId === currentThreadId
                        return (
                            <li
                                key={t.threadId}
                                ref={(el) => {
                                    items.current[i] = el
                                }}
                                role="treeitem"
                                aria-level={row.depth + 1}
                                aria-selected={i === focus}
                                aria-current={current ? 'true' : undefined}
                                tabIndex={i === focus ? 0 : -1}
                                className={[
                                    'branch-map-item',
                                    current ? 'current' : '',
                                    row.context ? 'context' : '',
                                    !isMain && t.status === 'closed' ? 'closed' : ''
                                ]
                                    .filter(Boolean)
                                    .join(' ')}
                                style={{ paddingLeft: `${0.5 + row.depth * 1.2}rem` }}
                                data-testid="branch-map-item"
                                data-thread-id={t.threadId}
                                onClick={() => onSelect(t.threadId)}
                                onFocus={() => setFocus(i)}
                            >
                                <span className="branch-map-label">
                                    {isMain ? texts().branches.mainThread : branchLabel(t)}
                                </span>
                                {!isMain && (
                                    <span className="branch-map-state">
                                        {t.status === 'open'
                                            ? texts().branchMap.open
                                            : texts().branchMap.closed}
                                    </span>
                                )}
                                <span
                                    className="branch-map-count"
                                    title={texts().branchMap.messages}
                                >
                                    {texts().branchMap.count(t.messages.length)}
                                </span>
                                {own > 0 && (
                                    <span
                                        className="panel-unread"
                                        data-testid="branch-map-unread-count"
                                        title={texts().unread.panelCount(own)}
                                    >
                                        {own}
                                    </span>
                                )}
                            </li>
                        )
                    })}
                </ul>
                <div className="buttons">
                    <button type="button" data-testid="branch-map-close" onClick={onClose}>
                        {texts().branchMap.close}
                    </button>
                </div>
            </div>
        </Modal>
    )
}
