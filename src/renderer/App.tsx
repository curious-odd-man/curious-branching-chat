import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { Attachment, ReactionEmoji, RichDoc } from '@shared/validation'
import { DISCUSSION_EXTENSION } from '@shared/types/constants'
import type { IpcResult, SettingsView } from '@shared/types/ipc'
import { useApi } from './api'
import { appReducer, INITIAL_APP_STATE, menuAction, type SimpleDialog } from './appState'
import { useActiveThread, useFocusRequests, useZoomInput, type Navigation } from './appHooks'
import { ErrorBanner, UpdateBanner } from './components/AppBanners'
import { Launcher } from './components/Launcher'
import { NamePrompt } from './components/NamePrompt'
import { TitlePrompt } from './components/TitlePrompt'
import { MigrationDialog } from './components/MigrationDialog'
import { RestoreDialog } from './components/RestoreDialog'
import { ReadNotice } from './components/ReadNotice'
import { SettingsDialog } from './components/settings/SettingsDialog'
import { ShortcutsDialog } from './components/ShortcutsDialog'
import { SharedWizard } from './components/wizard/SharedWizard'
import { UpdateDialog } from './components/UpdateDialog'
import { DiscussionScreen } from './components/chat/DiscussionScreen'
import { DiscussionSidebar } from './components/DiscussionSidebar'
import { SearchAllDialog } from './components/search/SearchAllDialog'
import { useDiscussions, useDocumentView, useSettings, useUpdateState } from './hooks'
import { FILE_SIZE_LIMIT_MB } from '@shared/sync'

