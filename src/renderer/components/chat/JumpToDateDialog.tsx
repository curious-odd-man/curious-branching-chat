import { useMemo, useState } from 'react'
import { ru } from '@shared/i18n/ru'
import { formatDayLabel, formatMonth } from '../../i18n/format'
import { Modal } from '../Modal'

interface Props {
    /** Days with messages of the current branch (`YYYY-MM-DD`, local time). */
    days: ReadonlySet<string>
    today: string
    onPick(day: string): void
    onClose(): void
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** FR-242: a month calendar; only days with messages can be chosen. Opens at the month of the newest message. */
export function JumpToDateDialog({ days, today, onPick, onClose }: Props): React.JSX.Element {
    const sorted = useMemo(() => [...days].sort(), [days])
    const start = sorted[sorted.length - 1] ?? today
    const [year, setYear] = useState(Number(start.slice(0, 4)))
    const [month, setMonth] = useState(Number(start.slice(5, 7)))

    const move = (delta: number): void => {
        const index = year * 12 + (month - 1) + delta
        setYear(Math.floor(index / 12))
        setMonth((index % 12) + 1)
    }
    const prefix = `${year}-${pad(month)}`
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    const canBack = first !== undefined && first.slice(0, 7) < prefix
    const canForward = last !== undefined && last.slice(0, 7) > prefix

    // Monday first; empty cells before day 1
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const lead = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7
    const cells: Array<string | null> = [
        ...Array.from({ length: lead }, () => null),
        ...Array.from({ length: daysInMonth }, (_, i) => `${prefix}-${pad(i + 1)}`)
    ]
    const yesterday = useMemo(() => {
        const [y, m, d] = today.split('-').map(Number) as [number, number, number]
        return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)
    }, [today])

    return (
        <Modal labelledBy="jump-title" onEscape={onClose}>
            <div className="dialog jump-to-date" data-testid="jump-dialog">
                <h2 id="jump-title">{ru.days.jumpTitle}</h2>
                {days.size === 0 ? (
                    <p className="hint">{ru.days.noMessages}</p>
                ) : (
                    <>
                        <p className="hint">{ru.days.jumpHint}</p>
                        <div className="calendar-head">
                            <button
                                type="button"
                                data-testid="jump-previous"
                                aria-label={ru.days.previousMonth}
                                disabled={!canBack}
                                onClick={() => move(-1)}
                            >
                                ‹
                            </button>
                            <strong data-testid="jump-month">{formatMonth(year, month)}</strong>
                            <button
                                type="button"
                                data-testid="jump-next"
                                aria-label={ru.days.nextMonth}
                                disabled={!canForward}
                                onClick={() => move(1)}
                            >
                                ›
                            </button>
                        </div>
                        <div className="calendar" role="grid">
                            {ru.days.weekdays.map((w) => (
                                <span key={w} className="weekday" role="columnheader">
                                    {w}
                                </span>
                            ))}
                            {cells.map((day, i) =>
                                day ? (
                                    <button
                                        key={day}
                                        type="button"
                                        role="gridcell"
                                        className={`day${days.has(day) ? ' has-messages' : ''}${day === today ? ' today' : ''}`}
                                        data-testid="jump-day"
                                        data-day={day}
                                        disabled={!days.has(day)}
                                        aria-label={formatDayLabel(day, today, yesterday)}
                                        onClick={() => onPick(day)}
                                    >
                                        {Number(day.slice(8))}
                                    </button>
                                ) : (
                                    <span key={`empty-${i}`} />
                                )
                            )}
                        </div>
                    </>
                )}
                <div className="buttons">
                    {/* focus inside the dialog at once, so Escape and Tab work */}
                    <button type="button" autoFocus onClick={onClose}>
                        {ru.days.close}
                    </button>
                </div>
            </div>
        </Modal>
    )
}
