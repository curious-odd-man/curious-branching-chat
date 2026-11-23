// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DiscussionListItem } from '@shared/types/ipc'
import { DiscussionSidebar } from '../../src/renderer/components/DiscussionSidebar'
import { installDomStubs, SETTINGS } from './helpers/fakeApi'

installDomStubs()

const item = (
    id: string,
    title: string,
    at: string | null,
    more: Partial<DiscussionListItem> = {}
) => ({
    id,
    title,
    lastMessageAt: at,
    messageCount: 1,
    synced: false,
    unreadCount: 0,
    hasDraft: false,
    ...more
})

const LIST = [
    item('d1', 'Бюджет', '2026-11-01T10:00:00.000Z'),
    item('d2', 'Аренда', '2026-11-03T10:00:00.000Z', { unreadCount: 2 }),
    item('d3', 'Абажур', null, { hasDraft: true })
]

const show = (
    sort: 'activity' | 'name' = 'activity',
    collapsed = false,
    archived: string[] = []
) => {
    const handlers = {
        onChange: vi.fn(),
        onOpen: vi.fn(),
        onOpenInNewWindow: vi.fn(),
        onSearchAll: vi.fn(),
        onAdd: vi.fn(),
        onArchive: vi.fn(),
        onDelete: vi.fn()
    }
    render(
        <DiscussionSidebar
            discussions={LIST}
            currentId="d1"
            settings={{ ...SETTINGS.sidebar, sort, collapsed }}
            archived={archived}
            {...handlers}
        />
    )
    return handlers
}
const titles = (): string[] =>
    screen.getAllByTestId('sidebar-item').map((li) => li.getAttribute('data-id') ?? '')

describe('discussion list (FR-221 to FR-225, code review TS-1)', () => {
    it('sorts by the newest message, discussions without messages last', () => {
        show('activity')
        expect(titles()).toEqual(['d2', 'd1', 'd3'])
    })

    it('sorts by name', () => {
        show('name')
        expect(titles()).toEqual(['d3', 'd2', 'd1'])
    })

    it('the filter ignores case', () => {
        show()
        fireEvent.change(screen.getByTestId('sidebar-filter'), { target: { value: 'бюд' } })
        expect(titles()).toEqual(['d1'])
    })

    it('marks the current discussion, unread messages and drafts', () => {
        show()
        const current = screen
            .getAllByTestId('sidebar-open')
            .find((b) => b.getAttribute('aria-current'))
        expect(current?.textContent).toContain('Бюджет')
        const d2 = screen.getAllByTestId('sidebar-item').find((li) => li.dataset['id'] === 'd2')!
        expect(within(d2).getByTestId('sidebar-unread').textContent).toBe('2')
        expect(screen.getAllByTestId('sidebar-draft')).toHaveLength(1)
    })

    it('opens a discussion here or in a new window, and changes the sort in the settings', () => {
        const h = show()
        fireEvent.click(screen.getAllByTestId('sidebar-open')[1]!)
        expect(h.onOpen).toHaveBeenCalledWith('d1')
        fireEvent.click(screen.getAllByTestId('sidebar-new-window')[0]!)
        expect(h.onOpenInNewWindow).toHaveBeenCalledWith('d2')
        fireEvent.change(screen.getByTestId('sidebar-sort'), { target: { value: 'name' } })
        expect(h.onChange).toHaveBeenCalledWith({ sort: 'name' })
    })

    it('collapses to round icons with initials, unread count and a mark for shared chats', () => {
        const h = show('activity', true)
        expect(screen.queryByTestId('sidebar')).toBeNull()
        const icons = screen.getAllByTestId('rail-item')
        expect(icons.map((b) => b.dataset['id'])).toEqual(['d2', 'd1', 'd3'])
        expect(icons.map((b) => b.textContent)).toEqual(['А2', 'Б', 'А'])
        expect(icons[0]!.getAttribute('aria-label')).toBe('Аренда, не прочитано: 2')
        expect(icons[1]!.getAttribute('aria-current')).toBe('true')
        fireEvent.click(icons[0]!)
        expect(h.onOpen).toHaveBeenCalledWith('d2')
        fireEvent.click(screen.getByTestId('sidebar-show'))
        expect(h.onChange).toHaveBeenCalledWith({ collapsed: false })
    })

    it('the collapse button keeps the choice in the settings', () => {
        const h = show()
        fireEvent.click(screen.getByTestId('sidebar-hide'))
        expect(h.onChange).toHaveBeenCalledWith({ collapsed: true })
    })

    it('the context menu of the list adds discussions; the "+" button opens the same menu', () => {
        const h = show()
        fireEvent.contextMenu(screen.getByTestId('sidebar'), { clientX: 50, clientY: 60 })
        const menu = screen.getByTestId('context-menu')
        expect(
            within(menu)
                .getAllByRole('menuitem')
                .map((b) => b.dataset['testid'])
        ).toEqual(['menu-add-local', 'menu-add-shared', 'menu-add-join', 'menu-add-import'])
        fireEvent.click(screen.getByTestId('menu-add-join'))
        expect(h.onAdd).toHaveBeenCalledWith('join')
        expect(screen.queryByTestId('context-menu')).toBeNull()
        fireEvent.click(screen.getByTestId('sidebar-add'))
        fireEvent.click(screen.getByTestId('menu-add-shared'))
        expect(h.onAdd).toHaveBeenLastCalledWith('shared')
    })

    it('the context menu of a discussion opens, archives and deletes it', () => {
        const h = show()
        const d2 = screen.getAllByTestId('sidebar-item').find((li) => li.dataset['id'] === 'd2')!
        fireEvent.contextMenu(d2, { clientX: 10, clientY: 10 })
        fireEvent.click(screen.getByTestId('menu-archive'))
        expect(h.onArchive).toHaveBeenCalledWith('d2', true)
        fireEvent.contextMenu(d2, { clientX: 10, clientY: 10 })
        fireEvent.click(screen.getByTestId('menu-delete'))
        expect(h.onDelete).toHaveBeenCalledWith('d2')
        fireEvent.contextMenu(d2, { clientX: 10, clientY: 10 })
        fireEvent.keyDown(screen.getByTestId('context-menu'), { key: 'Escape' })
        expect(screen.queryByTestId('context-menu')).toBeNull()
    })

    it('archived discussions are in a closed group at the end; the menu restores them', () => {
        const h = show('activity', false, ['d2'])
        expect(titles()).toEqual(['d1', 'd3'])
        fireEvent.click(screen.getByTestId('sidebar-archived'))
        expect(titles()).toEqual(['d1', 'd3', 'd2'])
        const d2 = screen.getAllByTestId('sidebar-item').find((li) => li.dataset['id'] === 'd2')!
        expect(d2.dataset['archived']).toBe('true')
        fireEvent.contextMenu(d2, { clientX: 10, clientY: 10 })
        fireEvent.click(screen.getByTestId('menu-restore'))
        expect(h.onArchive).toHaveBeenCalledWith('d2', false)
    })

    it('the group opens by itself when the discussion on screen is archived', () => {
        show('activity', false, ['d1'])
        expect(titles()).toEqual(['d2', 'd3', 'd1'])
    })
})
