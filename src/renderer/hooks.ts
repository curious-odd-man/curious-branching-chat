import { useEffect, useState } from 'react'
import type { DocumentView, SettingsView } from '@shared/types/ipc'

/** The discussion shown in this window: undefined while loading, null when the window has none. */
export function useDocumentView(): DocumentView | null | undefined {
  const [view, setView] = useState<DocumentView | null | undefined>(undefined)
  useEffect(() => {
    const unsubscribe = window.branchchat.onDocumentChanged(setView)
    void window.branchchat.getDocumentState().then((r) => {
      // A push that arrived first is newer than this answer.
      setView((current) => (current !== undefined ? current : r.ok ? r.data : null))
    })
    return unsubscribe
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
