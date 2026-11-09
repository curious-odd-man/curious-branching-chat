import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { plainTextToRichDoc } from '@shared/domain'
import { SettingsStore } from '../../src/main/local-state/settings'
import { pathKey } from '../../src/main/application/paths'
import { withTempDir } from '../helpers/fixtures'

describe('SettingsStore', () => {
  it('generates the participant ID once and remembers the name (FR-017, FR-020)', async () => {
    await withTempDir(async (dir) => {
      let n = 0
      const a = new SettingsStore(dir, () => `id-${++n}`)
      await a.load()
      expect(a.get()).toEqual({
        participantId: 'id-1',
        displayName: null,
        readNoticeAcknowledged: false,
        associationAsked: false,
        autoUpdateCheck: true,
        recentFilesLimit: 10,
        openLastFileOnStartup: true
      })
      expect(await a.setDisplayName('  Анна  ')).toEqual({
        participantId: 'id-1',
        displayName: 'Анна',
        readNoticeAcknowledged: false,
        associationAsked: false,
        autoUpdateCheck: true,
        recentFilesLimit: 10,
        openLastFileOnStartup: true
      })

      const b = new SettingsStore(dir, () => `id-${++n}`) // e.g. next application start
      await b.load()
      expect(b.get()).toEqual({
        participantId: 'id-1',
        displayName: 'Анна',
        readNoticeAcknowledged: false,
        associationAsked: false,
        autoUpdateCheck: true,
        recentFilesLimit: 10,
        openLastFileOnStartup: true
      })
    })
  })

  it('rejects an empty name', async () => {
    await withTempDir(async (dir) => {
      const s = new SettingsStore(dir, () => 'x')
      await s.load()
      await expect(s.setDisplayName('   ')).rejects.toThrow()
    })
  })

  it('starts fresh, keeping a copy, when settings.json is unreadable', async () => {
    await withTempDir(async (dir) => {
      await fs.writeFile(join(dir, 'settings.json'), '{ not json')
      const s = new SettingsStore(dir, () => 'fresh')
      await s.load()
      expect(s.get().participantId).toBe('fresh')
      expect((await fs.readdir(dir)).some((f) => f.startsWith('settings.json.corrupt-'))).toBe(true)
    })
  })

  it('keeps unknown settings fields', async () => {
    await withTempDir(async (dir) => {
      await fs.writeFile(
        join(dir, 'settings.json'),
        JSON.stringify({ participantId: 'p', future: 7 })
      )
      const s = new SettingsStore(dir, () => 'x')
      await s.load()
      await s.setDisplayName('Борис')
      expect(JSON.parse(await fs.readFile(join(dir, 'settings.json'), 'utf8'))).toMatchObject({
        participantId: 'p',
        future: 7,
        displayName: 'Борис'
      })
    })
  })
})

describe('SettingsStore read notice (FR-125)', () => {
  it('is remembered once acknowledged', async () => {
    await withTempDir(async (dir) => {
      const a = new SettingsStore(dir, () => 'p')
      await a.load()
      expect(a.get().readNoticeAcknowledged).toBe(false)
      expect((await a.acknowledgeReadNotice()).readNoticeAcknowledged).toBe(true)
      const b = new SettingsStore(dir, () => 'other')
      await b.load()
      expect(b.get().readNoticeAcknowledged).toBe(true)
    })
  })
})

describe('pathKey', () => {
  it('treats Windows paths case-insensitively and normalizes separators', () => {
    expect(pathKey('C:\\Users\\Аня\\Идея.branchchat', 'win32')).toBe(
      pathKey('c:/users/аня/идея.BRANCHCHAT', 'win32')
    )
    expect(pathKey('C:\\a\\..\\b\\x.branchchat', 'win32')).toBe('c:\\b\\x.branchchat')
  })
  it('is case-sensitive elsewhere', () => {
    expect(pathKey('/a/X', 'linux')).not.toBe(pathKey('/a/x', 'linux'))
  })
})

describe('plainTextToRichDoc', () => {
  it('makes one paragraph per line and keeps blank lines', () => {
    expect(plainTextToRichDoc('Привет\r\n\r\nмир\n\n')).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Привет' }] },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: 'мир' }] }
      ]
    })
  })

  it('remembers that the file association question was asked', async () => {
    await withTempDir(async (dir) => {
      const a = new SettingsStore(dir, () => 'id-1')
      await a.load()
      expect(a.get().associationAsked).toBe(false)
      expect((await a.markAssociationAsked()).associationAsked).toBe(true)
      const b = new SettingsStore(dir, () => 'id-2')
      await b.load()
      expect(b.get().associationAsked).toBe(true)
    })
  })
})
