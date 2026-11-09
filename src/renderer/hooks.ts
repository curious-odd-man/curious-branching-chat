import { useEffect, useState } from 'react'
import type { DocumentView, SettingsView, UpdateView } from '@shared/types/ipc'

/** The discussion shown in this window: undefined while loading, null when the window has none. */
export function useDocumentView(): DocumentView | null | undefined {
    const [view, setView] = useState<DocumentView | null | undefined>(undefined)
    useEffect(() => {
        const unsubscribeChanged = window.branchchat.onDocumentChanged(setView)
        // A finished save changes only these two fields; the (possibly huge) discussion is not sent again.
        const unsubscribeStatus = window.branchchat.onDocumentStatusChanged((status) =>
            setView((current) => (current ? { ...current, ...status } : current))
        )
        void window.branchchat.getDocumentState().then((r) => {
            // A push that arrived first is newer than this answer.
            setView((current) => (current !== undefined ? current : r.ok ? r.data : null))
        })
        return () => {
            unsubscribeChanged()
            unsubscribeStatus()
        }
    }, [])
    return view
}

export function useSettings(): [SettingsView | undefined, (s: SettingsView) => void] {
    const [settings, setSettings] = useState<SettingsView | undefined>(undefined)
    useEffect(() => {
        void window.branchchat.getSettings().then((r) => {
            if (r.ok) setSettings(r.data)
        })
    }, [])
    return [settings, setSettings]
}

/** The update state (shared by all windows); undefined until the first answer arrives. */
export function useUpdateState(): UpdateView | undefined {
    const [view, setView] = useState<UpdateView | undefined>(undefined)
    useEffect(() => {
        const unsubscribe = window.branchchat.onUpdateChanged(setView)
        void window.branchchat.getUpdateState().then((r) => {
            setView((current) => current ?? (r.ok ? r.data : undefined))
        })
        return unsubscribe
    }, [])
    return view
}
