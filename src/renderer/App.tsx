import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { mainThread } from '@shared/domain'
import { ru } from '@shared/i18n/ru'
import type { RichDoc } from '@shared/validation'
import { DISCUSSION_EXTENSION } from '@shared/types/constants'
import type { IpcResult } from '@shared/types/ipc'
import { Launcher } from './components/Launcher'
import { NamePrompt } from './components/NamePrompt'
import { ReadNotice } from './components/ReadNotice'
import { SettingsDialog } from './components/SettingsDialog'
import { UpdateDialog } from './components/UpdateDialog'
import { DiscussionScreen } from './components/chat/DiscussionScreen'
import { useDocumentView, useRecentFiles, useSettings, useUpdateState } from './hooks'

export function App(): React.JSX.Element {
  const api = window.branchchat
  const view = useDocumentView()
  const [settings, setSettings] = useSettings()
  const [version, setVersion] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<{ run: () => void } | null>(null)
  // Which thread this window shows; reset when another discussion is shown.
  const [nav, setNav] = useState<{ documentId: string; threadId: string; focus?: string } | null>(
    null
  )
  const update = useUpdateState()
  const recent = useRecentFiles()
  const [bannerHidden, setBannerHidden] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [readNotice, setReadNotice] = useState<{ retry: () => void } | null>(null)
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  useEffect(() => {
    void api.getAppInfo().then((r) => r.ok && setVersion(r.data.version))
  }, [api])

  /** Runs the action once a participant name exists; asks for it first if needed (FR-019). */
  const withName = useCallback((run: () => void) => {
    if (settingsRef.current?.displayName) run()
    else setPending({ run })
  }, [])

  const report = useCallback((r: { ok: boolean; error?: { message: string } }) => {
    setError(r.ok ? null : (r.error?.message ?? null))
  }, [])

  const startNew = useCallback(
    () =>
      withName(() => {
        void api.newDocument().then(report)
      }),
    [api, report, withName]
  )
  const openDialog = useCallback(() => void api.openDocumentDialog().then(report), [api, report])

  useEffect(
    () =>
      api.onMenuCommand((command) => {
        if (command === 'new') startNew()
        else if (command === 'settings') setShowSettings(true)
        else openDialog()
      }),
    [api, startNew, openDialog]
  )

  const activeThreadId = useMemo(() => {
    if (!view) return null
    const exists =
      nav?.documentId === view.documentId &&
      view.discussion.threads.some((t) => t.threadId === nav.threadId)
    return exists && nav ? nav.threadId : mainThread(view.discussion).threadId
  }, [view, nav])

  const selectThread = useCallback(
    (threadId: string, focus?: string) => {
      if (!view) return
      setNav({ documentId: view.documentId, threadId, ...(focus ? { focus } : {}) })
    },
    [view]
  )

  /**
   * Runs an action that may change the person's read state. If the one-time notice has not been shown yet, the main
   * process refuses with READ_NOTICE_REQUIRED; the notice is shown and the action is repeated once it is confirmed
   * (FR-125).
   */
  const perform = useCallback(
    async <T,>(action: () => Promise<IpcResult<T>>, onDone?: (data: T) => void): Promise<void> => {
      const r = await action()
      if (!r.ok && r.error.code === 'READ_NOTICE_REQUIRED') {
        setReadNotice({ retry: () => void perform(action, onDone) })
        return
      }
      report(r)
      if (r.ok) onDone?.(r.data)
    },
    [report]
  )

  const send = (content: RichDoc, clear: () => void): void =>
    withName(() => {
      if (!activeThreadId) return
      void perform(() => api.appendMessage(activeThreadId, content), clear)
    })

  /** "Reply to this": creates the branch (asks for the name first if needed) and opens it. */
  const reply = (selection: { messageId: string; start: number; end: number }): void =>
    withName(() => {
      void perform(
        () => api.createBranch(selection.messageId, selection.start, selection.end),
        (data) => selectThread(data.threadId)
      )
    })

  const markMessageRead = (messageId: string): void =>
    withName(() => void perform(() => api.markMessageRead(messageId)))
  const markThreadRead = (threadId: string): void =>
    withName(() => void perform(() => api.markThreadRead(threadId)))
  const markAllRead = (): void => withName(() => void perform(() => api.markAllRead()))

  const confirmReadNotice = (): void => {
    void api.acknowledgeReadNotice().then((r) => {
      if (!r.ok) return report(r)
      setSettings(r.data)
      settingsRef.current = r.data
      const next = readNotice
      setReadNotice(null)
      next?.retry()
    })
  }

  const submitName = (name: string): void => {
    void api.setDisplayName(name).then((r) => {
      if (!r.ok) return report(r)
      setSettings(r.data)
      settingsRef.current = r.data
      const next = pending
      setPending(null)
      next?.run()
    })
  }

  const onDrop = (event: React.DragEvent): void => {
    event.preventDefault()
    for (const file of Array.from(event.dataTransfer.files)) {
      const path = api.getPathForFile(file)
      if (path.toLowerCase().endsWith(DISCUSSION_EXTENSION)) void api.openPath(path).then(report)
    }
  }

  return (
    <div className="root" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      {error && (
        <div className="banner error" role="alert" data-testid="app-error">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}
      {update &&
        !update.dialogOpen &&
        (update.phase === 'available' || update.phase === 'ready') &&
        update.info &&
        bannerHidden !== update.info.version && (
          <div className="banner info" role="status" data-testid="update-banner">
            <span>{ru.update.banner(update.info.version)}</span>
            <button
              type="button"
              data-testid="update-banner-details"
              onClick={() => void api.showUpdateDialog()}
            >
              {ru.update.bannerDetails}
            </button>
            <button
              type="button"
              aria-label={ru.update.bannerDismiss}
              onClick={() => setBannerHidden(update.info?.version ?? null)}
            >
              ×
            </button>
          </div>
        )}
      {view === undefined ? null : view === null ? (
        <Launcher
          version={version}
          recent={recent}
          onNew={startNew}
          onOpen={openDialog}
          onOpenRecent={(path) => void api.openPath(path).then(report)}
          onRemoveRecent={(path) => void api.removeRecentFile(path).then(report)}
          onClearRecent={() => void api.clearRecentFiles().then(report)}
        />
      ) : (
        <DiscussionScreen
          view={view}
          threadId={activeThreadId ?? ''}
          {...(nav?.focus && nav.threadId === activeThreadId ? { focusMessageId: nav.focus } : {})}
          onSelectThread={selectThread}
          onSend={send}
          onMarkMessageRead={markMessageRead}
          onMarkThreadRead={markThreadRead}
          onMarkAllRead={markAllRead}
          onReply={reply}
          onSetStatus={(threadId, status) =>
            void api.setBranchStatus(threadId, status).then(report)
          }
          onSetTitle={(threadId, title) => void api.setBranchTitle(threadId, title).then(report)}
          onRetrySave={() => void api.retrySave().then(report)}
        />
      )}
      {update?.dialogOpen && <UpdateDialog view={update} />}
      {showSettings && (
        <SettingsDialog
          settings={settings}
          onNameSaved={(s) => {
            setSettings(s)
            settingsRef.current = s
          }}
          onSettingsChanged={(s) => {
            setSettings(s)
            settingsRef.current = s
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
      {pending && <NamePrompt onSubmit={submitName} onCancel={() => setPending(null)} />}
      {readNotice && (
        <ReadNotice onConfirm={confirmReadNotice} onCancel={() => setReadNotice(null)} />
      )}
    </div>
  )
}
