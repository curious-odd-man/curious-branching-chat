import { useCallback, useMemo, useState } from 'react'
import {
  branchesBySourceMessage,
  buildReadSets,
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
  onRetrySave
}: Props): React.JSX.Element {
  const [dismissed, setDismissed] = useState<string[]>([])
  const [viewer, setViewer] = useState<{ assetId: string; alt: string } | null>(null)
  const discussion = view.discussion
  const mainId = mainThread(discussion).threadId
  const closeViewer = useCallback(() => setViewer(null), [])
  const images = useMemo(
    () => ({
      url: (assetId: string) => assetUrl(view.sessionId, assetId),
      missing: new Set(view.missingAssetIds),
      onOpen: (assetId: string, alt: string | undefined) => setViewer({ assetId, alt: alt ?? '' })
    }),
    [view.sessionId, view.missingAssetIds]
  )
  const status = view.saveError ? null : view.saving ? ru.discussion.saving : ru.discussion.saved

  const context = useMemo(() => resolveContext(discussion, threadId), [discussion, threadId])
  const branchesByMessage = useMemo(() => branchesBySourceMessage(discussion), [discussion])

  // Unread marks (FR-110, FR-113) and who has read what (FR-122); both come from the read state in the file.
  const readSets = useMemo(() => buildReadSets(view.readState), [view.readState])
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
    for (const message of context.own)
      out.push({ kind: 'message', message, inherited: false, highlight: null })
    return out
  }, [context, isBranch, thread])

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
              <span data-testid="thread-unread">{ru.unread.inThread(threadUnread)}</span>
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
            // a new list per thread: it opens at the newest message, or at the focused one
            key={threadId}
            rows={rows}
            localParticipantId={view.localParticipantId}
            participants={discussion.participants}
            readSets={readSets}
            onMarkRead={onMarkMessageRead}
            images={images}
            branchesByMessage={branchesByMessage}
            onOpenLink={(href) => void window.branchchat.openLink(href)}
            onReply={onReply}
            onOpenBranch={(id) => onSelectThread(id)}
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
        <ImageViewer url={images.url(viewer.assetId)} alt={viewer.alt} onClose={closeViewer} />
      )}
    </div>
  )
}
