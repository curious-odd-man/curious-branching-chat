import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Message, Thread } from '@shared/types'
import { ru } from '@shared/i18n/ru'
import { formatTimestamp } from '../../i18n/format'
import { BranchBadge } from '../branches/BranchBadge'
import { RichTextView, type Highlight } from '../rich/RichTextView'
import { readMessageSelection, type MessageSelection } from './selection'

export type ListRow =
  | {
      kind: 'message'
      message: Message
      /** Context from a parent thread: read-only, shown differently (FR-053, FR-062). */
      inherited: boolean
      /** The quoted passage of the current branch, in the source message (FR-054). */
      highlight: Highlight | null
    }
  | { kind: 'divider'; id: string; label: string }

interface Props {
  rows: ListRow[]
  localParticipantId: string
  branchesByMessage: Map<string, Thread[]>
  onOpenLink(href: string): void
  /** "Reply to this" was chosen for a passage of a message. */
  onReply(selection: { messageId: string; start: number; end: number }): void
  onOpenBranch(threadId: string): void
  /** Scroll to this message when the list opens (instead of the newest) and flash it. */
  focusMessageId?: string
}

/** The user counts as "at the bottom" when closer than this to the end (pixels). */
const STICK_THRESHOLD = 80

const rowKey = (row: ListRow): string => (row.kind === 'message' ? row.message.messageId : row.id)

/**
 * Virtualized message list (NFR-004): only the messages near the viewport are in the page, so a discussion of
 * thousands of messages stays responsive.
 *
 * Scrolling: the list opens at the newest message (or at `focusMessageId`). New messages scroll into view only if the
 * person was already at the bottom, or wrote the message themselves; someone reading older messages is never pulled
 * away.
 *
 * Selecting text inside one message shows a "Reply to this" button (FR-049, FR-050).
 */
export function MessageList({
  rows,
  localParticipantId,
  branchesByMessage,
  onOpenLink,
  onReply,
  onOpenBranch,
  focusMessageId
}: Props): React.JSX.Element {
  const scroller = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const previousCount = useRef(0)
  const [selection, setSelection] = useState<MessageSelection | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 96,
    overscan: 8,
    getItemKey: (index) => {
      const row = rows[index]
      return row ? rowKey(row) : index
    }
  })

  useLayoutEffect(() => {
    const count = rows.length
    const grew = count > previousCount.current
    const first = previousCount.current === 0
    const last = rows[count - 1]
    const ownLast = last?.kind === 'message' && last.message.authorId === localParticipantId
    previousCount.current = count
    if (count === 0) return

    if (first && focusMessageId) {
      const index = rows.findIndex(
        (r) => r.kind === 'message' && r.message.messageId === focusMessageId
      )
      if (index >= 0) {
        const toIndex = (): void => virtualizer.scrollToIndex(index, { align: 'center' })
        toIndex()
        atBottom.current = false
        setFlashId(focusMessageId)
        const frame = requestAnimationFrame(toIndex)
        const timer = setTimeout(() => setFlashId(null), 1800)
        return () => {
          cancelAnimationFrame(frame)
          clearTimeout(timer)
        }
      }
    }
    if (!(first || (grew && (atBottom.current || ownLast)))) return

    const toEnd = (): void => virtualizer.scrollToIndex(count - 1, { align: 'end' })
    toEnd()
    atBottom.current = true
    // Row heights are measured after the first paint; settle once more at the true bottom.
    const frame = requestAnimationFrame(toEnd)
    return () => cancelAnimationFrame(frame)
    // Only the row count matters here (not the other props), so the dependency list below is deliberate.
  }, [rows.length])

  const onScroll = (): void => {
    const el = scroller.current
    if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD
    if (selection) setSelection(readMessageSelection(el))
  }

  // Show "Reply to this" once a selection is finished (mouse released, or keyboard selection), hide it when the
  // selection collapses.
  const refreshSelection = useCallback(() => {
    const el = scroller.current
    if (el) setSelection(readMessageSelection(el))
  }, [])
  useEffect(() => {
    const onSelectionChange = (): void => {
      if (window.getSelection()?.isCollapsed) setSelection(null)
    }
    document.addEventListener('mouseup', refreshSelection)
    document.addEventListener('keyup', refreshSelection)
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      document.removeEventListener('mouseup', refreshSelection)
      document.removeEventListener('keyup', refreshSelection)
      document.removeEventListener('selectionchange', onSelectionChange)
    }
  }, [refreshSelection])

  const reply = (): void => {
    if (!selection) return
    const { messageId, start, end } = selection
    window.getSelection()?.removeAllRanges()
    setSelection(null)
    onReply({ messageId, start, end })
  }

  const buttonStyle = selection ? replyButtonPosition(selection.rect) : undefined

  return (
    <div className="messages" data-testid="messages" ref={scroller} onScroll={onScroll}>
      {rows.length === 0 && <p className="empty">{ru.discussion.empty}</p>}
      <div className="rows" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index]
          if (!row) return null
          const common = {
            ref: virtualizer.measureElement,
            'data-index': item.index,
            style: { transform: `translateY(${item.start}px)` }
          }
          if (row.kind === 'divider')
            return (
              <div key={item.key} {...common} className="row divider-row">
                <div className="divider" data-testid="divider">
                  {row.label}
                </div>
              </div>
            )
          const m = row.message
          const own = m.authorId === localParticipantId
          const classes = [
            'row',
            own ? 'own' : '',
            row.inherited ? 'inherited' : '',
            flashId === m.messageId ? 'flash' : ''
          ]
          return (
            <div key={item.key} {...common} className={classes.filter(Boolean).join(' ')}>
              <article
                className="message"
                data-testid={row.inherited ? 'inherited-message' : 'message'}
                data-message-id={m.messageId}
              >
                <header>
                  <strong>{m.authorDisplayName}</strong>
                  <time dateTime={m.createdAt}>{formatTimestamp(m.createdAt)}</time>
                  <BranchBadge
                    branches={branchesByMessage.get(m.messageId) ?? []}
                    onOpen={onOpenBranch}
                  />
                </header>
                <RichTextView doc={m.content} onOpenLink={onOpenLink} highlight={row.highlight} />
              </article>
            </div>
          )
        })}
      </div>
      {selection && (
        <button
          type="button"
          className="reply-button primary"
          data-testid="reply-to-this"
          title={ru.branches.replyHint}
          style={buttonStyle}
          // keep the selection while the button is pressed
          onMouseDown={(e) => e.preventDefault()}
          onClick={reply}
        >
          {ru.branches.replyToThis}
        </button>
      )}
    </div>
  )
}

/** Just below the end of the selection, kept inside the window. */
function replyButtonPosition(rect: DOMRect): React.CSSProperties {
  const width = 190
  const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8))
  const below = rect.bottom + 8
  const top = below > window.innerHeight - 60 ? Math.max(8, rect.top - 44) : below
  return { position: 'fixed', left, top, zIndex: 20 }
}
