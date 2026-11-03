import { useEffect, useRef } from 'react'
import { richTextToPlain } from '@shared/validation'
import type { Message } from '@shared/types'
import { ru } from '@shared/i18n/ru'
import { formatTimestamp } from '../../i18n/format'

interface Props {
  messages: Message[]
  localParticipantId: string
}

/** Phase 2: plain-text rendering. Rich text, unread highlighting and branches arrive in later phases. */
export function MessageList({ messages, localParticipantId }: Props): React.JSX.Element {
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' })
  }, [messages.length])

  return (
    <div className="messages" data-testid="messages">
      {messages.length === 0 && <p className="empty">{ru.discussion.empty}</p>}
      {messages.map((m) => (
        <article
          key={m.messageId}
          className={m.authorId === localParticipantId ? 'message own' : 'message'}
          data-testid="message"
        >
          <header>
            <strong>{m.authorDisplayName}</strong>
            <time dateTime={m.createdAt}>{formatTimestamp(m.createdAt)}</time>
          </header>
          <p>{richTextToPlain(m.content)}</p>
        </article>
      ))}
      <div ref={end} />
    </div>
  )
}
