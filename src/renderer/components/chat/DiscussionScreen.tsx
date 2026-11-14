import { useCallback, useMemo, useState } from 'react'
import {
    branchesBySourceMessage,
    buildReadSets,
    type MarkSync,
    findMessage,
    mainThread,
    resolveContext,
    resolveQuoteRange,
    unreadSummary
} from '@shared/domain'
import { ru } from '@shared/i18n/ru'
import { assetUrl } from '@shared/types/assets'
import type { DocumentView } from '@shared/types/ipc'
import { richTextToPlain, type RichDoc } from '@shared/validation'
import { BranchHeader } from '../branches/BranchHeader'
import { BranchPanel } from '../branches/BranchPanel'
import { Composer } from './Composer'
import { ImageViewer } from './ImageViewer'
import { MessageList, type ListRow } from './MessageList'
import { RosterDialog, type ReinviteTarget } from '../SharedWizard'
import { formatTimestamp } from '../../i18n/format'

interface Props {
    view: DocumentView
    /** The thread shown in the main area (the main thread or a branch). */
    threadId: string
    /** Open this message when the thread is shown (used by "go to source message"). */
    focusMessageId?: string
    onSelectThread(threadId: string, focusMessageId?: string): void
    onSend(content: RichDoc, clear: () => void): void
    onMarkMessageRead(messageId: string): void
    onMarkThreadRead(threadId: string): void
    onMarkAllRead(): void
    onReply(selection: { messageId: string; start: number; end: number }): void
    onSetStatus(threadId: string, status: 'open' | 'closed'): void
    onSetTitle(threadId: string, title: string): void
    onRetrySave(): void
    /** FR-176: "Пригласить участника…" from the members dialog. */
    onInvite(): void
    /** FR-177: "Повторно пригласить…" for a member. */
    onReinvite(target: ReinviteTarget): void
}

