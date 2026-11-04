import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { mainThread } from '@shared/domain'
import type { RichDoc } from '@shared/validation'
import { DISCUSSION_EXTENSION } from '@shared/types/constants'
import { Launcher } from './components/Launcher'
import { NamePrompt } from './components/NamePrompt'
import { DiscussionScreen } from './components/chat/DiscussionScreen'
import { useDocumentView, useSettings } from './hooks'

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

  const send = (content: RichDoc, clear: () => void): void =>
    withName(() => {
      if (!activeThreadId) return
      void api.appendMessage(activeThreadId, content).then((r) => {
        report(r)
        if (r.ok) clear()
      })
    })

  /** "Reply to this": creates the branch (asks for the name first if needed) and opens it. */
  const reply = (selection: { messageId: string; start: number; end: number }): void =>
    withName(() => {
      void api.createBranch(selection.messageId, selection.start, selection.end).then((r) => {
        report(r)
        if (r.ok) selectThread(r.data.threadId)
      })
    })

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
      {view === undefined ? null : view === null ? (
        <Launcher version={version} onNew={startNew} onOpen={openDialog} />
      ) : (
        <DiscussionScreen
          view={view}
          threadId={activeThreadId ?? ''}
          {...(nav?.focus && nav.threadId === activeThreadId ? { focusMessageId: nav.focus } : {})}
          onSelectThread={selectThread}
          onSend={send}
          onReply={reply}
          onSetStatus={(threadId, status) =>
            void api.setBranchStatus(threadId, status).then(report)
          }
          onSetTitle={(threadId, title) => void api.setBranchTitle(threadId, title).then(report)}
          onRetrySave={() => void api.retrySave().then(report)}
        />
      )}
      {pending && <NamePrompt onSubmit={submitName} onCancel={() => setPending(null)} />}
    </div>
  )
}
