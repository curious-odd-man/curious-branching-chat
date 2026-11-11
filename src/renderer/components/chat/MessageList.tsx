import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { isUnreadIn, readStatusOf } from '@shared/domain'
import type { Message, Participant, Thread } from '@shared/types'
import type { LoadingMessage } from '@shared/sync'
import { ru } from '@shared/i18n/ru'
import { formatTimestamp } from '../../i18n/format'
import { BranchBadge } from '../branches/BranchBadge'
import { RichTextView, type Highlight, type ImageContext } from '../rich/RichTextView'
import { ReadIndicator } from './ReadIndicator'
import { DeliveryMark } from './DeliveryMark'
import type { DeliveryView } from '@shared/types/ipc'
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
    /** A message of a synchronized discussion whose parts are still arriving (D-30, D-37). */
    | { kind: 'loading'; loading: LoadingMessage }

interface Props {
    rows: ListRow[]
    localParticipantId: string
    /** Known participants and what each has read (as sets), for unread marks and the read indicator. */
    participants: readonly Participant[]
    readSets: Map<string, Set<string>>
    onMarkRead(messageId: string): void
    /** Images of this discussion; the list adds its own scroll handling when an image loads. */
    images: Omit<ImageContext, 'onLoad'>
    branchesByMessage: Map<string, Thread[]>
    onOpenLink(href: string): void
    /** "Reply to this" was chosen for a passage of a message. */
    onReply(selection: { messageId: string; start: number; end: number }): void
    onOpenBranch(threadId: string): void
    /** Scroll to this message when the list opens (instead of the newest) and flash it. */
    focusMessageId?: string
    /** Delivery of own messages in a synchronized discussion (FR-169). */
    delivery?: Record<string, DeliveryView>
}

const NO_DELIVERY: Record<string, DeliveryView> = {}

function readersOf(readSets: Map<string, Set<string>>, messageId: string): Set<string> {
    const out = new Set<string>()
    for (const [participantId, set] of readSets) if (set.has(messageId)) out.add(participantId)
    return out
}

/** The user counts as "at the bottom" when closer than this to the end (pixels). */
const STICK_THRESHOLD = 80

const rowKey = (row: ListRow): string =>
    row.kind === 'message'
        ? row.message.messageId
        : row.kind === 'loading'
          ? `loading-${row.loading.messageId}`
          : row.id

const mb = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(1).replace('.', ',')

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
    participants,
    readSets,
    onMarkRead,
    images,
    branchesByMessage,
    onOpenLink,
    onReply,
    onOpenBranch,
    focusMessageId,
    delivery = NO_DELIVERY
}: Props): React.JSX.Element {
    const scroller = useRef<HTMLDivElement>(null)
    const atBottom = useRef(true)
    const previousCount = useRef(0)
    const [selection, setSelection] = useState<MessageSelection | null>(null)
    const [flashId, setFlashId] = useState<string | null>(null)

    const rowCount = useRef(rows.length)
    rowCount.current = rows.length

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

    // A picture changes the height of its message when it finishes loading; stay at the bottom if we were there.
    const imageContext: ImageContext = {
        ...images,
        onLoad: () => {
            if (atBottom.current && rowCount.current > 0)
                virtualizer.scrollToIndex(rowCount.current - 1, { align: 'end' })
        }
    }

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
        // Keep the button while the list moves (a picture finished loading, rows were measured): only the position
        // follows. Collapsing the selection hides the button through the selectionchange listener below.
        if (selection) setSelection((current) => readMessageSelection(el) ?? current)
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
                    if (row.kind === 'loading') {
                        const l = row.loading
                        const loadingImages = new Map(
                            l.images
                                .filter((i) => i.partsReceived < i.partsTotal)
                                .map((i) => [
                                    i.assetId,
                                    { received: i.partsReceived, total: i.partsTotal }
                                ])
                        )
                        return (
                            <div key={item.key} {...common} className="row loading-row">
                                <article
                                    className="message loading"
                                    data-testid="loading-message"
                                    // not data-message-id: a loading message offers no "Reply to this" (D-37)
                                    data-loading-id={l.messageId}
                                    aria-busy="true"
                                    title={ru.loadingMessage.hint}
                                >
                                    <header>
                                        <strong>{l.authorDisplayName}</strong>
                                        <time dateTime={l.createdAt}>
                                            {formatTimestamp(l.createdAt)}
                                        </time>
                                    </header>
                                    <div className="loading-progress">
                                        <progress
                                            data-testid="loading-progress"
                                            max={Math.max(1, l.bytesTotal)}
                                            value={l.bytesReceived}
                                        />
                                        <span data-testid="loading-text">
                                            {ru.loadingMessage.progress(
                                                l.partsReceived,
                                                l.partsTotal,
                                                mb(l.bytesReceived),
                                                mb(l.bytesTotal)
                                            )}
                                        </span>
                                    </div>
                                    {l.content ? (
                                        <RichTextView
                                            doc={l.content}
                                            onOpenLink={onOpenLink}
                                            highlight={null}
                                            images={{ ...imageContext, loading: loadingImages }}
                                        />
                                    ) : (
                                        <div
                                            className="loading-text-placeholder"
                                            aria-label={ru.loadingMessage.noText}
                                        />
                                    )}
                                </article>
                            </div>
                        )
                    }
                    const m = row.message
                    const own = m.authorId === localParticipantId
                    const unread = isUnreadIn(readSets, localParticipantId, m)
                    const classes = [
                        'row',
                        own ? 'own' : '',
                        row.inherited ? 'inherited' : '',
                        flashId === m.messageId ? 'flash' : ''
                    ]
                    return (
                        <div
                            key={item.key}
                            {...common}
                            className={classes.filter(Boolean).join(' ')}
                        >
                            <article
                                className="message"
                                data-testid={row.inherited ? 'inherited-message' : 'message'}
                                data-message-id={m.messageId}
                                data-unread={unread ? 'true' : 'false'}
                            >
                                <header>
                                    <strong>{m.authorDisplayName}</strong>
                                    <time dateTime={m.createdAt}>
                                        {formatTimestamp(m.createdAt)}
                                    </time>
                                    {unread && (
                                        <span className="unread-label" data-testid="unread-label">
                                            {ru.unread.label}
                                        </span>
                                    )}
                                    <span className="header-tools">
                                        {unread && (
                                            <button
                                                type="button"
                                                className="mark-read"
                                                data-testid="mark-read"
                                                onClick={() => onMarkRead(m.messageId)}
                                            >
                                                {ru.unread.markRead}
                                            </button>
                                        )}
                                        {own && delivery[m.messageId] ? (
                                            // D-40: one mark for delivery and reading of own messages
                                            <DeliveryMark
                                                delivery={delivery[m.messageId]!}
                                                status={readStatusOf(participants, readSets, m)}
                                                readers={readersOf(readSets, m.messageId)}
                                            />
                                        ) : (
                                            <ReadIndicator
                                                status={readStatusOf(participants, readSets, m)}
                                            />
                                        )}
                                        <BranchBadge
                                            branches={branchesByMessage.get(m.messageId) ?? []}
                                            onOpen={onOpenBranch}
                                        />
                                    </span>
                                </header>
                                <RichTextView
                                    doc={m.content}
                                    onOpenLink={onOpenLink}
                                    highlight={row.highlight}
                                    images={imageContext}
                                />
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
