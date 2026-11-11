import { useEffect, useRef, useState } from 'react'
import type { MessageMark as Mark, MessageMarkState } from '@shared/domain'
import { ru } from '@shared/i18n/ru'

interface Props {
    mark: Mark
    /** A synchronized discussion shows delivery per member; a normal one shows who has read and who has not. */
    synced: boolean
}

const GLYPH: Record<MessageMarkState, string> = {
    pending: '🕓',
    written: '✓',
    delivered: '✓✓',
    'read-some': '✓',
    'read-all': '✓✓'
}

const names = (people: string[]): string =>
    people.length > 0 ? people.join(', ') : ru.readStatus.nobody

/**
 * One mark for every message (D-41, FR-122, FR-169). A clock: not written yet (own messages); one grey check:
 * written to the shared folder; two grey checks: delivered to all; one green check: read by at least one; two
 * green checks: read by all. The author is not counted. Click opens the state of each member.
 */
export function MessageMark({ mark, synced }: Props): React.JSX.Element {
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

    const { state, members } = mark
    const label = ru.delivery[state]
    const readers = members.filter((m) => m.state === 'read').map((m) => m.participant.displayName)
    const notReaders = members
        .filter((m) => m.state !== 'read')
        .map((m) => m.participant.displayName)
    const title = synced
        ? `${label}. ${ru.delivery.hint[state]}`
        : `${label}. ${ru.readStatus.readBy}: ${names(readers)}. ${ru.readStatus.notReadBy}: ${names(notReaders)}.`

    return (
        <span className="read-indicator-wrap" ref={root}>
            <button
                type="button"
                className={`message-mark ${state}`}
                data-testid="message-mark"
                data-state={state}
                title={title}
                aria-label={`${ru.delivery.ariaLabel}: ${label}`}
                aria-expanded={open}
                onClick={() => setOpen(!open)}
            >
                {GLYPH[state]}
            </button>
            {open && (
                <span className="read-popover" role="dialog" data-testid="mark-popover">
                    {synced ? (
                        members.map((m) => (
                            <span
                                key={m.participant.participantId}
                                className="mark-member"
                                data-testid="mark-member"
                                data-state={m.state}
                            >
                                <strong>{m.participant.displayName}</strong>
                                <span>{ru.delivery.member[m.state]}</span>
                            </span>
                        ))
                    ) : (
                        <>
                            <strong>{ru.readStatus.readBy}</strong>
                            <span data-testid="read-by">{names(readers)}</span>
                            <strong>{ru.readStatus.notReadBy}</strong>
                            <span data-testid="not-read-by">{names(notReaders)}</span>
                        </>
                    )}
                </span>
            )}
        </span>
    )
}