export function DiscussionScreen({
    view,
    threadId,
    focusMessageId,
    onSelectThread,
    onSend,
    onMarkMessageRead,
    onMarkThreadRead,
    onMarkAllRead,
    onReply,
    onSetStatus,
    onSetTitle,
    onRetrySave,
    onInvite,
    onReinvite
}: Props): React.JSX.Element {
    const [dismissed, setDismissed] = useState<string[]>([])
    const [showRoster, setShowRoster] = useState(false)
    const [checking, setChecking] = useState(false)
    const [viewer, setViewer] = useState<{ assetId: string; alt: string } | null>(null)
    const discussion = view.discussion
    const mainId = mainThread(discussion).threadId
    const closeViewer = useCallback(() => setViewer(null), [])
    const images = useMemo(
        () => ({
            url: (assetId: string) => assetUrl(view.sessionId, assetId),
            missing: new Set(view.missingAssetIds),
            onOpen: (assetId: string, alt: string | undefined) =>
                setViewer({ assetId, alt: alt ?? '' })
        }),
        [view.sessionId, view.missingAssetIds]
    )
    const status = view.saveError ? null : view.saving ? ru.discussion.saving : ru.discussion.saved

    const context = useMemo(() => resolveContext(discussion, threadId), [discussion, threadId])
    const branchesByMessage = useMemo(() => branchesBySourceMessage(discussion), [discussion])

    // Unread marks (FR-110, FR-113) and who has read what (FR-122); both come from the read state in the file.
    const readSets = useMemo(() => buildReadSets(view.readState), [view.readState])
    const markSync = useMemo<MarkSync | null>(
        () =>
            view.synced
                ? {
                      localId: view.localParticipantId,
                      deliverySets: buildReadSets(view.deliveryState),
                      copies: view.copies
                  }
                : null,
        [view.synced, view.localParticipantId, view.deliveryState, view.copies]
    )
    const unread = useMemo(
        () => unreadSummary(discussion, view.readState, view.localParticipantId),
        [discussion, view.readState, view.localParticipantId]
    )
    const threadUnread = unread.byThread.get(threadId)?.own ?? 0
    const thread = context.thread
    const isBranch = thread.parentThreadId !== undefined

    // Inherited context first (read-only), then the branch's own messages (FR-053, requirements 4.5).
    const rows = useMemo<ListRow[]>(() => {
        const out: ListRow[] = []
        if (isBranch && context.inherited.length > 0) {
            out.push({ kind: 'divider', id: 'context-start', label: ru.branches.contextCaption })
            for (const message of context.inherited) {
                const isSource = message.messageId === thread.sourceMessageId
                const highlight = isSource
                    ? resolveQuoteRange(richTextToPlain(message.content), thread)
                    : null
                out.push({ kind: 'message', message, inherited: true, highlight })
            }
            out.push({ kind: 'divider', id: 'context-end', label: ru.branches.contextDivider })
        }
        // loading messages of this thread take their place in the clock order (FR-152, D-37)
        const loading = view.loading
            .filter((l) => l.threadId === thread.threadId)
            .sort((a, b) => compareByClock(a, b))
        let li = 0
        for (const message of context.own) {
            while (li < loading.length && compareByClock(loading[li]!, message) < 0)
                out.push({ kind: 'loading', loading: loading[li++]! })
            out.push({ kind: 'message', message, inherited: false, highlight: null })
        }
        while (li < loading.length) out.push({ kind: 'loading', loading: loading[li++]! })
        return out
    }, [context, isBranch, thread, view.loading])

    const closed = isBranch && thread.status === 'closed'
    const goToSource = (): void => {
        if (thread.parentThreadId && thread.sourceMessageId) {
            // make sure the source message really exists (a damaged file could reference a missing one)
            try {
                findMessage(discussion, thread.sourceMessageId)
                onSelectThread(thread.parentThreadId, thread.sourceMessageId)
            } catch {
                onSelectThread(thread.parentThreadId)
            }
        }
    }

    return (
        <div className="discussion">
            <header className="discussion-header">
                <h1 title={view.filePath}>{view.fileName}</h1>
                {view.synced && (
                    <button
                        type="button"
                        className="roster-button"
                        data-testid="roster-button"
                        title={ru.shared.rosterTitle}
                        onClick={() => setShowRoster(true)}
                    >
                        👥 {view.knownParticipants.length}
                    </button>
                )}
                {view.synced && (
                    <button
                        type="button"
                        className="roster-button"
                        data-testid="sync-check"
                        title={
                            view.syncStatus?.lastScanAt
                                ? ru.syncStatus.lastScan(
                                      formatTimestamp(view.syncStatus.lastScanAt)
                                  )
                                : ru.syncStatus.check
                        }
                        disabled={checking}
                        onClick={() => {
                            setChecking(true)
                            void window.branchchat.checkSyncNow().finally(() => setChecking(false))
                        }}
                    >
                        {checking ? ru.syncStatus.checking : `⟳ ${ru.syncStatus.check}`}
                    </button>
                )}
                {showRoster && (
                    <RosterDialog
                        onClose={() => setShowRoster(false)}
                        onInvite={() => {
                            setShowRoster(false)
                            onInvite()
                        }}
                        onReinvite={(target) => {
                            setShowRoster(false)
                            onReinvite(target)
                        }}
                    />
                )}
                {status && (
                    <span className="status" data-testid="status">
                        {status}
                    </span>
                )}
                {unread.total > 0 && (
                    <span className="unread-total">
                        <span data-testid="unread-total">{ru.unread.total(unread.total)}</span>
                        <button type="button" data-testid="mark-all-read" onClick={onMarkAllRead}>
                            {ru.unread.markAll}
                        </button>
                    </span>
                )}
            </header>
            <SyncStatusLine status={view.syncStatus} />

            {view.saveError && (
                <div className="banner error" role="alert" data-testid="save-error">
                    <span>{ru.discussion.saveFailed(view.saveError)}</span>
                    <button type="button" data-testid="retry-save" onClick={onRetrySave}>
                        {ru.discussion.retry}
                    </button>
                </div>
            )}
            {view.notices
                .filter((n) => !dismissed.includes(n))
                .map((notice) => (
                    <div className="banner notice" role="status" data-testid="notice" key={notice}>
                        <span>{notice}</span>
                        <button type="button" onClick={() => setDismissed([...dismissed, notice])}>
                            {ru.discussion.dismiss}
                        </button>
                    </div>
                ))}

            <div className="workspace">
                <BranchPanel
                    discussion={discussion}
                    currentThreadId={threadId}
                    mainThreadId={mainId}
                    unread={unread}
                    onSelect={(id) => onSelectThread(id)}
                />
                <div className="thread" data-testid="thread" data-thread-id={threadId}>
                    {isBranch && (
                        <BranchHeader
                            thread={thread}
                            path={context.path}
                            onSelect={(id) => onSelectThread(id)}
                            onGoToSource={goToSource}
                            onSetTitle={(title) => onSetTitle(threadId, title)}
                            onSetStatus={(next) => onSetStatus(threadId, next)}
                        />
                    )}
                    {threadUnread > 0 && (
                        <div className="thread-toolbar" data-testid="thread-toolbar">
                            <span data-testid="thread-unread">
                                {ru.unread.inThread(threadUnread)}
                            </span>
                            <button
                                type="button"
                                data-testid="mark-thread-read"
                                title={ru.unread.markThread}
                                onClick={() => onMarkThreadRead(threadId)}
                            >
                                {ru.unread.markThread}
                            </button>
                        </div>
                    )}
                    <MessageList
                        // a new list per thread and per focused message: it opens at the newest message, or at the
                        // focused one (also when a notification asks for another message of the same thread)
                        key={`${threadId}:${focusMessageId ?? ''}`}
                        rows={rows}
                        localParticipantId={view.localParticipantId}
                        participants={view.knownParticipants}
                        readSets={readSets}
                        onMarkRead={onMarkMessageRead}
                        images={images}
                        branchesByMessage={branchesByMessage}
                        onOpenLink={(href) => void window.branchchat.openLink(href)}
                        onReply={onReply}
                        onOpenBranch={(id) => onSelectThread(id)}
                        sync={markSync}
                        {...(focusMessageId ? { focusMessageId } : {})}
                    />
                    <Composer
                        sessionId={view.sessionId}
                        threadId={threadId}
                        blocked={
                            closed
                                ? {
                                      message: ru.branches.closedNotice,
                                      actionLabel: ru.branches.reopen,
                                      onAction: () => onSetStatus(threadId, 'open')
                                  }
                                : undefined
                        }
                        onSend={onSend}
                    />
                </div>
            </div>
            {viewer && (
                <ImageViewer
                    url={images.url(viewer.assetId)}
                    alt={viewer.alt}
                    onClose={closeViewer}
                />
            )}
        </div>
    )
}

