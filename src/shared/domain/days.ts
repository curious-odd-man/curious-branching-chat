/**
 * FR-241, FR-242: days of messages in local time. Messages are ordered by their clock, not by time (a synchronized
 * discussion can show a message of yesterday after one of today, when the clocks of two computers differ). So a
 * separator is added only when a day is later than all days before it; a message of an earlier day stays under the
 * current separator.
 */

const formatters = new Map<string, Intl.DateTimeFormat>()
const pad = (n: number): string => String(n).padStart(2, '0')

/**
 * The local day of a UTC timestamp, as `YYYY-MM-DD`. Called for every message on each change, so it must be cheap:
 * the system time zone uses the `Date` fields; another time zone uses one cached formatter.
 */
export function localDayKey(isoUtc: string, timeZone?: string): string {
    const date = new Date(isoUtc)
    if (!timeZone) return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    let format = formatters.get(timeZone)
    if (!format) {
        format = new Intl.DateTimeFormat('en-CA', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            timeZone
        })
        formatters.set(timeZone, format)
    }
    const parts = format.formatToParts(date)
    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? ''
    return `${get('year')}-${get('month')}-${get('day')}`
}

/** The day before a `YYYY-MM-DD` key (calendar arithmetic, no time zone involved). */
export function previousDayKey(day: string): string {
    const [y, m, d] = day.split('-').map(Number) as [number, number, number]
    const date = new Date(Date.UTC(y, m - 1, d - 1))
    return date.toISOString().slice(0, 10)
}

/**
 * Where separators go: for each item index that starts a new (later) day, that day. Items without a time (`null`)
 * never start a day.
 */
export function daySeparators<T>(
    items: readonly T[],
    timeOf: (item: T) => string | null,
    timeZone?: string
): Array<{ index: number; day: string }> {
    const out: Array<{ index: number; day: string }> = []
    let latest = ''
    items.forEach((item, index) => {
        const time = timeOf(item)
        if (!time) return
        const day = localDayKey(time, timeZone)
        if (day > latest) {
            out.push({ index, day })
            latest = day
        }
    })
    return out
}

/** For "Перейти к дате…": each day with messages, and the first message of that day (in list order). */
export function firstMessageOfEachDay<T>(
    items: readonly T[],
    timeOf: (item: T) => string,
    timeZone?: string
): Map<string, T> {
    const out = new Map<string, T>()
    for (const item of items) {
        const day = localDayKey(timeOf(item), timeZone)
        if (!out.has(day)) out.set(day, item)
    }
    return out
}
