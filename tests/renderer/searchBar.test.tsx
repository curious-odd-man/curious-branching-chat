// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SearchHit } from '@shared/types/ipc'
import { SearchBar } from '../../src/renderer/components/search/SearchBar'
import { fakeApi, installDomStubs, ok, renderWithApi } from './helpers/fakeApi'

installDomStubs()

const hit = (messageId: string, snippet: string): SearchHit => ({
    kind: 'message',
    discussionId: 'd1',
    discussionTitle: 'Бюджет',
    threadId: 't-main',
    threadLabel: '',
    messageId,
    authorName: 'Анна',
    createdAt: '2026-11-01T10:00:00.000Z',
    snippet,
    marks: [[0, 5]]
})
const HITS = [hit('m1', 'смета на ноябрь'), hit('m2', 'смета на декабрь')]

const open = (hits: SearchHit[] = HITS) => {
    const fake = fakeApi({ searchDiscussion: () => ok(hits) })
    const onShow = vi.fn()
    const onClose = vi.fn()
    renderWithApi(<SearchBar onShow={onShow} onClose={onClose} />, fake.api)
    return { ...fake, onShow, onClose }
}
const type = (text: string): void => {
    fireEvent.change(screen.getByTestId('search-input'), { target: { value: text } })
}

describe('search in a discussion (FR-211 to FR-213, code review TS-1)', () => {
    it('searches a moment after typing and shows the count', async () => {
        const { api } = open()
        type('смета')
        await screen.findByTestId('search-results')
        expect(api.searchDiscussion).toHaveBeenCalledTimes(1)
        expect(api.searchDiscussion).toHaveBeenCalledWith('смета')
        expect(screen.getAllByTestId('search-result')).toHaveLength(2)
    })

    it('Enter goes to the next result, Shift+Enter to the previous one, round the end', async () => {
        const { onShow } = open()
        type('смета')
        await screen.findByTestId('search-results')
        const input = screen.getByTestId('search-input')
        fireEvent.keyDown(input, { key: 'Enter' })
        expect(onShow).toHaveBeenLastCalledWith(HITS[0], ['смета'])
        fireEvent.keyDown(input, { key: 'Enter' })
        expect(onShow).toHaveBeenLastCalledWith(HITS[1], ['смета'])
        fireEvent.keyDown(input, { key: 'Enter' })
        expect(onShow).toHaveBeenLastCalledWith(HITS[0], ['смета'])
        fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
        expect(onShow).toHaveBeenLastCalledWith(HITS[1], ['смета'])
        expect(screen.getAllByTestId('search-result')[1]!.getAttribute('aria-current')).toBe('true')
    })

    it('says when nothing is found; the arrows are off', async () => {
        open([])
        type('нет')
        await waitFor(() => expect(screen.getByTestId('search-count').textContent).not.toBe(''))
        expect(screen.getByTestId<HTMLButtonElement>('search-next').disabled).toBe(true)
    })

    it('an empty query does not search; Escape closes', async () => {
        const { api, onClose } = open()
        type('   ')
        await new Promise((r) => setTimeout(r, 200))
        expect(api.searchDiscussion).not.toHaveBeenCalled()
        fireEvent.keyDown(screen.getByTestId('search-input'), { key: 'Escape' })
        expect(onClose).toHaveBeenCalled()
    })
})
