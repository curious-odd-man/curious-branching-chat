// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SyncStatusView } from '@shared/types/ipc'
import { SyncStatusLine } from '../../src/renderer/components/chat/SyncStatusLine'
import { fakeApi, installDomStubs, ok, renderWithApi } from './helpers/fakeApi'

installDomStubs()

const status = (more: Partial<SyncStatusView> = {}): SyncStatusView => ({
    folder: 'ok',
    folderPath: 'G:\\Мой диск\\Общая',
    quarantined: 0,
    needsUpdate: false,
    lastScanAt: null,
    keyRequests: [],
    notAccepted: [],
    waitingFor: [],
    ...more
})

describe('status line: files that wait for an inactive member (D-43)', () => {
    it('shows nothing when all is well', () => {
        renderWithApi(<SyncStatusLine status={status()} />, fakeApi().api)
        expect(screen.queryByTestId('sync-status')).toBeNull()
    })

    it('names the member and deletes the own files only after the confirmation', async () => {
        const { api } = fakeApi({ dropFilesFor: () => ok(null) })
        renderWithApi(
            <SyncStatusLine
                status={status({
                    waitingFor: [
                        {
                            participantId: 'p-clara',
                            displayName: 'Клара',
                            files: 3,
                            since: '2026-11-10T10:00:00.000Z'
                        }
                    ]
                })}
            />,
            api
        )
        const line = screen.getByTestId('waiting-member')
        expect(line.textContent).toContain('От участника Клара нет активности')
        expect(line.textContent).toContain('в общей папке: 3')
        fireEvent.click(screen.getByTestId('drop-files'))
        expect(screen.getByTestId('drop-dialog').textContent).toContain(
            'Клара не получит эти сообщения'
        )
        fireEvent.click(screen.getByTestId('drop-cancel'))
        expect(api.dropFilesFor).not.toHaveBeenCalled()
        fireEvent.click(screen.getByTestId('drop-files'))
        fireEvent.click(screen.getByTestId('drop-confirm'))
        await waitFor(() => expect(screen.queryByTestId('drop-dialog')).toBeNull())
        expect(api.dropFilesFor).toHaveBeenCalledWith('p-clara')
    })
})
