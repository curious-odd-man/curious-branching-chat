// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DiscussionListItem } from '@shared/types/ipc'
import { DeleteDialog } from '../../src/renderer/components/DeleteDialog'
import { fail, fakeApi, installDomStubs, ok, renderWithApi } from './helpers/fakeApi'

installDomStubs()

const item = (synced: boolean): DiscussionListItem => ({
    id: 'd1',
    title: 'Бюджет',
    lastMessageAt: null,
    messageCount: 0,
    synced,
    unreadCount: 0,
    hasDraft: false
})

describe('delete a discussion (2026-11-23)', () => {
    it('a shared discussion says that the person leaves it and the others keep it', () => {
        renderWithApi(
            <DeleteDialog discussion={item(true)} onClose={() => undefined} />,
            fakeApi().api
        )
        expect(screen.getByTestId('delete-dialog').textContent).toContain(
            'Другие участники сохранят его'
        )
    })

    it('deletes after the confirmation and closes', async () => {
        const { api } = fakeApi({ deleteDiscussion: () => ok(undefined) })
        const onClose = vi.fn()
        renderWithApi(<DeleteDialog discussion={item(false)} onClose={onClose} />, api)
        expect(screen.getByTestId('delete-dialog').textContent).toContain('Отменить это нельзя')
        fireEvent.click(screen.getByTestId('delete-confirm'))
        await waitFor(() => expect(onClose).toHaveBeenCalled())
        expect(api.deleteDiscussion).toHaveBeenCalledWith('d1')
    })

    it('a failure stays in the dialog', async () => {
        const onClose = vi.fn()
        renderWithApi(
            <DeleteDialog discussion={item(false)} onClose={onClose} />,
            fakeApi({ deleteDiscussion: () => fail('Обсуждение открыто') }).api
        )
        fireEvent.click(screen.getByTestId('delete-confirm'))
        expect((await screen.findByTestId('delete-error')).textContent).toBe('Обсуждение открыто')
        expect(onClose).not.toHaveBeenCalled()
    })
})
