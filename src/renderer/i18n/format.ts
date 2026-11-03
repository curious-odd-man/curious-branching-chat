/** Timestamps are stored in UTC and shown in the local time zone (FR-081). */
export function formatTimestamp(isoUtc: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
    ...(timeZone ? { timeZone } : {})
  }).format(new Date(isoUtc))
}
