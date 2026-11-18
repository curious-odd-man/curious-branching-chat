import { useCallback, useMemo, useRef, useState } from 'react'
import {
    branchesBySourceMessage,
    firstMessageOfEachDay,
    buildReadSets,
    type MarkSync,
    findMessage,
    mainThread,
    resolveContext,
    unreadSummary
} from '@shared/domain'
import { texts } from '@shared/i18n'
import { assetUrl } from '@shared/types/assets'
import type { DocumentView } from '@shared/types/ipc'
import type { Attachment, ReactionEmoji, RichDoc } from '@shared/validation'
import { useApi } from '../../api'
import type { MessageExtrasContext } from './MessageExtras'
import { BranchHeader } from '../branches/BranchHeader'
import { BranchPanel } from '../branches/BranchPanel'
import { BranchMap } from '../branches/BranchMap'
import { Composer } from './Composer'
import { DiscussionHeader } from './DiscussionHeader'
import { ImageViewer } from './ImageViewer'
import { MessageList } from './MessageList'
import type { ReinviteTarget } from '../wizard/SharedWizard'
import { SearchBar } from '../search/SearchBar'
import { SyncStatusLine } from './SyncStatusLine'
import { buildThreadRows } from './threadRows'
import { useOpenOnRequest, useToday } from './screenHooks'

interface Props {
    view: DocumentView
    /** The thread shown in the main area (the main thread or a branch). */
    threadId: string
    /** Open this message when the thread is shown (used by "go to source message"). */
    focusMessageId?: string
    onSelectThread(threadId: string, focusMessageId?: string): void
    onSend(content: RichDoc, attachments: Attachment[], clear: () => void): void
    /** FR-231: adds or removes a reaction of the person. */
    onToggleReaction(messageId: string, emoji: ReactionEmoji): void
    /** FR-262: "Открыть" and "Сохранить как…" of a file. */
    onAttachment(action: 'open' | 'save', messageId: string, index: number): void
    /** FR-268a: the own file size limit of the shared folder, in MB. */
    receiveLimitMb: number
    /** FR-268a: "Изменить предел" opens Settings. */
    onOpenSettings(): void
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
    /** FR-242: a new value (Ctrl+G or the menu) opens "Перейти к дате…". */
    jumpRequest?: number
    /** FR-211: a new value (Ctrl+F or the menu) opens the search field. */
    findRequest?: number
    /** FR-271: a new value (Ctrl+Shift+M or the menu) opens the branch map. */
    branchMapRequest?: number
    /** FR-213: the words to highlight (the last search). */
    highlightWords?: readonly string[]
    onHighlight(words: string[]): void
}

