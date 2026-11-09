import { describe, expect, it } from 'vitest'
import { releaseNotesToText } from '../../src/shared/domain'
import { parseFeedRepo, releasePageUrl } from '../../src/main/updates/feedRepo'
import { formatBytes } from '../../src/renderer/i18n/format'

describe('releaseNotesToText', () => {
  it('turns GitHub HTML into plain text and never keeps markup', () => {
    expect(
      releaseNotesToText(
        '<h2>Что нового</h2>\n<ul>\n<li>Обновления</li>\n<li>A &lt;b&gt; &amp; &#1081;</li></ul><p>Конец<br>строка</p>'
      )
    ).toBe('Что нового\n\n• Обновления\n• A <b> & й\n\nКонец\nстрока')
  })
  it('drops script and style content and unknown tags', () => {
    expect(
      releaseNotesToText('a<script>alert(1)</script>b<style>x{}</style><img src=x onerror=y>c')
    ).toBe('abc')
  })
  it('keeps plain and markdown text, handles lists of notes, and returns null for nothing', () => {
    expect(releaseNotesToText('- one\n- two')).toBe('- one\n- two')
    expect(
      releaseNotesToText([
        { version: '0.2.0', note: 'x' },
        { version: '0.1.5', note: null }
      ])
    ).toBe('0.2.0\nx')
    expect(releaseNotesToText(null)).toBeNull()
    expect(releaseNotesToText('  <p> </p> ')).toBeNull()
    expect(releaseNotesToText([])).toBeNull()
  })
  it('leaves unknown or invalid entities alone', () => {
    expect(releaseNotesToText('&bogus; &#99999999999;')).toBe('&bogus; &#99999999999;')
  })
})

describe('parseFeedRepo and releasePageUrl', () => {
  it('reads owner and repo from the generated app-update.yml', () => {
    const yaml =
      'owner: someone\nrepo: branchchat\nprovider: github\nupdaterCacheDirName: branchchat-updater\n'
    expect(parseFeedRepo(yaml)).toEqual({ owner: 'someone', repo: 'branchchat' })
    expect(releasePageUrl({ owner: 'someone', repo: 'branchchat' }, '1.2.3')).toBe(
      'https://github.com/someone/branchchat/releases/tag/v1.2.3'
    )
  })
  it('rejects other providers and unsafe values', () => {
    expect(parseFeedRepo('provider: generic\nurl: https://x\n')).toBeNull()
    expect(parseFeedRepo('provider: github\nowner: a/b\nrepo: c\n')).toBeNull()
    expect(parseFeedRepo('provider: github\nowner: a\n')).toBeNull()
    expect(parseFeedRepo('')).toBeNull()
  })
})

describe('formatBytes', () => {
  it('shows sizes in Russian units', () => {
    expect(formatBytes(512)).toBe('512 Б')
    expect(formatBytes(2048)).toBe('2 КБ')
    expect(formatBytes(90_000_000)).toMatch(/^85,8 МБ$/)
  })
})
