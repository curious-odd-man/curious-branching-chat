import { useCallback, useEffect, useRef, useState } from 'react'
import { useApi } from './api'
import type { DocumentView, DiscussionListItem, SettingsView, UpdateView } from '@shared/types/ipc'

/** The discussion shown in this window: undefined while loading, null when the window has none. */
export function useDocumentView(): DocumentView | null | undefined {
    const api = useApi()
    const [view, setView] = useState<DocumentView | null | undefined>(undefined)
    useEffect(() => {
        const unsubscribeChanged = api.onDocumentChanged(setView)
        // A finished save changes only these two fields; the (possibly huge) discussion is not sent again.
        const unsubscribeStatus = api.onDocumentStatusChanged((status) =>
            setView((current) => (current ? { ...current, ...status } : current))
        )
        void api.getDocumentState().then((r) => {
            // A push that arrived first is newer than this answer.
            setView((current) => (current !== undefined ? current : r.ok ? r.data : null))
        })
        return () => {
            unsubscribeChanged()
            unsubscribeStatus()
        }
    }, [api])
    return view
}

/** The settings of the application; `current()` gives the newest value also inside older callbacks. */
export function useSettings(): {
    settings: SettingsView | undefined
    current(): SettingsView | undefined
    set(settings: SettingsView): void
} {
    const api = useApi()
    const [settings, setSettings] = useState<SettingsView | undefined>(undefined)
    const ref = useRef<SettingsView | undefined>(undefined)
    const set = useCallback((next: SettingsView) => {
        ref.current = next
        setSettings(next)
    }, [])
    useEffect(() => {
        void api.getSettings().then((r) => {
            if (r.ok) set(r.data)
        })
    }, [api, set])
    const current = useCallback(() => ref.current, [])
    return { settings, current, set }
}

/** The update state (shared by all windows); undefined until the first answer arrives. */
export function useUpdateState(): UpdateView | undefined {
    const api = useApi()
    const [view, setView] = useState<UpdateView | undefined>(undefined)
    useEffect(() => {
        const unsubscribe = api.onUpdateChanged(setView)
        void api.getUpdateState().then((r) => {
            setView((current) => current ?? (r.ok ? r.data : undefined))
        })
        return unsubscribe
    }, [api])
    return view
}

/** The discussions of the library, most recently used first (shared by all windows); null until the first answer. */
export function useDiscussions(): DiscussionListItem[] | null {
    const api = useApi()
    const [list, setList] = useState<DiscussionListItem[] | null>(null)
    useEffect(() => {
        const unsubscribe = api.onDiscussionsChanged(setList)
        void api.getDiscussions().then((r) => {
            if (r.ok) setList((current) => current ?? r.data)
        })
        return unsubscribe
    }, [api])
    return list
}