export function DiscussionScreen({
    view,
    threadId,
    focusMessageId,
    onSelectThread,
    onSend,
    onToggleReaction,
    onAttachment,
    receiveLimitMb,
    onOpenSettings,
    onMarkMessageRead,
    onMarkThreadRead,
    onMarkAllRead,
    onReply,
    onSetStatus,
    onSetTitle,
    onRetrySave,
    onInvite,
    onReinvite,
    jumpRequest,
    findRequest,
    branchMapRequest,
    highlightWords,
    onHighlight
}: Props): React.JSX.Element {
    const api = useApi()
    const today = useToday()
    const [dismissed, setDismissed] = useState<string[]>([])
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
    // reactions (names of the people) and files (which ones are here)
    const extras = useMemo<MessageExtrasContext>(() => {
        const names = new Map<string, string>()
        for (const p of discussion.participants) names.set(p.participantId, p.displayName)
        for (const p of view.knownParticipants) names.set(p.participantId, p.displayName)
        return {
            localId: view.localParticipantId,
            names,
            onToggleReaction,
            missing: new Set(view.missingAttachments),
            synced: view.synced,
            receiveLimitMb,
            onSave: (messageId, index) => onAttachment('save', messageId, index),
            onOpen: (messageId, index) => onAttachment('open', messageId, index),
            onChangeLimit: onOpenSettings
        }
    }, [
        discussion.participants,
        view.knownParticipants,
        view.localParticipantId,
        view.missingAttachments,
        view.synced,
        receiveLimitMb,
        onToggleReaction,
        onAttachment,
        onOpenSettings
    ])

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

    const rows = useMemo(
        () => buildThreadRows(context, view.loading, today),
        [context, view.loading, today]
    )

    // FR-242: the days of the branch's own messages, with the first message of each day
    const days = useMemo(
        () => firstMessageOfEachDay(context.own, (m) => m.createdAt),
        [context.own]
    )
    const [showJump, setShowJump] = useOpenOnRequest(jumpRequest)
    const [showSearch, setShowSearch] = useOpenOnRequest(findRequest)
    const [showMap, setShowMap] = useOpenOnRequest(branchMapRequest)
    // FR-224: only the first list after the discussion is shown again opens at the kept position
    const firstList = useRef(threadId)
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
            <DiscussionHeader
                view={view}
                today={today}
                days={days}
                showJump={showJump}
                setShowJump={setShowJump}
                unreadTotal={unread.total}
                onMarkAllRead={onMarkAllRead}
                onOpenSearch={() => setShowSearch(true)}
                onOpenMap={() => setShowMap(true)}
                onShowMessage={(messageId) => onSelectThread(threadId, messageId)}
                onInvite={onInvite}
                onReinvite={onReinvite}
            />
            <SyncStatusLine status={view.syncStatus} />
            {showSearch && (
                <SearchBar
                    onShow={(hit, words) => {
                        onHighlight(words)
                        onSelectThread(hit.threadId, hit.messageId ?? undefined)
                    }}
                    onClose={() => {
                        setShowSearch(false)
                        onHighlight([])
                    }}
                />
            )}

            {view.saveError && (
                <div className="banner error" role="alert" data-testid="save-error">
                    <span>{texts().discussion.saveFailed(view.saveError)}</span>
                    <button type="button" data-testid="retry-save" onClick={onRetrySave}>
                        {texts().discussion.retry}
                    </button>
                </div>
            )}
            {view.notices
                .filter((n) => !dismissed.includes(n))
                .map((notice) => (
                    <div className="banner notice" role="status" data-testid="notice" key={notice}>
                        <span>{notice}</span>
                        <button type="button" onClick={() => setDismissed([...dismissed, notice])}>
                            {texts().discussion.dismiss}
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
                                {texts().unread.inThread(threadUnread)}
                            </span>
                            <button
                                type="button"
                                data-testid="mark-thread-read"
                                title={texts().unread.markThread}
                                onClick={() => onMarkThreadRead(threadId)}
                            >
                                {texts().unread.markThread}
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
                        onOpenLink={(href) => void api.openLink(href)}
                        onReply={onReply}
                        onOpenBranch={(id) => onSelectThread(id)}
                        sync={markSync}
                        extras={extras}
                        positionKey={`${view.documentId}:${threadId}`}
                        restorePosition={firstList.current === threadId}
                        {...(highlightWords ? { highlightWords } : {})}
                        {...(focusMessageId ? { focusMessageId } : {})}
                    />
                    <Composer
                        sessionId={view.sessionId}
                        threadId={threadId}
                        synced={view.synced}
                        blocked={
                            closed
                                ? {
                                      message: texts().branches.closedNotice,
                                      actionLabel: texts().branches.reopen,
                                      onAction: () => onSetStatus(threadId, 'open')
                                  }
                                : undefined
                        }
                        onSend={onSend}
                    />
                </div>
            </div>
            {showMap && (
                <BranchMap
                    discussion={discussion}
                    currentThreadId={threadId}
                    unread={unread}
                    onClose={() => setShowMap(false)}
                    onSelect={(id) => {
                        setShowMap(false)
                        onSelectThread(id)
                    }}
                />
            )}
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
