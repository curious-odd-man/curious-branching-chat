import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { mainThread } from '@shared/domain'
import { texts } from '@shared/i18n'
import type { Attachment, ReactionEmoji, RichDoc } from '@shared/validation'
import { DISCUSSION_EXTENSION } from '@shared/types/constants'
import type { IpcResult } from '@shared/types/ipc'
import { Launcher } from './components/Launcher'
import { NamePrompt } from './components/NamePrompt'
import { TitlePrompt } from './components/TitlePrompt'
import { MigrationDialog } from './components/MigrationDialog'
import { RestoreDialog } from './components/RestoreDialog'
import type { MigrationCandidate } from '@shared/types/ipc'
import { ReadNotice } from './components/ReadNotice'
import { SettingsDialog } from './components/SettingsDialog'
import { ShortcutsDialog } from './components/ShortcutsDialog'
import { zoomKeyOfEvent } from '@shared/shortcuts'
import { SharedWizard, type ReinviteTarget, type WizardMode } from './components/SharedWizard'
import { UpdateDialog } from './components/UpdateDialog'
import { DiscussionScreen } from './components/chat/DiscussionScreen'
import { DiscussionSidebar } from './components/DiscussionSidebar'
import { SearchAllDialog } from './components/search/SearchAllDialog'
import { useDiscussions, useDocumentView, useSettings, useUpdateState } from './hooks'

