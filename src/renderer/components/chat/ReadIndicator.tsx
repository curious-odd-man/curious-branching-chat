import { useEffect, useRef, useState } from 'react'
import type { WhoHasRead } from '@shared/domain'
import { ru } from '@shared/i18n/ru'

interface Props {
  status: WhoHasRead
}

const names = (people: { displayName: string }[]): string =>
  people.length > 0 ? people.map((p) => p.displayName).join(', ') : ru.readStatus.nobody

/**
 * Who has read a message (FR-122 to FR-124): a compact mark on every message — one grey check if none of the other
 * known participants has read it, two grey checks if some have, two accent-colored checks if all have. The names are
 * in the tooltip and in a small list that opens on click. The author is not listed.
 */
export function ReadIndicator({ status }: Props): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (status.state === 'no-others') return null
  const notRead = status.others.filter((p) => !status.readers.includes(p))
  const summary = ru.readStatus[status.state]
  const tooltip = `${summary}. ${ru.readStatus.readBy}: ${names(status.readers)}. ${ru.readStatus.notReadBy}: ${names(notRead)}.`

  return (
    <span className="read-indicator-wrap" ref={root}>
      <button
        type="button"
        className={`read-indicator ${status.state}`}
        data-testid="read-indicator"
        data-state={status.state}
        title={tooltip}
        aria-label={`${ru.readStatus.ariaLabel}: ${summary}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {status.state === 'none' ? '✓' : '✓✓'}
      </button>
      {open && (
        <span className="read-popover" role="dialog" data-testid="read-popover">
          <strong>{ru.readStatus.readBy}</strong>
          <span data-testid="read-by">{names(status.readers)}</span>
          <strong>{ru.readStatus.notReadBy}</strong>
          <span data-testid="not-read-by">{names(notRead)}</span>
        </span>
      )}
    </span>
  )
}
