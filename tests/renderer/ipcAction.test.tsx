// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useIpcAction } from '../../src/renderer/api'
import { fail, installDomStubs, ok } from './helpers/fakeApi'

installDomStubs()

describe('useIpcAction (code review 4.5)', () => {
    it('busy while the call runs and while onOk runs; the data goes to onOk', async () => {
        const { result } = renderHook(() => useIpcAction())
        let release: () => void = () => undefined
        const onOk = vi.fn(() => new Promise<void>((r) => (release = r)))
        let done: Promise<unknown> = Promise.resolve()
        act(() => {
            done = result.current.run(() => ok(5), onOk)
        })
        expect(result.current.busy).toBe(true)
        await act(async () => {
            await Promise.resolve()
            await Promise.resolve()
        })
        expect(onOk).toHaveBeenCalledWith(5)
        expect(result.current.busy).toBe(true)
        await act(async () => {
            release()
            await done
        })
        expect(result.current.busy).toBe(false)
    })

    it('a failure sets the error text and calls onFail; load is never busy', async () => {
        const { result } = renderHook(() => useIpcAction())
        const onFail = vi.fn()
        let call: Promise<unknown> = Promise.resolve()
        act(() => {
            call = result.current.load(() => fail('Нет доступа', 'NO_ACCESS'), undefined, onFail)
        })
        expect(result.current.busy).toBe(false)
        await act(async () => {
            await call
        })
        expect(result.current.error).toBe('Нет доступа')
        expect(onFail).toHaveBeenCalledWith({ code: 'NO_ACCESS', message: 'Нет доступа' })
    })

    it('report sends the errors to another line; clearOnOk removes the error after a success', async () => {
        const report = vi.fn()
        const { result } = renderHook(() => useIpcAction({ report, clearOnOk: true }))
        await act(async () => {
            await result.current.run(() => fail('Ошибка'))
            await result.current.run(() => ok(null))
        })
        expect(report.mock.calls).toEqual([['Ошибка'], [null]])
        expect(result.current.error).toBeNull()
    })
})
