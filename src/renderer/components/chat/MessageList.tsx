import { useVirtualizer } from '@tanstack/react-virtual'
import { useLayoutEffect, useRef } from 'react'
import type { Message } from '@shared/types'
import { ru } from '@shared/i18n/ru'
import { formatTimestamp } from '../../i18n/format'
import { RichTextView } from '../rich/RichTextView'

interface Props {
  messages: Message[]
  localParticipantId: string
  onOpenLink(href: string): void
}

/** The user counts as "at the bottom" when closer than this to the end (pixels). */
const STICK_THRESHOLD = 80

/**
 * Virtualized message list (NFR-004): only the messages near the viewport are in the page, so a discussion of
 * thousands of messages stays responsive.
 *
 * Scrolling: the list opens at the newest message. New messages scroll into view only if the person was already at
 * the bottom, or wrote the message themselves; someone reading older messages is never pulled away.
 */
export function MessageList({
  messages,
  localParticipantId,
  onOpenLink
}: Props): React.JSX.Element {
  const scroller = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const previousCount = useRef(0)

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 96,
    overscan: 8,
    getItemKey: (index) => messages[index]?.messageId ?? index
  })

  useLayoutEffect(() => {
    const count = messages.length
    const grew = count > previousCount.current
    const first = previousCount.current === 0
    const ownLast = messages[count - 1]?.authorId === localParticipantId
    previousCount.current = count
    if (count === 0 || !(first || (grew && (atBottom.current || ownLast)))) return

    const toEnd = (): void => virtualizer.scrollToIndex(count - 1, { align: 'end' })
    toEnd()
    atBottom.current = true
    // Only the message count matters here (not the other props), so the dependency list below is deliberate.
    // Row heights are measured after the first paint; settle once more at the true bottom.
    const frame = requestAnimationFrame(toEnd)
    return () => cancelAnimationFrame(frame)
  }, [messages.length])

  const onScroll = (): void => {
    const el = scroller.current
    if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD
  }

  return (
    <div className="messages" data-testid="messages" ref={scroller} onScroll={onScroll}>
      {messages.length === 0 && <p className="empty">{ru.discussion.empty}</p>}
      <div className="rows" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const m = messages[item.index]
          if (!m) return null
          const own = m.authorId === localParticipantId
          return (
            <div
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              className={own ? 'row own' : 'row'}
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <article className="message" data-testid="message">
                <header>
                  <strong>{m.authorDisplayName}</strong>
                  <time dateTime={m.createdAt}>{formatTimestamp(m.createdAt)}</time>
                </header>
                <RichTextView doc={m.content} onOpenLink={onOpenLink} />
              </article>
            </div>
          )
        })}
      </div>
    </div>
  )
}
