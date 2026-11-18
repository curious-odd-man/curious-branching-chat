import { cleanup, render, type RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, vi, type Mock } from 'vitest'
import type { BranchChatApi } from '@shared/types/api'
import type { SettingsView } from '@shared/types/ipc'
import { ApiProvider } from '../../../src/renderer/api'

/** A fake of the API of the main process: every call answers `{ ok: true, data: null }` unless it is set. */
export type FakeApi = BranchChatApi & {
    [K in keyof BranchChatApi]: BranchChatApi[K] extends (...args: infer A) => infer R
        ? Mock<(...args: A) => R>
        : BranchChatApi[K]
}

export interface Fake {
    api: FakeApi
    /** Calls the listeners that a component gave to `on<Event>` (for example `onDraftsFlushRequest`). */
    emit(event: string, ...args: unknown[]): void
}

export function fakeApi(overrides: Partial<Record<keyof BranchChatApi, unknown>> = {}): Fake {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
    const made = new Map<string | symbol, unknown>()
    const base: Record<string, unknown> = { language: 'ru', ...overrides }
    const api = new Proxy(base, {
        get(target, key) {
            if (key in target) {
                const value = target[key as string]
                if (typeof value === 'function' && !vi.isMockFunction(value)) {
                    const mock = vi.fn(value as (...args: unknown[]) => unknown)
                    target[key as string] = mock
                    return mock
                }
                return value
            }
            if (typeof key !== 'string') return undefined
            if (!made.has(key)) {
                const mock = key.startsWith('on')
                    ? vi.fn((listener: (...args: unknown[]) => void) => {
                          const set = listeners.get(key) ?? new Set()
                          set.add(listener)
                          listeners.set(key, set)
                          return () => set.delete(listener)
                      })
                    : key === 'getPathForFile'
                      ? vi.fn(() => '')
                      : vi.fn(() => Promise.resolve({ ok: true, data: null }))
                made.set(key, mock)
            }
            return made.get(key)
        }
    }) as unknown as FakeApi
    return {
        api,
        emit: (event, ...args) => listeners.get(event)?.forEach((l) => l(...args))
    }
}

export const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data })
export const fail = (message: string, code = 'TEST_ERROR') =>
    Promise.resolve({ ok: false as const, error: { code, message } })

export function renderWithApi(ui: ReactElement, api: BranchChatApi): RenderResult {
    return render(<ApiProvider api={api}>{ui}</ApiProvider>)
}

export const SETTINGS: SettingsView = {
    participantId: 'p-anna',
    displayName: 'Анна',
    readNoticeAcknowledged: true,
    associationAsked: true,
    autoUpdateCheck: true,
    recentFilesLimit: 10,
    openLastFileOnStartup: true,
    fileSizeLimitMb: 30,
    notifyNewMessages: true,
    notifyShowText: true,
    startWithWindows: false,
    startWithWindowsSettled: true,
    textSize: 100,
    sidebar: { hidden: false, width: 260, sort: 'activity' },
    backupFolder: null,
    attachmentLimitMb: 100,
    language: 'ru'
}

/** jsdom has no `matchMedia` (the window is wide here) and no layout, which the editor asks for. */
export function installDomStubs(): void {
    const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }
    const noRects = (): DOMRectList => Object.assign([], { item: () => null })
    Range.prototype.getClientRects ??= noRects
    Range.prototype.getBoundingClientRect ??= () => ({ ...rect, toJSON: () => rect })
    document.elementFromPoint ??= () => null
    if (!window.matchMedia)
        window.matchMedia = (query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            addListener: () => undefined,
            removeListener: () => undefined,
            dispatchEvent: () => false
        })
    afterEach(() => cleanup())
}
