import { useEffect, useMemo, useRef, useState } from 'react'
import { normalizeSearchText } from '@shared/domain'
import { compareText, texts } from '@shared/i18n'
import type { DiscussionListItem, SidebarSettings } from '@shared/types/ipc'
import { formatTimestamp } from '../i18n/format'
import { withKeys } from '@shared/shortcuts'
import { ContextMenu, type MenuEntry } from './ContextMenu'
import { colorOf, initialsOf } from './sidebar/initials'

/** The ways to add a discussion. */
export type AddKind = 'local' | 'shared' | 'join' | 'import'

interface Props {
    discussions: readonly DiscussionListItem[]
    currentId: string | null
    settings: SidebarSettings
    /** IDs of the archived discussions. */
    archived: readonly string[]
    onChange(change: Partial<SidebarSettings>): void
    onOpen(id: string): void
    onOpenInNewWindow(id: string): void
    /** FR-215: the search in all discussions. */
    onSearchAll(): void
    onAdd(kind: AddKind): void
    onArchive(id: string, archived: boolean): void
    /** Asks first (the window shows the question). */
    onDelete(id: string): void
}

interface OpenMenu {
    x: number
    y: number
    /** The discussion the menu is for; absent: the list itself. */
    id?: string
}

/**
 * FR-221 to FR-225: the discussions of the library on the left of the window: name, time of the last message, unread
 * messages, marks for shared discussions and drafts. The list can be collapsed to small icons. A context menu (also
 * the "+" button) adds discussions; on a discussion it also opens, archives and deletes. Sort, filter, collapse and
 * width are kept in the settings.
 */