/** The same order as messages in a thread (FR-152): clock, then author ID, then message ID. */
function compareByClock(
    a: { clock: number; authorId: string; messageId: string },
    b: { clock: number; authorId: string; messageId: string }
): number {
    const s = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0)
    return a.clock - b.clock || s(a.authorId, b.authorId) || s(a.messageId, b.messageId)
}

/** Problems of a synchronized discussion (FR-172, D-35): only in this line and the tray menu, no notifications. */
function SyncStatusLine({
    status
}: {
    status: DocumentView['syncStatus']
}): React.JSX.Element | null {
    const [busy, setBusy] = useState(false)
    if (!status) return null
    const lines: string[] = []
    if (status.folder === 'missing') lines.push(ru.syncStatus.missing(status.folderPath))
    if (status.folder === 'no-permission') lines.push(ru.syncStatus.noPermission)
    if (status.needsUpdate) lines.push(ru.syncStatus.needsUpdate)
    if (status.quarantined > 0) lines.push(ru.syncStatus.quarantined(status.quarantined))
    if (status.notAccepted.length > 0)
        lines.push(ru.syncStatus.notAccepted(status.notAccepted.join(', ')))
    if (lines.length === 0 && status.keyRequests.length === 0) return null
    // D-32: the decision about new keys of a member; no Windows notification for it (D-35)
    const decide = (participantId: string, accept: boolean): void => {
        setBusy(true)
        void window.branchchat.decideKeys(participantId, accept).finally(() => setBusy(false))
    }
    return (
        <div
            className="sync-status"
            role="status"
            data-testid="sync-status"
            data-folder={status.folder}
        >
            {lines.map((l) => (
                <p key={l}>{l}</p>
            ))}
            {status.keyRequests.map((r) => (
                <div
                    key={r.participantId}
                    className="key-request"
                    data-testid="key-request"
                    data-state={r.state}
                    data-name={r.displayName}
                >
                    <p>
                        {r.state === 'pending'
                            ? ru.syncStatus.keysChanged(r.displayName)
                            : ru.syncStatus.keysRejected(r.displayName)}
                    </p>
                    <p className="fingerprint-row">
                        <span>{ru.identity.fingerprintLabel}: </span>
                        <code className="fingerprint" data-testid="key-request-fingerprint">
                            {r.fingerprint}
                        </code>
                    </p>
                    <div className="buttons">
                        {r.state === 'pending' && (
                            <button
                                type="button"
                                data-testid="key-reject"
                                disabled={busy}
                                onClick={() => decide(r.participantId, false)}
                            >
                                {ru.syncStatus.keysReject}
                            </button>
                        )}
                        <button
                            type="button"
                            className="primary"
                            data-testid="key-accept"
                            disabled={busy}
                            onClick={() => decide(r.participantId, true)}
                        >
                            {r.state === 'pending'
                                ? ru.syncStatus.keysAccept
                                : ru.syncStatus.keysAcceptLater}
                        </button>
                    </div>
                </div>
            ))}
        </div>
    )
}
