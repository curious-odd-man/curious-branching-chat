import { useVirtualizer } from '@tanstack/react-virtual'
import { matchRanges } from '@shared/domain'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { isUnreadIn, messageMarkOf, type MarkSync } from '@shared/domain'
import type { Message, Participant, Thread } from '@shared/types'
import type { LoadingMessage } from '@shared/sync'
import { texts } from '@shared/i18n'
import { formatTimestamp } from '../../i18n/format'
import { BranchBadge } from '../branches/BranchBadge'
import { RichTextView, type Highlight, type ImageContext } from '../rich/RichTextView'
import { MessageMark } from './MessageMark'
import { AttachmentList, ReactionBar, type MessageExtrasContext } from './MessageExtras'
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
    /** FR-241: the first message of a later day follows. */
    | { kind: 'day'; id: string; day: string; label: string }
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
    /** Delivery data of a synchronized discussion (D-41, FR-169); null for a normal discussion. */
    sync?: MarkSync | null
    /** FR-224: the position of this list is kept under this key while the list is not shown. */
    positionKey?: string
    /** FR-224: open at the kept position (the discussion is shown again) instead of the newest message. */
    restorePosition?: boolean
    /** FR-213: the search words to highlight in the shown messages. */
    highlightWords?: readonly string[]
    /** Reactions and files under the messages. */
    extras?: MessageExtrasContext
}

const NO_WORDS: readonly string[] = []

/** Highlights the search words in the message texts under `root` (all highlights are cleared without words). */
function highlightIn(root: HTMLElement | null, words: readonly string[]): void {
    const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
    const HighlightCtor = (window as unknown as { Highlight?: new (...r: Range[]) => unknown })
        .Highlight
    if (!registry || !HighlightCtor) return
    if (!root || words.length === 0) {
        registry.delete('search')
        return
    }
    const ranges: Range[] = []
    for (const rich of root.querySelectorAll('[data-message-id] .rich')) {
        const walker = document.createTreeWalker(rich, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            for (const [start, end] of matchRanges(node.nodeValue ?? '', words)) {
                const range = document.createRange()
                range.setStart(node, start)
                range.setEnd(node, end)
                ranges.push(range)
            }
        }
    }
    registry.set('search', new HighlightCtor(...ranges))
}

/** FR-224: the first visible row of each list (by key), or "at the bottom". */
const positions = new Map<string, { rowKey: string | null; atBottom: boolean }>()

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
    sync = null,
    positionKey,
    restorePosition = false,
    highlightWords = NO_WORDS,
    extras
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
        const kept =
            first && restorePosition && positionKey ? positions.get(positionKey) : undefined
        if (kept && !kept.atBottom && kept.rowKey) {
            const index = rows.findIndex((r) => rowKey(r) === kept.rowKey)
            if (index >= 0) {
                const toIndex = (): void => virtualizer.scrollToIndex(index, { align: 'start' })
                toIndex()
                atBottom.current = false
                const frame = requestAnimationFrame(toIndex)
                return () => cancelAnimationFrame(frame)
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

    // FR-213: the search words are highlighted in the rendered messages (CSS Custom Highlight API, no DOM change)
    useEffect(() => {
        const root = scroller.current
        if (!root) return
        let frame = 0
        const apply = (): void => {
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(() => highlightIn(root, highlightWords))
        }
        apply()
        const observer = new MutationObserver(apply)
        observer.observe(root, { childList: true, subtree: true, characterData: true })
        return () => {
            observer.disconnect()
            cancelAnimationFrame(frame)
        }
    }, [highlightWords])
    useEffect(() => () => highlightIn(null, NO_WORDS), [])

    const onScroll = (): void => {
        const el = scroller.current
        if (!el) return
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD
        if (positionKey) {
            const top = virtualizer.getVirtualItems().find((v) => v.end > el.scrollTop)
            const row = top ? rows[top.index] : undefined
            positions.set(positionKey, {
                rowKey: row ? rowKey(row) : null,
                atBottom: atBottom.current
            })
        }
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
            {rows.length === 0 && <p className="empty">{texts().discussion.empty}</p>}
            <div className="rows" style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map((item) => {
                    const row = rows[item.index]
                    if (!row) return null
                    const common = {
                        ref: virtualizer.measureElement,
                        'data-index': item.index,
                        style: { transform: `translateY(${item.start}px)` }
                    }
                    if (row.kind === 'day')
                        return (
                            <div key={item.key} {...common} className="row day-row">
                                <div
                                    className="day-separator"
                                    data-testid="day-separator"
                                    data-day={row.day}
                                    role="separator"
                                >
                                    <span>{row.label}</span>
                                </div>
                            </div>
                        )
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
                                    title={texts().loadingMessage.hint}
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
                                            {texts().loadingMessage.progress(
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
                                            aria-label={texts().loadingMessage.noText}
                                        />
                                    )}
                                </article>
                            </div>
                        )
                    }
                    const m = row.message
                    const own = m.authorId === localParticipantId
                    const unread = isUnreadIn(readSets, localParticipantId, m)
                    const mark = messageMarkOf(m, participants, readSets, sync)
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
                                            {texts().unread.label}
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
                                                {texts().unread.markRead}
                                            </button>
                                        )}
                                        {mark && <MessageMark mark={mark} synced={sync !== null} />}
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
                                {extras && <AttachmentList message={m} ctx={extras} />}
                                {extras && <ReactionBar message={m} ctx={extras} />}
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
                    title={texts().branches.replyHint}
                    style={buttonStyle}
                    // keep the selection while the button is pressed
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={reply}
                >
                    {texts().branches.replyToThis}
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
