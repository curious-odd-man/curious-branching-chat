import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import type { BranchChatApi } from '@shared/types/api'
import type { IpcResult } from '@shared/types/ipc'

/**
 * The API of the main process for the components (code review 4.5). The window gives `window.branchchat`; component
 * tests give a fake.
 */
const ApiContext = createContext<BranchChatApi | null>(null)

export function ApiProvider({
    api,
    children
}: {
    api: BranchChatApi
    children: ReactNode
}): React.JSX.Element {
    return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>
}

export function useApi(): BranchChatApi {
    const api = useContext(ApiContext)
    if (!api) throw new Error('useApi() needs an ApiProvider')
    return api
}

/** Runs one call of the main process; `onOk` gets the data, a failure is reported as one text. */
export type IpcRun = <T>(
    call: () => Promise<IpcResult<T>>,
    onOk?: (data: T) => void | Promise<void>,
    onFail?: (error: { code: string; message: string }) => void
) => Promise<IpcResult<T>>

export interface IpcAction {
    /** The text of the last failure, or null. */
    error: string | null
    setError(error: string | null): void
    /** True while a call of `run` is not finished. */
    busy: boolean
    run: IpcRun
    /** As `run`, but not busy: for loads and checks in the background. */
    load: IpcRun
}

export interface IpcActionOptions {
    /** Reports the failures here instead of in `error` (for a part of a dialog that has one error line). */
    report?: (error: string | null) => void
    /** A successful call removes the error text. */
    clearOnOk?: boolean
}

/**
 * The same handling for each call of the main process (code review 4.5): busy while it runs, the error text on failure.
 * `onOk` runs before busy goes back to false, so a second call in it is part of the same action.
 */
export function useIpcAction(options: IpcActionOptions = {}): IpcAction {
    const { report, clearOnOk = false } = options
    const [ownError, setOwnError] = useState<string | null>(null)
    const [running, setRunning] = useState(0)
    const setError = report ?? setOwnError
    const exec = useCallback(
        async <T,>(
            track: boolean,
            call: () => Promise<IpcResult<T>>,
            onOk?: (data: T) => void | Promise<void>,
            onFail?: (error: { code: string; message: string }) => void
        ): Promise<IpcResult<T>> => {
            if (track) setRunning((n) => n + 1)
            try {
                const r = await call()
                if (r.ok) {
                    if (clearOnOk) setError(null)
                    await onOk?.(r.data)
                } else {
                    setError(r.error.message)
                    onFail?.(r.error)
                }
                return r
            } finally {
                if (track) setRunning((n) => n - 1)
            }
        },
        [setError, clearOnOk]
    )
    const run = useCallback<IpcRun>((call, onOk, onFail) => exec(true, call, onOk, onFail), [exec])
    const load = useCallback<IpcRun>(
        (call, onOk, onFail) => exec(false, call, onOk, onFail),
        [exec]
    )
    return { error: report ? null : ownError, setError, busy: running > 0, run, load }
}
