import { describe, expect, it } from 'vitest'
import { extractDiscussionPaths } from '../../src/main/windows/launchArgs'
import { formatTimestamp } from '../../src/renderer/i18n/format'

describe('extractDiscussionPaths', () => {
  it('finds .branchchat paths, ignores flags and other files', () => {
    expect(
      extractDiscussionPaths([
        '--inspect',
        'C:\\Users\\Аня\\Документы\\идея.branchchat',
        'notes.txt',
        '--flag=x.branchchat'
      ])
    ).toEqual(['C:\\Users\\Аня\\Документы\\идея.branchchat'])
  })
  it('handles quotes, case, duplicates and empty input', () => {
    expect(extractDiscussionPaths(['"D:\\a b\\X.BRANCHCHAT"', 'D:\\a b\\X.BRANCHCHAT'])).toEqual([
      'D:\\a b\\X.BRANCHCHAT'
    ])
    expect(extractDiscussionPaths([])).toEqual([])
  })
})

describe('formatTimestamp', () => {
  it('shows UTC timestamps in the requested time zone, Russian format', () => {
    expect(formatTimestamp('2026-11-02T10:15:00.000Z', 'Europe/Riga')).toBe('02.11.2026, 12:15')
    expect(formatTimestamp('2026-11-02T10:15:00.000Z', 'UTC')).toBe('02.11.2026, 10:15')
  })
})
