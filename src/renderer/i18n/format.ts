import { ru } from '@shared/i18n/ru'

/** Timestamps are stored in UTC and shown in the local time zone (FR-081). */
export function formatTimestamp(isoUtc: string, timeZone?: string): string {
    return new Intl.DateTimeFormat('ru-RU', {
        dateStyle: 'short',
        timeStyle: 'short',
        ...(timeZone ? { timeZone } : {})
    }).format(new Date(isoUtc))
}

/** A release date, shown in the local time zone. */
export function formatDate(isoUtc: string, timeZone?: string): string {
    return new Intl.DateTimeFormat('ru-RU', {
        dateStyle: 'long',
        ...(timeZone ? { timeZone } : {})
    }).format(new Date(isoUtc))
}

/** A download size such as "85,4 МБ". */
export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} Б`
    const units = ['КБ', 'МБ', 'ГБ']
    let value = bytes / 1024
    let unit = 0
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024
        unit++
    }
    return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value)} ${units[unit]}`
}

/**
 * FR-241: the label of a day separator: "Сегодня", "Вчера", or the date (without the year in the current year).
 * `day` and `today` are local `YYYY-MM-DD` keys.
 */
export function formatDayLabel(day: string, today: string, yesterday: string): string {
    if (day === today) return ru.days.today
    if (day === yesterday) return ru.days.yesterday
    const [y, m, d] = day.split('-').map(Number) as [number, number, number]
    const date = new Date(Date.UTC(y, m - 1, d, 12))
    return new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'long',
        ...(day.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }),
        timeZone: 'UTC'
    }).format(date)
}

/** The month title of the calendar, for example "Ноябрь 2026". */
export function formatMonth(year: number, month: number): string {
    const text = new Intl.DateTimeFormat('ru-RU', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC'
    }).format(new Date(Date.UTC(year, month - 1, 1, 12)))
    return text.charAt(0).toUpperCase() + text.slice(1).replace(' г.', '')
}
