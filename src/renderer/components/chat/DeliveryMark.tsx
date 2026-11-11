import { useEffect, useRef, useState } from 'react'
import type { WhoHasRead } from '@shared/domain'
import { ru } from '@shared/i18n/ru'
import type { DeliveryView } from '@shared/types/ipc'

interface Props {
    delivery: DeliveryView
    /** Who has read the message (FR-122): the read part of the combined mark. */
    status: WhoHasRead
    /** IDs of members who have read the message. */
    readers: ReadonlySet<string>
}

export type MessageMarkState = 'pending' | 'written' | 'delivered' | 'read-some' | 'read-all'

/**
 * One mark for an own message in a synchronized discussion (D-09, D-40, FR-169): delivery first, then reading.
 * One grey check: written to the shared folder; two grey checks: delivered to all; one green check: read by at least
 * one member; two green checks: read by all. A read state always wins over a delivery state.
 */
export function markState(delivery: DeliveryView, status: WhoHasRead): MessageMarkState {
    if (status.state === 'all') return 'read-all'
    if (status.state === 'some') return 'read-some'
    return delivery.state
}

const GLYPH: Record<MessageMarkState, string> = {
    pending: '🕓',
    written: '✓',
    delivered: '✓✓',
    'read-some': '✓',
    'read-all': '✓✓'
}

export function DeliveryMark({ delivery, status, readers }: Props): React.JSX.Element {
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

    const state = markState(delivery, status)
    const label = ru.delivery[state]
    return (
        <span className="read-indicator-wrap" ref={root}>
            <button
                type="button"
                className={`message-mark ${state}`}
                data-testid="delivery-mark"
                data-state={state}
                title={`${label}. ${ru.delivery.hint[state]}`}
                aria-label={`${ru.delivery.ariaLabel}: ${label}`}
                aria-expanded={open}
                onClick={() => setOpen(!open)}
            >
                {GLYPH[state]}
            </button>
            {open && (
                <span
                    className="read-popover delivery-popover"
                    role="dialog"
                    data-testid="delivery-popover"
                >
                    {delivery.members.map((m) => (
                        <span
                            key={m.participantId}
                            className="delivery-member"
                            data-testid="delivery-member"
                            data-state={readers.has(m.participantId) ? 'read' : m.state}
                        >
                            <strong>{m.displayName}</strong>
                            <span>
                                {readers.has(m.participantId)
                                    ? ru.delivery.member.read
                                    : ru.delivery.member[m.state]}
                            </span>
                        </span>
                    ))}
                </span>
            )}
        </span>
    )
}
