// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Attachment, RichDoc } from '@shared/validation'
import { ApiProvider } from '../../src/renderer/api'
import { Composer } from '../../src/renderer/components/chat/Composer'
import { fakeApi, installDomStubs, ok, renderWithApi } from './helpers/fakeApi'

installDomStubs()

const doc = (text: string): RichDoc => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
})
const file = (name: string, size = 1000): Attachment => ({
    name,
    size,
    type: 'application/pdf',
    sha256: name.padEnd(64, '0')
})

const open = (
    overrides: Parameters<typeof fakeApi>[0] = {},
    props: { threadId?: string; synced?: boolean } = {}
) => {
    const fake = fakeApi({ getDrafts: () => ok({}), ...overrides })
    const onSend = vi.fn()
    const view = renderWithApi(
        <Composer
            sessionId="s1"
            threadId={props.threadId ?? 't1'}
            synced={props.synced ?? false}
            onSend={onSend}
        />,
        fake.api
    )
    const rerender = (threadId: string): void =>
        view.rerender(
            <ApiProvider api={fake.api}>
                <Composer
                    sessionId="s1"
                    threadId={threadId}
                    synced={props.synced ?? false}
                    onSend={onSend}
                />
            </ApiProvider>
        )
    return { ...fake, onSend, rerender }
}
const sendButton = (): HTMLButtonElement => screen.getByTestId<HTMLButtonElement>('send')
const editorText = (): string => screen.getByTestId('composer').textContent ?? ''

describe('composer (code review TS-1)', () => {
    it('brings back the saved draft of the thread, and sends it with its files', async () => {
        const { onSend } = open({
            getDrafts: () =>
                ok({ t1: { content: doc('Черновик'), attachments: [file('plan.pdf')] } })
        })
        await waitFor(() => expect(editorText()).toBe('Черновик'))
        expect(screen.getAllByTestId('draft-file').map((li) => li.dataset['name'])).toEqual([
            'plan.pdf'
        ])
        expect(sendButton().disabled).toBe(false)
        fireEvent.click(sendButton())
        expect(onSend).toHaveBeenCalledTimes(1)
        const [content, files] = onSend.mock.calls[0]!
        expect(content).toEqual(doc('Черновик'))
        expect(files).toEqual([file('plan.pdf')])
    })

    it('an empty draft cannot be sent', async () => {
        open()
        await waitFor(() => expect(screen.getByTestId('composer')).toBeTruthy())
        expect(sendButton().disabled).toBe(true)
    })

    it('the clear callback empties the editor and the files', async () => {
        const { onSend } = open({
            getDrafts: () => ok({ t1: { content: doc('Текст'), attachments: [file('a.pdf')] } })
        })
        await waitFor(() => expect(editorText()).toBe('Текст'))
        fireEvent.click(sendButton())
        const clear = onSend.mock.calls[0]![2] as () => void
        act(() => clear())
        expect(editorText()).toBe('')
        expect(screen.queryByTestId('draft-files')).toBeNull()
    })

    it('a sent message leaves no draft with its files in the library (FR-251)', async () => {
        const { api, emit, onSend } = open({
            getDrafts: () => ok({ t1: { content: doc('Текст'), attachments: [file('a.pdf')] } }),
            saveDraft: () => ok(null),
            draftsFlushed: () => ok(null)
        })
        await waitFor(() => expect(editorText()).toBe('Текст'))
        fireEvent.click(sendButton())
        act(() => (onSend.mock.calls[0]![2] as () => void)())
        emit('onDraftsFlushRequest', 'token-2')
        await waitFor(() => expect(api.draftsFlushed).toHaveBeenCalledWith('token-2'))
        expect(api.saveDraft).toHaveBeenCalledWith('t1', null, [])
    })

    it('attached files are listed and can be removed; refused files are named', async () => {
        open({
            pickAttachments: () =>
                ok({
                    added: [file('a.pdf'), file('b.pdf')],
                    refused: [{ name: 'big.iso', reason: 'too-large' }],
                    limitMb: 100
                })
        })
        fireEvent.click(await screen.findByTestId('attach'))
        await waitFor(() => expect(screen.getAllByTestId('draft-file')).toHaveLength(2))
        expect(screen.getByRole('alert').textContent).toContain('big.iso')
        fireEvent.click(screen.getAllByTestId('draft-file-remove')[0]!)
        expect(screen.getAllByTestId('draft-file').map((li) => li.dataset['name'])).toEqual([
            'b.pdf'
        ])
        expect(sendButton().disabled).toBe(false)
    })

    it('each thread keeps its own draft', async () => {
        const { rerender } = open({
            getDrafts: () =>
                ok({
                    t1: { content: doc('Первая'), attachments: [] },
                    t2: { content: doc('Вторая'), attachments: [file('t2.pdf')] }
                })
        })
        await waitFor(() => expect(editorText()).toBe('Первая'))
        rerender('t2')
        await waitFor(() => expect(editorText()).toBe('Вторая'))
        expect(screen.getAllByTestId('draft-file').map((li) => li.dataset['name'])).toEqual([
            't2.pdf'
        ])
        rerender('t1')
        await waitFor(() => expect(editorText()).toBe('Первая'))
        expect(screen.queryByTestId('draft-files')).toBeNull()
    })

    it('the main process asks for the drafts: the waiting changes are saved, then it is told', async () => {
        const { api, emit } = open({
            getDrafts: () => ok({ t1: { content: doc('Сохранить'), attachments: [] } }),
            pickAttachments: () => ok({ added: [file('x.pdf')], refused: [], limitMb: 100 }),
            saveDraft: () => ok(null),
            draftsFlushed: () => ok(null)
        })
        await waitFor(() => expect(editorText()).toBe('Сохранить'))
        fireEvent.click(screen.getByTestId('attach'))
        await waitFor(() => expect(screen.getAllByTestId('draft-file')).toHaveLength(1))
        expect(api.saveDraft).not.toHaveBeenCalled()
        emit('onDraftsFlushRequest', 'token-1')
        await waitFor(() => expect(api.draftsFlushed).toHaveBeenCalledWith('token-1'))
        expect(api.saveDraft).toHaveBeenCalledWith('t1', doc('Сохранить'), [file('x.pdf')])
    })

    it('FR-268: in a synchronized discussion, members with a smaller limit are named before sending', async () => {
        const { api, onSend } = open(
            {
                getDrafts: () =>
                    ok({ t1: { content: doc('Файл'), attachments: [file('big.pdf', 50e6)] } }),
                attachmentReceivers: () =>
                    ok([{ participantId: 'p-b', displayName: 'Борис', maxFileMb: 30 }])
            },
            { synced: true }
        )
        await waitFor(() => expect(editorText()).toBe('Файл'))
        fireEvent.click(sendButton())
        await screen.findByTestId('small-limits')
        expect(api.attachmentReceivers).toHaveBeenCalledWith(50e6)
        expect(onSend).not.toHaveBeenCalled()
        fireEvent.click(screen.getByTestId('send-anyway'))
        expect(onSend).toHaveBeenCalledTimes(1)
        expect(screen.queryByTestId('small-limits')).toBeNull()
    })
})
