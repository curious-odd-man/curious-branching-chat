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

const show = (sort: 'activity' | 'name' = 'activity', hidden = false) => {
    const handlers = {
        onChange: vi.fn(),
        onOpen: vi.fn(),
        onOpenInNewWindow: vi.fn(),
        onSearchAll: vi.fn()
    }
    render(
        <DiscussionSidebar
            discussions={LIST}
            currentId="d1"
            settings={{ ...SETTINGS.sidebar, sort, hidden }}
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

    it('a hidden list shows only the button that shows it again', () => {
        const h = show('activity', true)
        expect(screen.queryByTestId('sidebar')).toBeNull()
        fireEvent.click(screen.getByTestId('sidebar-show'))
        expect(h.onChange).toHaveBeenCalledWith({ hidden: false })
    })
})
