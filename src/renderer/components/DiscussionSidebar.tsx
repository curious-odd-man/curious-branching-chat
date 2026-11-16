import { useEffect, useMemo, useRef, useState } from 'react'
import { normalizeSearchText } from '@shared/domain'
import { ru } from '@shared/i18n/ru'
import type { DiscussionListItem, SidebarSettings } from '@shared/types/ipc'
import { formatTimestamp } from '../i18n/format'
import { withKeys } from '@shared/shortcuts'

interface Props {
    discussions: readonly DiscussionListItem[]
    currentId: string | null
    settings: SidebarSettings
    onChange(change: Partial<SidebarSettings>): void
    onOpen(id: string): void
    onOpenInNewWindow(id: string): void
    /** FR-215: the search in all discussions. */
    onSearchAll(): void
}

/**
 * FR-221 to FR-225: the discussions of the library on the left of the window: name, time of the last message, unread
 * messages, marks for shared discussions and drafts. Sort, filter, hide, and width are kept in the settings.
 */
export function DiscussionSidebar({
    discussions,
    currentId,
    settings,
    onChange,
    onOpen,
    onOpenInNewWindow,
    onSearchAll
}: Props): React.JSX.Element {
    const [filter, setFilter] = useState('')
    const [width, setWidth] = useState(settings.width)
    const drag = useRef<{ startX: number; startWidth: number } | null>(null)
    // a narrow window: the list lies over the discussion, so it is shown only on request (and closes after a choice)
    const narrow = useNarrow()
    const [overlayOpen, setOverlayOpen] = useState(false)
    const open = (id: string): void => {
        setOverlayOpen(false)
        onOpen(id)
    }

    const shown = useMemo(() => {
        const q = normalizeSearchText(filter.trim())
        const list = q
            ? discussions.filter((d) => normalizeSearchText(d.title).includes(q))
            : [...discussions]
        if (settings.sort === 'name') list.sort((a, b) => a.title.localeCompare(b.title, 'ru'))
        else list.sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))
        return list
    }, [discussions, filter, settings.sort])

    if (settings.hidden || (narrow && !overlayOpen))
        return (
            <button
                type="button"
                className="sidebar-show"
                data-testid="sidebar-show"
                title={ru.sidebar.show}
                aria-label={ru.sidebar.show}
                onClick={() => (narrow ? setOverlayOpen(true) : onChange({ hidden: false }))}
            >
                ☰
            </button>
        )

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
        drag.current = { startX: e.clientX, startWidth: width }
        e.currentTarget.setPointerCapture(e.pointerId)
    }
    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
        if (!drag.current) return
        const next = drag.current.startWidth + e.clientX - drag.current.startX
        setWidth(Math.min(480, Math.max(180, Math.round(next))))
    }
    const onPointerUp = (): void => {
        if (!drag.current) return
        drag.current = null
        onChange({ width })
    }

    return (
        <nav
            className="sidebar"
            data-testid="sidebar"
            aria-label={ru.sidebar.title}
            style={{ width: `${width}px` }}
        >
            <div className="sidebar-head">
                <input
                    type="search"
                    data-testid="sidebar-filter"
                    placeholder={ru.sidebar.filter}
                    aria-label={ru.sidebar.filter}
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                />
                <select
                    data-testid="sidebar-sort"
                    aria-label={ru.sidebar.sort}
                    value={settings.sort}
                    onChange={(e) => onChange({ sort: e.target.value as SidebarSettings['sort'] })}
                >
                    <option value="activity">{ru.sidebar.byActivity}</option>
                    <option value="name">{ru.sidebar.byName}</option>
                </select>
                <button
                    type="button"
                    data-testid="sidebar-search-all"
                    title={withKeys(ru.search.searchAll, 'findAll')}
                    aria-label={ru.search.searchAll}
                    onClick={onSearchAll}
                >
                    🔍
                </button>
                <button
                    type="button"
                    data-testid="sidebar-hide"
                    title={ru.sidebar.hide}
                    aria-label={ru.sidebar.hide}
                    onClick={() => (narrow ? setOverlayOpen(false) : onChange({ hidden: true }))}
                >
                    ◀
                </button>
            </div>
            <ul className="sidebar-list">
                {shown.map((d) => (
                    <li
                        key={d.id}
                        className={d.id === currentId ? 'sidebar-item current' : 'sidebar-item'}
                        data-testid="sidebar-item"
                        data-id={d.id}
                    >
                        <button
                            type="button"
                            className="sidebar-open"
                            data-testid="sidebar-open"
                            aria-current={d.id === currentId ? 'true' : undefined}
                            onClick={() => open(d.id)}
                        >
                            <span className="sidebar-title">
                                {d.title}
                                {d.synced && (
                                    <span className="sidebar-mark" title={ru.sidebar.shared}>
                                        {' '}
                                        👥
                                    </span>
                                )}
                                {d.hasDraft && (
                                    <span
                                        className="sidebar-mark"
                                        data-testid="sidebar-draft"
                                        title={ru.sidebar.draft}
                                    >
                                        {' '}
                                        ✎
                                    </span>
                                )}
                            </span>
                            <span className="sidebar-time">
                                {d.lastMessageAt
                                    ? formatTimestamp(d.lastMessageAt)
                                    : ru.launcher.noMessages}
                            </span>
                            {d.unreadCount > 0 && (
                                <span
                                    className="panel-unread"
                                    data-testid="sidebar-unread"
                                    title={ru.unread.panelCount(d.unreadCount)}
                                >
                                    {d.unreadCount}
                                </span>
                            )}
                        </button>
                        <button
                            type="button"
                            className="sidebar-window"
                            data-testid="sidebar-new-window"
                            title={ru.sidebar.newWindow}
                            aria-label={`${ru.sidebar.newWindow}: ${d.title}`}
                            onClick={() => onOpenInNewWindow(d.id)}
                        >
                            ⧉
                        </button>
                    </li>
                ))}
                {shown.length === 0 && <li className="panel-empty">{ru.sidebar.nothing}</li>}
            </ul>
            <div
                className="sidebar-resize"
                data-testid="sidebar-resize"
                role="separator"
                aria-orientation="vertical"
                aria-label={ru.sidebar.resize}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
            />
        </nav>
    )
}

const NARROW = '(max-width: 1000px)'

function useNarrow(): boolean {
    const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches)
    useEffect(() => {
        const query = window.matchMedia(NARROW)
        const update = (): void => setNarrow(query.matches)
        query.addEventListener('change', update)
        return () => query.removeEventListener('change', update)
    }, [])
    return narrow
}
