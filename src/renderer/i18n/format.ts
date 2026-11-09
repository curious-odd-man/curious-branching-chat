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
