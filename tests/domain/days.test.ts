import { describe, expect, it } from 'vitest'
import { daySeparators, firstMessageOfEachDay, localDayKey, previousDayKey } from '@shared/domain'
import { formatDayLabel, formatMonth } from '../../src/renderer/i18n/format'

describe('days of messages (FR-241, FR-242)', () => {
    it('uses the local day of the time zone, also around midnight', () => {
        // 21:30 UTC is 23:30 in Riga in winter, 00:30 the next day in summer (UTC+3)
        expect(localDayKey('2026-11-14T21:30:00Z', 'Europe/Riga')).toBe('2026-11-14')
        expect(localDayKey('2026-07-14T21:30:00Z', 'Europe/Riga')).toBe('2026-07-15')
        expect(localDayKey('2026-11-14T21:30:00Z', 'UTC')).toBe('2026-11-14')
    })

    it('handles the change to summer time (the day has 23 hours)', () => {
        // 29 March 2026: Riga changes from UTC+2 to UTC+3 at 01:00 UTC
        expect(localDayKey('2026-03-28T21:59:00Z', 'Europe/Riga')).toBe('2026-03-28')
        expect(localDayKey('2026-03-28T22:00:00Z', 'Europe/Riga')).toBe('2026-03-29')
        expect(localDayKey('2026-03-29T20:59:00Z', 'Europe/Riga')).toBe('2026-03-29')
        expect(localDayKey('2026-03-29T21:00:00Z', 'Europe/Riga')).toBe('2026-03-30')
    })

    it('finds the day before across months and years', () => {
        expect(previousDayKey('2026-03-01')).toBe('2026-02-28')
        expect(previousDayKey('2028-03-01')).toBe('2028-02-29')
        expect(previousDayKey('2027-01-01')).toBe('2026-12-31')
    })

    it('a separator only before a later day; an older message (clock order) stays under the current one', () => {
        const items = [
            { t: '2026-11-12T10:00:00Z' },
            { t: '2026-11-12T11:00:00Z' },
            { t: null },
            { t: '2026-11-14T09:00:00Z' },
            { t: '2026-11-13T23:00:00Z' }, // another computer with a late clock
            { t: '2026-11-14T10:00:00Z' },
            { t: '2026-11-15T08:00:00Z' }
        ]
        expect(daySeparators(items, (i) => i.t, 'UTC')).toEqual([
            { index: 0, day: '2026-11-12' },
            { index: 3, day: '2026-11-14' },
            { index: 6, day: '2026-11-15' }
        ])
    })

    it('the first message of each day, in list order', () => {
        const items = [
            { id: 'a', t: '2026-11-12T10:00:00Z' },
            { id: 'b', t: '2026-11-12T11:00:00Z' },
            { id: 'c', t: '2026-11-14T09:00:00Z' }
        ]
        const days = firstMessageOfEachDay(items, (i) => i.t, 'UTC')
        expect([...days.keys()]).toEqual(['2026-11-12', '2026-11-14'])
        expect(days.get('2026-11-12')?.id).toBe('a')
    })

    it('labels: Сегодня, Вчера, the date, and the year only for another year', () => {
        expect(formatDayLabel('2026-11-15', '2026-11-15', '2026-11-14')).toBe('Сегодня')
        expect(formatDayLabel('2026-11-14', '2026-11-15', '2026-11-14')).toBe('Вчера')
        expect(formatDayLabel('2026-11-02', '2026-11-15', '2026-11-14')).toBe('2 ноября')
        expect(formatDayLabel('2025-12-31', '2026-11-15', '2026-11-14')).toBe('31 декабря 2025 г.')
        expect(formatMonth(2026, 11)).toBe('Ноябрь 2026')
    })
})