/** The window: the launcher or the discussion, and the dialogs. The dialog state is in `appReducer` (code review 4.4). */
export function App(): React.JSX.Element {
    const api = useApi()
    const view = useDocumentView()
    // the menu commands check the view when they arrive
    const viewRef = useRef(view)
    viewRef.current = view
    const { settings, current: currentSettings, set: setSettings } = useSettings()
    const update = useUpdateState()
    const discussions = useDiscussions()
    const [version, setVersion] = useState('')
    const [state, dispatch] = useReducer(appReducer, INITIAL_APP_STATE)
    const open = (dialog: SimpleDialog): void => dispatch({ type: 'open', dialog })
    const close = (dialog: SimpleDialog): void => dispatch({ type: 'close', dialog })
    // the error of the last action; a successful action removes it
    const [error, setError] = useState<string | null>(null)
    const [highlightWords, setHighlightWords] = useState<string[]>([])
    // Which thread this window shows; reset when another discussion is shown.
    const [nav, setNav] = useState<Navigation | null>(null)
    const activeThreadId = useActiveThread(view, nav)

    useEffect(() => {
        void api.getAppInfo().then((r) => r.ok && setVersion(r.data.version))
        // FR-206: at the first start with the library, the discussion files of the earlier storage are offered
        void api
            .getMigration()
            .then(
                (r) =>
                    r.ok && r.data.length > 0 && dispatch({ type: 'migration', candidates: r.data })
            )
    }, [api])

    /** Runs the action once a participant name exists; asks for it first if needed (FR-019). */
    const withName = useCallback(
        (run: () => void) => {
            if (currentSettings()?.displayName) run()
            else dispatch({ type: 'askName', run })
        },
        [currentSettings]
    )

    const report = useCallback(
        (r: { ok: boolean; error?: { message: string } }) =>
            setError(r.ok ? null : (r.error?.message ?? null)),
        [setError]
    )

    const startNew = useCallback(
        () => withName(() => dispatch({ type: 'open', dialog: 'askTitle' })),
        [withName]
    )
    const createNew = (title: string): void => {
        close('askTitle')
        void api.newDocument(title).then(report)
    }
    const openDialog = useCallback(() => void api.openDocumentDialog().then(report), [api, report])

    useEffect(
        () =>
            api.onMenuCommand((command) => {
                const current = viewRef.current
                const action = menuAction(command, {
                    hasDiscussion: Boolean(current),
                    synced: Boolean(current?.synced)
                })
                if (action) dispatch(action)
                else if (action === null) return
                else if (command === 'new') startNew()
                else if (command === 'settings') {
                    // the settings may have changed in the main process (start with Windows, FR-174)
                    void api.getSettings().then((r) => {
                        if (r.ok) setSettings(r.data)
                        dispatch({ type: 'open', dialog: 'settings' })
                    })
                } else openDialog()
            }),
        [api, startNew, openDialog, setSettings]
    )

    useZoomInput()
    // The settings changed in the main process (text size from the keyboard or the mouse wheel, FR-301).
    useEffect(() => api.onSettingsChanged(setSettings), [api, setSettings])
    useFocusRequests((r) =>
        setNav({ documentId: r.documentId, threadId: r.threadId, focus: r.messageId })
    )

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
                if (r.ok) setSettings(r.data)
                else report(r)
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
                dispatch({ type: 'readNotice', retry: () => void perform(action, onDone) })
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
    const openSettings = useCallback(() => dispatch({ type: 'open', dialog: 'settings' }), [])

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

    /** Saves the new settings, then runs the action that waited for them. */
    const thenRun =
        (next: (() => void) | undefined) =>
        (r: IpcResult<SettingsView>): void => {
            if (!r.ok) return report(r)
            setSettings(r.data)
            next?.()
        }
    const confirmReadNotice = (): void => {
        const waiting = state.readNotice
        void api.acknowledgeReadNotice().then(
            thenRun(() => {
                dispatch({ type: 'readNotice', retry: null })
                waiting?.retry()
            })
        )
    }
    const submitName = (name: string): void => {
        const waiting = state.askName
        void api.setDisplayName(name).then(
            thenRun(() => {
                dispatch({ type: 'askName', run: null })
                waiting?.run()
            })
        )
    }

    const onDrop = (event: React.DragEvent): void => {
        event.preventDefault()
        for (const file of Array.from(event.dataTransfer.files)) {
            const path = api.getPathForFile(file)
            if (path.toLowerCase().endsWith(DISCUSSION_EXTENSION))
                void api.openPath(path).then(report)
        }
    }

    const { wizard, requests } = state
    return (
        <div className="root" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
            <ErrorBanner error={error} onClose={() => setError(null)} />
            <UpdateBanner update={update} />
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
                            onSearchAll={() => open('searchAll')}
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
                        receiveLimitMb={settings?.fileSizeLimitMb ?? FILE_SIZE_LIMIT_MB.default}
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
                        onInvite={() => dispatch({ type: 'wizard', mode: 'invite' })}
                        jumpRequest={requests.jump}
                        findRequest={requests.find}
                        branchMapRequest={requests.branchMap}
                        highlightWords={highlightWords}
                        onHighlight={setHighlightWords}
                        onReinvite={(target) =>
                            dispatch({ type: 'wizard', mode: 'reinvite', target })
                        }
                    />
                </div>
            )}
            {update?.dialogOpen && <UpdateDialog view={update} />}
            {state.open.has('shortcuts') && <ShortcutsDialog onClose={() => close('shortcuts')} />}
            {state.open.has('settings') && (
                <SettingsDialog
                    settings={settings}
                    onNameSaved={setSettings}
                    onSettingsChanged={setSettings}
                    onClose={() => close('settings')}
                    onRestore={() => {
                        close('settings')
                        open('restore')
                    }}
                />
            )}
            {wizard &&
                ((wizard.mode !== 'convert' &&
                    wizard.mode !== 'invite' &&
                    wizard.mode !== 'reinvite') ||
                    view) && (
                    <SharedWizard
                        mode={wizard.mode}
                        settings={settings}
                        onClose={() => dispatch({ type: 'closeWizard' })}
                        {...(wizard.target ? { target: wizard.target } : {})}
                    />
                )}
            {state.askName && (
                <NamePrompt
                    onSubmit={submitName}
                    onCancel={() => dispatch({ type: 'askName', run: null })}
                />
            )}
            {state.open.has('askTitle') && (
                <TitlePrompt onSubmit={createNew} onCancel={() => close('askTitle')} />
            )}
            {state.open.has('restore') && <RestoreDialog onClose={() => close('restore')} />}
            {state.open.has('searchAll') && (
                <SearchAllDialog
                    onClose={() => close('searchAll')}
                    onShow={(hit, words) => {
                        close('searchAll')
                        setHighlightWords(words)
                        void api
                            .openAt(hit.discussionId, hit.threadId, hit.messageId ?? '')
                            .then(report)
                    }}
                />
            )}
            {state.migration && (
                <MigrationDialog
                    candidates={state.migration}
                    onClose={() => dispatch({ type: 'migration', candidates: null })}
                />
            )}
            {state.readNotice && (
                <ReadNotice
                    onConfirm={confirmReadNotice}
                    onCancel={() => dispatch({ type: 'readNotice', retry: null })}
                />
            )}
        </div>
    )
}
