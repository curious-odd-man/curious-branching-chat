import { expect, test, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { cleanup, launchApp, tempDir, type TestApp } from './helpers/app'
import { readDiscussionFile, plainTextOf } from './helpers/readFile'
import { selectText } from './helpers/select'
import { doc, p, simple, t, writeDiscussionFile } from './helpers/craft'

// Russian text (phase 9, NFR-001/NFR-003): Cyrillic, ё/Ё and emoji survive typing, saving, reopening and branching.

const apps: TestApp[] = []
const dirs: string[] = []
test.afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()))
  await cleanup(...dirs.splice(0))
})

async function profile(): Promise<string> {
  const dir = await tempDir('bc-text-profile-')
  dirs.push(dir)
  await fs.writeFile(
    join(dir, 'settings.json'),
    JSON.stringify({
      participantId: 'p-test',
      displayName: 'Ёжик',
      readNoticeAcknowledged: true,
      associationAsked: true
    })
  )
  return dir
}
async function open(file: string): Promise<Page> {
  const app = await launchApp({ files: [file], userData: await profile() })
  apps.push(app)
  const win = await app.app.firstWindow()
  await expect(win.getByTestId('composer')).toBeVisible()
  return win
}

const SAMPLE = 'Ёлка, ёжик, Ёлочка: съешь ещё этих мягких французских булок 😀 и выпей чаю 👍🏽!'

test('Cyrillic, ё/Ё and emoji are saved in the file and read back after reopening', async () => {
  const dir = await tempDir('bc-text-')
  dirs.push(dir)
  const file = join(dir, 'Ёлка — обсуждение 😀.branchchat')
  await writeDiscussionFile(file, [
    { id: 'main', messages: [{ id: 'm1', author: 'boris', content: simple('Начало') }] }
  ])

  let win = await open(file)
  await win.getByTestId('composer').click()
  await win.keyboard.insertText(SAMPLE)
  await win.keyboard.press('Control+Enter')
  await expect(win.getByTestId('message').filter({ hasText: 'французских' })).toHaveCount(1)
  await expect
    .poll(async () => (await readDiscussionFile(file)).discussion.threads[0]!.messages.length)
    .toBe(2)

  const saved = (await readDiscussionFile(file)).discussion.threads[0]!.messages[1]!
  expect(plainTextOf(saved.content)).toBe(SAMPLE)

  await apps.pop()!.close()
  win = await open(file)
  await expect(win.getByTestId('message').filter({ hasText: SAMPLE })).toHaveCount(1)
})

test('a branch quoted after an emoji keeps correct offsets (surrogate pairs)', async () => {
  const dir = await tempDir('bc-text-')
  dirs.push(dir)
  const file = join(dir, 'эмодзи.branchchat')
  const text = '😀😀 привет ёжик 👍🏽 мир'
  await writeDiscussionFile(file, [
    { id: 'main', messages: [{ id: 'm1', author: 'boris', content: doc(p(t(text))) }] }
  ])
  const win = await open(file)
  const message = win.getByTestId('message').first()
  await selectText(message, 'ёжик')
  await win.getByTestId('reply-to-this').click()
  await expect(win.getByTestId('branch-header')).toBeVisible()

  await expect.poll(async () => (await readDiscussionFile(file)).discussion.threads.length).toBe(2)
  const branch = (await readDiscussionFile(file)).discussion.threads[1]!
  expect(branch.quoteText).toBe('ёжик')
  // the stored offsets point at the same characters of the original message (UTF-16 code units)
  expect(text.slice(branch.selectionStart!, branch.selectionEnd!)).toBe('ёжик')

  // reopen: the quote is still shown in the branch header
  await apps.pop()!.close()
  const again = await open(file)
  await again.getByTestId('panel-branch').first().click()
  await expect(again.getByTestId('branch-header')).toContainText('ёжик')
})
