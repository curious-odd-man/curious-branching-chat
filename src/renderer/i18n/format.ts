import { locale, texts } from '@shared/i18n'

/** Timestamps are stored in UTC and shown in the local time zone (FR-081). */
export function formatTimestamp(isoUtc: string, timeZone?: string): string {
    return new Intl.DateTimeFormat(locale(), {
        dateStyle: 'short',
        timeStyle: 'short',
        ...(timeZone ? { timeZone } : {})
    }).format(new Date(isoUtc))
}

/** A release date, shown in the local time zone. */
export function formatDate(isoUtc: string, timeZone?: string): string {
    return new Intl.DateTimeFormat(locale(), {
        dateStyle: 'long',
        ...(timeZone ? { timeZone } : {})
    }).format(new Date(isoUtc))
}

/** A download size such as "85,4 МБ" (or "85.4 MB"). */
export function formatBytes(bytes: number): string {
    return texts().attachments.size(bytes)
}

/**
 * FR-241: the label of a day separator: "Сегодня", "Вчера", or the date (without the year in the current year).
 * `day` and `today` are local `YYYY-MM-DD` keys.
 */
export function formatDayLabel(day: string, today: string, yesterday: string): string {
    if (day === today) return texts().days.today
    if (day === yesterday) return texts().days.yesterday
    const [y, m, d] = day.split('-').map(Number) as [number, number, number]
    const date = new Date(Date.UTC(y, m - 1, d, 12))
    return new Intl.DateTimeFormat(locale(), {
        day: 'numeric',
        month: 'long',
        ...(day.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }),
        timeZone: 'UTC'
    }).format(date)
}

/** The month title of the calendar, for example "Ноябрь 2026". */
export function formatMonth(year: number, month: number): string {
    const text = new Intl.DateTimeFormat(locale(), {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC'
    }).format(new Date(Date.UTC(year, month - 1, 1, 12)))
    // Russian adds "г." after the year
    return text.charAt(0).toUpperCase() + text.slice(1).replace(' г.', '')
}