export function App(): React.JSX.Element {
    const api = window.branchchat
    const view = useDocumentView()
    // the convert wizard is offered only for an open discussion that is not shared yet (checked when it opens)
    const viewRef = useRef(view)
    viewRef.current = view
    const [settings, setSettings] = useSettings()
    const [version, setVersion] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [pending, setPending] = useState<{ run: () => void } | null>(null)
    // Which thread this window shows; reset when another discussion is shown.
    const [nav, setNav] = useState<{ documentId: string; threadId: string; focus?: string } | null>(
        null
    )
    const update = useUpdateState()
    const discussions = useDiscussions()
    const [askTitle, setAskTitle] = useState(false)
    const [migration, setMigration] = useState<MigrationCandidate[] | null>(null)
    const [showRestore, setShowRestore] = useState(false)
    const [bannerHidden, setBannerHidden] = useState<string | null>(null)
    const [showSettings, setShowSettings] = useState(false)
    const [showShortcuts, setShowShortcuts] = useState(false)
    const [jumpRequest, setJumpRequest] = useState(0)
    const [findRequest, setFindRequest] = useState(0)
    const [branchMapRequest, setBranchMapRequest] = useState(0)
    const [showSearchAll, setShowSearchAll] = useState(false)
    const [highlightWords, setHighlightWords] = useState<string[]>([])
    const [wizard, setWizard] = useState<WizardMode | null>(null)
    const [reinviteTarget, setReinviteTarget] = useState<ReinviteTarget | null>(null)
    const [readNotice, setReadNotice] = useState<{ retry: () => void } | null>(null)
    const settingsRef = useRef(settings)
    settingsRef.current = settings

    useEffect(() => {
        void api.getAppInfo().then((r) => r.ok && setVersion(r.data.version))
        // FR-206: at the first start with the library, the discussion files of the earlier storage are offered
        void api.getMigration().then((r) => r.ok && r.data.length > 0 && setMigration(r.data))
    }, [api])

    /** Runs the action once a participant name exists; asks for it first if needed (FR-019). */
    const withName = useCallback((run: () => void) => {
        if (settingsRef.current?.displayName) run()
        else setPending({ run })
    }, [])

    const report = useCallback((r: { ok: boolean; error?: { message: string } }) => {
        setError(r.ok ? null : (r.error?.message ?? null))
    }, [])

    const startNew = useCallback(() => withName(() => setAskTitle(true)), [withName])
    const createNew = (title: string): void => {
        setAskTitle(false)
        void api.newDocument(title).then(report)
    }
    const openDialog = useCallback(() => void api.openDocumentDialog().then(report), [api, report])

    useEffect(
        () =>
            api.onMenuCommand((command) => {
                if (command === 'new') startNew()
                else if (command === 'settings') {
                    // the settings may have changed in the main process (start with Windows, FR-174)
                    void api.getSettings().then((r) => {
                        if (r.ok) setSettings(r.data)
                        setShowSettings(true)
                    })
                } else if (command === 'new-shared') setWizard('new')
                else if (command === 'join-shared') setWizard('join')
                else if (command === 'shortcuts') setShowShortcuts(true)
                else if (command === 'jump-to-date') setJumpRequest((n) => n + 1)
                else if (command === 'restore') setShowRestore(true)
                else if (command === 'find') {
                    if (viewRef.current) setFindRequest((n) => n + 1)
                } else if (command === 'find-all') setShowSearchAll(true)
                else if (command === 'branch-map') {
                    if (viewRef.current) setBranchMapRequest((n) => n + 1)
                } else if (command === 'invite-member') {
                    if (viewRef.current?.synced) setWizard('invite')
                } else if (command === 'make-shared') {
                    if (viewRef.current && !viewRef.current.synced) setWizard('convert')
                } else openDialog()
            }),
        [api, startNew, openDialog, setSettings]
    )

    // FR-301: zoom keys that did not pass the main process, and Ctrl + mouse wheel (one step per notch).
    useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
            const direction = zoomKeyOfEvent(e)
            if (!direction) return
            e.preventDefault()
            void api.zoom(direction)
        }
        let wheel = 0
        const onWheel = (e: WheelEvent): void => {
            if (!e.ctrlKey) return
            e.preventDefault()
            // a touchpad sends many small steps; one step needs 100 units
            wheel += e.deltaY
            if (Math.abs(wheel) < 100) return
            void api.zoom(wheel < 0 ? 'in' : 'out')
            wheel = 0
        }
        window.addEventListener('keydown', onKey, true)
        window.addEventListener('wheel', onWheel, { passive: false })
        return () => {
            window.removeEventListener('keydown', onKey, true)
            window.removeEventListener('wheel', onWheel)
        }
    }, [api])

    // The settings changed in the main process (text size from the keyboard or the mouse wheel, FR-301).
    useEffect(
        () =>
            api.onSettingsChanged((next) => {
                setSettings(next)
                settingsRef.current = next
            }),
        [api, setSettings]
    )

    // A click on a notification (D-33): show that message. The request waits in the main process until this page asks.
    useEffect(() => {
        const pull = (): void =>
            void api.takeFocusRequest().then((r) => {
                if (r.ok && r.data)
                    setNav({
                        documentId: r.data.documentId,
                        threadId: r.data.threadId,
                        focus: r.data.messageId
                    })
            })
        pull()
        return api.onFocusRequest(pull)
    }, [api])

    // FR-224: the branch of each discussion shown in this window, kept while the window shows another discussion
    const lastThread = useRef(new Map<string, string>())
    const activeThreadId = useMemo(() => {
        if (!view) return null
        const wanted =
            nav?.documentId === view.documentId
                ? nav.threadId
                : lastThread.current.get(view.documentId)
        const exists =
            wanted !== undefined && view.discussion.threads.some((t) => t.threadId === wanted)
        return exists ? wanted : mainThread(view.discussion).threadId
    }, [view, nav])
    useEffect(() => {
        if (view && activeThreadId) lastThread.current.set(view.documentId, activeThreadId)
    }, [view, activeThreadId])

    const selectThread = useCallback(
        (threadId: string, focus?: string) => {
            if (!view) return
            setNav({ documentId: view.documentId, threadId, ...(focus ? { focus } : {}) })
        },
        [view]
    )
    const sidebarChange = useCallback(
        (change: Parameters<typeof api.setSidebar>[0]) =>
            void api.setSidebar(change).then((r) => {
                if (r.ok) {
                    setSettings(r.data)
                    settingsRef.current = r.data
                } else report(r)
            }),
        [api, report, setSettings]
    )

    /**
     * Runs an action that may change the person's read state. If the one-time notice has not been shown yet, the main
     * process refuses with READ_NOTICE_REQUIRED; the notice is shown and the action is repeated once it is confirmed
     * (FR-125).
     */
    const perform = useCallback(
        async <T,>(
            action: () => Promise<IpcResult<T>>,
            onDone?: (data: T) => void
        ): Promise<void> => {
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

    const send = (content: RichDoc, attachments: Attachment[], clear: () => void): void =>
        withName(() => {
            if (!activeThreadId) return
            void perform(() => api.appendMessage(activeThreadId, content, attachments), clear)
        })
    // FR-231: a reaction needs the name of the person (like a message); it changes no read mark (FR-234)
    const toggleReaction = useCallback(
        (messageId: string, emoji: ReactionEmoji): void =>
            withName(() => void api.toggleReaction(messageId, emoji).then(report)),
        [api, report, withName]
    )
    const attachmentAction = useCallback(
        (action: 'open' | 'save', messageId: string, index: number): void =>
            void (
                action === 'open'
                    ? api.openAttachment(messageId, index)
                    : api.saveAttachment(messageId, index)
            ).then(report),
        [api, report]
    )
    const openSettings = useCallback(() => setShowSettings(true), [])

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
            if (path.toLowerCase().endsWith(DISCUSSION_EXTENSION))
                void api.openPath(path).then(report)
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
                        <span>{texts().update.banner(update.info.version)}</span>
                        <button
                            type="button"
                            data-testid="update-banner-details"
                            onClick={() => void api.showUpdateDialog()}
                        >
                            {texts().update.bannerDetails}
                        </button>
                        <button
                            type="button"
                            aria-label={texts().update.bannerDismiss}
                            onClick={() => setBannerHidden(update.info?.version ?? null)}
                        >
                            ×
                        </button>
                    </div>
                )}
            {view === undefined ? null : view === null ? (
                <Launcher
                    version={version}
                    discussions={discussions ?? []}
                    onNew={startNew}
                    onImport={openDialog}
                    onOpenDiscussion={(id) => void api.openDiscussion(id).then(report)}
                />
            ) : (
                <div className="layout">
                    {settings && (
                        <DiscussionSidebar
                            discussions={discussions ?? []}
                            currentId={view.documentId}
                            settings={settings.sidebar}
                            onChange={sidebarChange}
                            onOpen={(id) => void api.openDiscussion(id).then(report)}
                            onSearchAll={() => setShowSearchAll(true)}
                            onOpenInNewWindow={(id) =>
                                void api.openDiscussionInNewWindow(id).then(report)
                            }
                        />
                    )}
                    <DiscussionScreen
                        // a new screen per discussion; the branch and the scroll position come back (FR-224)
                        key={view.documentId}
                        view={view}
                        threadId={activeThreadId ?? ''}
                        {...(nav?.focus && nav.threadId === activeThreadId
                            ? { focusMessageId: nav.focus }
                            : {})}
                        onSelectThread={selectThread}
                        onSend={send}
                        onToggleReaction={toggleReaction}
                        onAttachment={attachmentAction}
                        receiveLimitMb={settings?.fileSizeLimitMb ?? 30}
                        onOpenSettings={openSettings}
                        onMarkMessageRead={markMessageRead}
                        onMarkThreadRead={markThreadRead}
                        onMarkAllRead={markAllRead}
                        onReply={reply}
                        onSetStatus={(threadId, status) =>
                            void api.setBranchStatus(threadId, status).then(report)
                        }
                        onSetTitle={(threadId, title) =>
                            void api.setBranchTitle(threadId, title).then(report)
                        }
                        onRetrySave={() => void api.retrySave().then(report)}
                        onInvite={() => setWizard('invite')}
                        jumpRequest={jumpRequest}
                        findRequest={findRequest}
                        branchMapRequest={branchMapRequest}
                        highlightWords={highlightWords}
                        onHighlight={setHighlightWords}
                        onReinvite={(target) => {
                            setReinviteTarget(target)
                            setWizard('reinvite')
                        }}
                    />
                </div>
            )}
            {update?.dialogOpen && <UpdateDialog view={update} />}
            {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
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
                    onRestore={() => {
                        setShowSettings(false)
                        setShowRestore(true)
                    }}
                />
            )}
            {wizard &&
                ((wizard !== 'convert' && wizard !== 'invite' && wizard !== 'reinvite') ||
                    view) && (
                    <SharedWizard
                        mode={wizard}
                        settings={settings}
                        onClose={() => setWizard(null)}
                        {...(wizard === 'reinvite' && reinviteTarget
                            ? { target: reinviteTarget }
                            : {})}
                    />
                )}
            {pending && <NamePrompt onSubmit={submitName} onCancel={() => setPending(null)} />}
            {askTitle && <TitlePrompt onSubmit={createNew} onCancel={() => setAskTitle(false)} />}
            {showRestore && <RestoreDialog onClose={() => setShowRestore(false)} />}
            {showSearchAll && (
                <SearchAllDialog
                    onClose={() => setShowSearchAll(false)}
                    onShow={(hit, words) => {
                        setShowSearchAll(false)
                        setHighlightWords(words)
                        void api
                            .openAt(hit.discussionId, hit.threadId, hit.messageId ?? '')
                            .then(report)
                    }}
                />
            )}
            {migration && (
                <MigrationDialog candidates={migration} onClose={() => setMigration(null)} />
            )}
            {readNotice && (
                <ReadNotice onConfirm={confirmReadNotice} onCancel={() => setReadNotice(null)} />
            )}
        </div>
    )
}