export function DiscussionSidebar({
    discussions,
    currentId,
    settings,
    archived,
    onChange,
    onOpen,
    onOpenInNewWindow,
    onSearchAll,
    onAdd,
    onArchive,
    onDelete
}: Props): React.JSX.Element {
    const [filter, setFilter] = useState('')
    const [width, setWidth] = useState(settings.width)
    const [menu, setMenu] = useState<OpenMenu | null>(null)
    const [showArchived, setShowArchived] = useState(false)
    const drag = useRef<{ startX: number; startWidth: number } | null>(null)
    // a narrow window: the full list lies over the discussion, so it is shown only on request (and closes after a choice)
    const narrow = useNarrow()
    const [overlayOpen, setOverlayOpen] = useState(false)
    const open = (id: string): void => {
        setOverlayOpen(false)
        onOpen(id)
    }
    const isArchived = useMemo(() => new Set(archived), [archived])

    const sorted = useMemo(() => {
        const q = normalizeSearchText(filter.trim())
        const list = q
            ? discussions.filter((d) => normalizeSearchText(d.title).includes(q))
            : [...discussions]
        if (settings.sort === 'name') list.sort((a, b) => compareText(a.title, b.title))
        else list.sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))
        return list
    }, [discussions, filter, settings.sort])
    const active = sorted.filter((d) => !isArchived.has(d.id))
    const inArchive = sorted.filter((d) => isArchived.has(d.id))
    // the archive opens by itself for a search and for the discussion on screen
    const archiveOpen =
        showArchived || filter.trim() !== '' || inArchive.some((d) => d.id === currentId)

    const addEntries: MenuEntry[] = [
        { id: 'add-local', label: texts().launcher.newDiscussion, onSelect: () => onAdd('local') },
        { id: 'add-shared', label: texts().launcher.newShared, onSelect: () => onAdd('shared') },
        { id: 'add-join', label: texts().launcher.joinShared, onSelect: () => onAdd('join') },
        {
            id: 'add-import',
            label: texts().launcher.openDiscussion,
            onSelect: () => onAdd('import')
        }
    ]
    const entriesFor = (id: string | undefined): MenuEntry[] => {
        if (!id) return addEntries
        const inArch = isArchived.has(id)
        return [
            { id: 'open', label: texts().sidebar.open, onSelect: () => open(id) },
            {
                id: 'new-window',
                label: texts().sidebar.newWindow,
                onSelect: () => onOpenInNewWindow(id)
            },
            {
                id: inArch ? 'restore' : 'archive',
                label: inArch ? texts().sidebar.restore : texts().sidebar.archive,
                onSelect: () => onArchive(id, !inArch)
            },
            {
                id: 'delete',
                label: texts().sidebar.remove,
                danger: true,
                onSelect: () => onDelete(id)
            },
            { separator: 'add' },
            ...addEntries
        ]
    }
    const contextMenu =
        (id?: string) =>
        (e: React.MouseEvent): void => {
            e.preventDefault()
            e.stopPropagation()
            // the context menu key gives no mouse position: the menu opens at the element
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            const fromKey = e.clientX === 0 && e.clientY === 0
            setMenu({
                x: fromKey ? r.left + 8 : e.clientX,
                y: fromKey ? r.top + Math.min(r.height, 24) : e.clientY,
                ...(id ? { id } : {})
            })
        }
    const addButton = (
        <button
            type="button"
            className="sidebar-add"
            data-testid="sidebar-add"
            title={texts().sidebar.add}
            aria-label={texts().sidebar.add}
            aria-haspopup="menu"
            onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                setMenu({ x: r.left, y: r.bottom + 2 })
            }}
        >
            +
        </button>
    )
    const menuView = menu && (
        <ContextMenu
            x={menu.x}
            y={menu.y}
            label={texts().sidebar.menu}
            entries={entriesFor(menu.id)}
            onClose={() => setMenu(null)}
        />
    )

    if (settings.collapsed || (narrow && !overlayOpen)) {
        const railItem = (d: DiscussionListItem): React.JSX.Element => (
            <li key={d.id} className={isArchived.has(d.id) ? 'rail-entry archived' : 'rail-entry'}>
                <button
                    type="button"
                    className={d.id === currentId ? 'rail-item current' : 'rail-item'}
                    data-testid="rail-item"
                    data-id={d.id}
                    title={d.title}
                    aria-label={
                        d.unreadCount > 0
                            ? `${d.title}, ${texts().sidebar.unread(d.unreadCount)}`
                            : d.title
                    }
                    aria-current={d.id === currentId ? 'true' : undefined}
                    onClick={() => open(d.id)}
                    onContextMenu={contextMenu(d.id)}
                >
                    <span
                        className="rail-icon"
                        aria-hidden="true"
                        style={{ background: colorOf(d.title) }}
                    >
                        {initialsOf(d.title)}
                    </span>
                    {d.synced && (
                        <span className="rail-shared" aria-hidden="true">
                            👥
                        </span>
                    )}
                    {d.unreadCount > 0 && (
                        <span className="rail-unread" aria-hidden="true">
                            {d.unreadCount > 99 ? '99+' : d.unreadCount}
                        </span>
                    )}
                </button>
            </li>
        )
        const all = [...discussions].sort((a, b) =>
            settings.sort === 'name'
                ? compareText(a.title, b.title)
                : (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '')
        )
        const railActive = all.filter((d) => !isArchived.has(d.id))
        const railArchived = all.filter((d) => isArchived.has(d.id))
        return (
            <nav
                className="sidebar-rail"
                data-testid="sidebar-rail"
                aria-label={texts().sidebar.title}
                onContextMenu={contextMenu()}
            >
                <button
                    type="button"
                    className="sidebar-show"
                    data-testid="sidebar-show"
                    title={texts().sidebar.show}
                    aria-label={texts().sidebar.show}
                    onClick={() => (narrow ? setOverlayOpen(true) : onChange({ collapsed: false }))}
                >
                    ▶
                </button>
                {addButton}
                <ul className="rail-list">
                    {railActive.map(railItem)}
                    {railArchived.length > 0 && (
                        <li
                            className="rail-divider"
                            role="separator"
                            aria-label={texts().sidebar.archived}
                        />
                    )}
                    {railArchived.map(railItem)}
                </ul>
                {menuView}
            </nav>
        )
    }

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

    const item = (d: DiscussionListItem): React.JSX.Element => (
        <li
            key={d.id}
            className={d.id === currentId ? 'sidebar-item current' : 'sidebar-item'}
            data-testid="sidebar-item"
            data-id={d.id}
            data-archived={isArchived.has(d.id) ? 'true' : undefined}
            onContextMenu={contextMenu(d.id)}
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
                        <span className="sidebar-mark" title={texts().sidebar.shared}>
                            {' '}
                            👥
                        </span>
                    )}
                    {d.hasDraft && (
                        <span
                            className="sidebar-mark"
                            data-testid="sidebar-draft"
                            title={texts().sidebar.draft}
                        >
                            {' '}
                            ✎
                        </span>
                    )}
                </span>
                <span className="sidebar-time">
                    {d.lastMessageAt
                        ? formatTimestamp(d.lastMessageAt)
                        : texts().launcher.noMessages}
                </span>
                {d.unreadCount > 0 && (
                    <span
                        className="panel-unread"
                        data-testid="sidebar-unread"
                        title={texts().unread.panelCount(d.unreadCount)}
                    >
                        {d.unreadCount}
                    </span>
                )}
            </button>
            <button
                type="button"
                className="sidebar-window"
                data-testid="sidebar-new-window"
                title={texts().sidebar.newWindow}
                aria-label={`${texts().sidebar.newWindow}: ${d.title}`}
                onClick={() => onOpenInNewWindow(d.id)}
            >
                ⧉
            </button>
        </li>
    )

    return (
        <nav
            className="sidebar"
            data-testid="sidebar"
            aria-label={texts().sidebar.title}
            style={{ width: `${width}px` }}
            onContextMenu={contextMenu()}
        >
            <div className="sidebar-head">
                <input
                    type="search"
                    className="sidebar-filter"
                    data-testid="sidebar-filter"
                    placeholder={texts().sidebar.filter}
                    aria-label={texts().sidebar.filter}
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                />
                <div className="sidebar-tools">
                    <select
                        data-testid="sidebar-sort"
                        aria-label={texts().sidebar.sort}
                        value={settings.sort}
                        onChange={(e) =>
                            onChange({ sort: e.target.value as SidebarSettings['sort'] })
                        }
                    >
                        <option value="activity">{texts().sidebar.byActivity}</option>
                        <option value="name">{texts().sidebar.byName}</option>
                    </select>
                    <button
                        type="button"
                        data-testid="sidebar-search-all"
                        title={withKeys(texts().search.searchAll, 'findAll')}
                        aria-label={texts().search.searchAll}
                        onClick={onSearchAll}
                    >
                        🔍
                    </button>
                    {addButton}
                    <button
                        type="button"
                        data-testid="sidebar-hide"
                        title={texts().sidebar.hide}
                        aria-label={texts().sidebar.hide}
                        onClick={() =>
                            narrow ? setOverlayOpen(false) : onChange({ collapsed: true })
                        }
                    >
                        ◀
                    </button>
                </div>
            </div>
            <ul className="sidebar-list">
                {active.map(item)}
                {sorted.length === 0 && <li className="panel-empty">{texts().sidebar.nothing}</li>}
                {inArchive.length > 0 && (
                    <li className="sidebar-group">
                        <button
                            type="button"
                            className="sidebar-group-toggle"
                            data-testid="sidebar-archived"
                            aria-expanded={archiveOpen}
                            onClick={() => setShowArchived(!archiveOpen)}
                        >
                            {archiveOpen ? '▾' : '▸'} {texts().sidebar.archived} ({inArchive.length}
                            )
                        </button>
                    </li>
                )}
                {archiveOpen && inArchive.map(item)}
            </ul>
            <div
                className="sidebar-resize"
                data-testid="sidebar-resize"
                role="separator"
                aria-orientation="vertical"
                aria-label={texts().sidebar.resize}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
            />
            {menuView}
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
