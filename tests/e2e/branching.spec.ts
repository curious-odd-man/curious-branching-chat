import { expect, test, type Locator, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { cleanup, launchApp, tempDir, type TestApp } from './helpers/app'
import {
  bold,
  doc,
  h,
  italic,
  li,
  link,
  p,
  simple,
  t,
  ul,
  writeDiscussionFile,
  type CraftThread
} from './helpers/craft'
import { plainTextOf, readDiscussionFile, readReadState } from './helpers/readFile'
import { selectText } from './helpers/select'

const apps: TestApp[] = []
const dirs: string[] = []
test.afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()))
  await cleanup(...dirs.splice(0))
})

async function workDir(): Promise<string> {
  const d = await tempDir()
  dirs.push(d)
  return d
}

/** A profile that already has a participant name and has seen the read-status notice (FR-125). */
async function namedProfile(): Promise<string> {
  const dir = await tempDir('bc-profile-')
  dirs.push(dir)
  await fs.writeFile(
    join(dir, 'settings.json'),
    JSON.stringify({ participantId: 'p-local', displayName: 'Вера', readNoticeAcknowledged: true })
  )
  return dir
}

async function open(file: string, userData?: string): Promise<{ t: TestApp; win: Page }> {
  const profile = userData ?? (await namedProfile())
  const t = await launchApp({ userData: profile, files: [file] })
  apps.push(t)
  return { t, win: await t.app.firstWindow() }
}

const plainMessages = (): CraftThread => ({
  id: 'main',
  messages: [
    { id: 'm1', author: 'boris', content: simple('Первое сообщение.') },
    { id: 'm2', author: 'boris', content: simple('Второе сообщение, после которого будут ветки.') },
    { id: 'm3', author: 'anna', content: simple('Третье сообщение — позже веток.') }
  ]
})

/** Offsets of `word` in a plain one-paragraph message, for crafting branches. */
const where = (text: string, word: string): { start: number; end: number; quote: string } => {
  const start = text.indexOf(word)
  return { start, end: start + word.length, quote: word }
}
const M2 = 'Второе сообщение, после которого будут ветки.'

const msg = (win: Page, text: string): Locator =>
  win.getByTestId('message').filter({ hasText: text })
const inherited = (win: Page): Locator => win.getByTestId('inherited-message')
const reply = (win: Page): Locator => win.getByTestId('reply-to-this')
const composer = (win: Page): Locator => win.getByTestId('composer')

async function sendText(win: Page, text: string): Promise<void> {
  await composer(win).click()
  await win.keyboard.type(text)
  await win.keyboard.press('Control+Enter')
  await expect(win.getByTestId('message').filter({ hasText: text })).toHaveCount(1)
}

async function replyTo(win: Page, message: Locator, from: string, to = from): Promise<void> {
  const before = await win.getByTestId('thread').getAttribute('data-thread-id')
  await selectText(message, from, to)
  await expect(reply(win)).toBeVisible()
  await reply(win).click()
  // wait for the new branch itself: when replying from inside a branch, a branch header is already on screen
  await expect(win.getByTestId('thread')).not.toHaveAttribute('data-thread-id', before ?? '')
  await expect(win.getByTestId('branch-header')).toBeVisible()
}

async function inheritedTexts(win: Page): Promise<string[]> {
  return (await inherited(win).locator('.rich').allTextContents()).map((s) => s.trim())
}

const savedThreads = async (file: string) => (await readDiscussionFile(file)).discussion.threads

test('selections across bold, italic and link, list items, heading+paragraph and paragraphs become branches (FR-049 to FR-055)', async () => {
  const dir = await workDir()
  const file = join(dir, 'выделение.branchchat')
  await writeDiscussionFile(file, [
    {
      id: 'main',
      messages: [
        {
          id: 'm1',
          author: 'boris',
          content: doc(
            h(2, 'Заголовок плана'),
            p(
              t('Жирный', [bold]),
              t(' и '),
              t('курсивный', [italic]),
              t(' текст со '),
              t('ссылкой', [link('https://example.com')]),
              t(' в конце.')
            ),
            ul(li(p(t('Первый пункт'))), li(p(t('Второй пункт')))),
            p(t('Первый абзац.')),
            p(t('Второй абзац.'))
          )
        },
        { id: 'm2', author: 'boris', content: simple('Дальше.') }
      ]
    }
  ])
  const { win } = await open(file)
  const m1 = win.getByTestId('message').first()

  const cases: { name: string; from: string; to: string; quote: string }[] = [
    {
      name: 'bold, italic, plain and link',
      from: 'ирный',
      to: 'сс',
      quote: 'ирный и курсивный текст со сс'
    },
    { name: 'two list items', from: 'ый пункт', to: 'Второй', quote: 'ый пункт\nВторой' },
    { name: 'heading and paragraph', from: 'плана', to: 'Жирный', quote: 'плана\nЖирный' },
    { name: 'two paragraphs', from: 'вый абзац.', to: 'Второй', quote: 'вый абзац.\nВторой' }
  ]
  for (const c of cases) {
    await selectText(m1, c.from, c.to)
    await expect(reply(win), c.name).toBeVisible()
    await reply(win).click()
    await expect(win.getByTestId('branch-header'), c.name).toBeVisible()

    expect(await win.getByTestId('branch-quote').textContent(), c.name).toBe(c.quote)
    // the quoted passage is highlighted in the inherited source message, across formatting boundaries
    const marked = (await inherited(win).first().locator('mark.quote').allTextContents()).join('')
    expect(marked, c.name).toBe(c.quote.replace(/\n/g, ''))

    await win.getByTestId('panel-main').click()
    await expect(win.getByTestId('thread')).toHaveAttribute('data-thread-id', 'main')
  }

  // what was stored: the quote, and offsets that point at exactly that text in the stored message
  const threads = await savedThreads(file)
  const branches = threads.filter((th) => th.parentThreadId)
  expect(branches).toHaveLength(4)
  const plain = plainTextOf(threads[0]!.messages[0]!.content)
  expect(branches.map((b) => b.quoteText)).toEqual(cases.map((c) => c.quote))
  for (const b of branches) {
    expect(b.sourceMessageId).toBe('m1')
    expect(plain.slice(b.selectionStart, b.selectionEnd)).toBe(b.quoteText)
  }

  // four branches start from m1: the badge lists them
  const badge = m1.getByTestId('branch-badge')
  await expect(badge).toContainText('4')
  await badge.click()
  await expect(win.getByTestId('branch-badge-item')).toHaveCount(4)

  // replying marked the source message as read for this participant (FR-112)
  expect((await readReadState(file))['p-local']).toEqual(['m1'])
})

test('nested branches three levels deep show exactly the right context, and survive reopening (FR-053, FR-056, FR-057, FR-063)', async () => {
  const dir = await workDir()
  const file = join(dir, 'вложенные.branchchat')
  await writeDiscussionFile(file, [plainMessages()])
  const profile = await namedProfile()
  const { t, win } = await open(file, profile)

  // level 1: from m2
  await replyTo(win, msg(win, 'Второе сообщение'), 'которого')
  await sendText(win, 'Первый ответ')
  await sendText(win, 'Второй ответ')
  // level 2: from the first answer in branch 1
  await replyTo(win, msg(win, 'Первый ответ'), 'Первый')
  await sendText(win, 'Ещё ответ')
  // level 3: from the answer in branch 2
  await replyTo(win, msg(win, 'Ещё ответ'), 'Ещё')

  // context of the third branch: everything up to and including each source message, nothing later
  expect(await inheritedTexts(win)).toEqual(['Первое сообщение.', M2, 'Первый ответ', 'Ещё ответ'])
  await expect(win.getByText('Третье сообщение')).toHaveCount(0) // m3 came after the source in the main thread
  await expect(win.getByText('Второй ответ')).toHaveCount(0) // so did the second answer in branch 1
  await expect(win.getByTestId('message')).toHaveCount(0) // the new branch has no messages of its own yet
  await expect(win.locator('[data-testid=branch-path] .crumb')).toHaveCount(4) // main > 1 > 2 > 3
  expect(
    await win.getByTestId('inherited-message').last().locator('mark.quote').allTextContents()
  ).toEqual(['Ещё'])

  // a sibling of the first branch gets the context of m2 only
  await win.getByTestId('panel-main').click()
  await replyTo(win, msg(win, 'Второе сообщение'), 'сообщение,')
  expect(await inheritedTexts(win)).toEqual(['Первое сообщение.', M2])
  await expect(win.getByText('Первый ответ')).toHaveCount(0)

  // the side panel shows the hierarchy: 1 > 2 > 3, and the sibling next to 1
  await expect(win.getByTestId('panel-branch')).toHaveCount(4)
  await expect(win.locator('[data-testid=panel-active] > ul > li')).toHaveCount(2)
  await expect(win.locator('[data-testid=panel-active] > ul > li > ul > li > ul > li')).toHaveCount(
    1
  )

  // reopen the application: structure, context and highlight come back from the file
  await t.close()
  const again = await open(file, profile)
  await expect(again.win.getByTestId('panel-branch')).toHaveCount(4)
  await again.win.getByTestId('panel-branch').nth(2).click() // depth-first order: 1, 2, 3, sibling
  expect(await inheritedTexts(again.win)).toEqual([
    'Первое сообщение.',
    M2,
    'Первый ответ',
    'Ещё ответ'
  ])
  expect(
    await again.win.getByTestId('inherited-message').last().locator('mark.quote').allTextContents()
  ).toEqual(['Ещё'])
  await expect(again.win.locator('[data-testid=branch-path] .crumb')).toHaveCount(4)
})

test('a branch created from inherited context becomes a sibling in the thread the message belongs to (FR-056)', async () => {
  const dir = await workDir()
  const file = join(dir, 'сестра.branchchat')
  await writeDiscussionFile(file, [plainMessages()])
  const { win } = await open(file)

  await replyTo(win, msg(win, 'Второе сообщение'), 'которого') // branch A, shows m1 and m2 as context
  await replyTo(win, inherited(win).first(), 'Первое') // select in the inherited m1
  expect(await inheritedTexts(win)).toEqual(['Первое сообщение.']) // only m1
  await expect(win.locator('[data-testid=branch-path] .crumb')).toHaveCount(2) // main > new branch: parent is main
  await expect(win.locator('[data-testid=panel-active] > ul > li')).toHaveCount(2) // next to A, not under it
})

test('closing and reopening a branch; a closed parent never hides its open child (FR-059, FR-060, FR-064)', async () => {
  const dir = await workDir()
  const file = join(dir, 'закрытие.branchchat')
  await writeDiscussionFile(file, [
    plainMessages(),
    {
      id: 'a',
      parent: 'main',
      source: 'm2',
      ...where(M2, 'которого'),
      messages: [
        { id: 'a1', author: 'anna', content: simple('Ответ в первой ветке') },
        { id: 'a2', author: 'boris', content: simple('Ещё ответ в первой ветке') }
      ]
    },
    { id: 'b', parent: 'a', source: 'a1', ...where('Ответ в первой ветке', 'первой'), messages: [] }
  ])
  const { win } = await open(file)

  await win.locator('[data-testid=panel-branch][data-thread-id=a]').click()
  await expect(win.getByTestId('branch-toggle')).toHaveText('Закрыть ветку')
  await win.getByTestId('branch-toggle').click()

  // grouped in the panel: closed branch under "Закрытые", its open child still active and labelled with where it belongs
  await expect(win.locator('[data-testid=panel-closed] [data-thread-id=a]')).toHaveCount(1)
  await expect(win.locator('[data-testid=panel-active] [data-thread-id=b]')).toHaveCount(1)
  await expect(
    win.locator('[data-testid=panel-active] [data-thread-id=b] .panel-hint')
  ).toContainText('из ветки')
  await expect(win.locator('[data-testid=panel-active] [data-thread-id=a]')).toHaveCount(0)

  // a closed branch keeps its content but takes no new messages
  await expect(win.getByTestId('message')).toHaveCount(2)
  await expect(win.getByTestId('closed-notice')).toBeVisible()
  await expect(composer(win)).toHaveCount(0)
  await expect(win.getByTestId('branch-toggle')).toHaveText('Открыть ветку снова')
  expect((await savedThreads(file)).find((th) => th.threadId === 'a')!.status).toBe('closed')

  // the child is independent: it is still open and writable
  await win.locator('[data-testid=panel-branch][data-thread-id=b]').click()
  await expect(composer(win)).toBeVisible()
  await expect(win.getByTestId('branch-toggle')).toHaveText('Закрыть ветку')

  // reopen from the notice in the closed branch
  await win.locator('[data-testid=panel-branch][data-thread-id=a]').click()
  await win.getByTestId('reopen-from-composer').click()
  await expect(composer(win)).toBeVisible()
  await expect(win.getByTestId('panel-closed')).toHaveCount(0)
  await expect(win.locator('[data-testid=panel-active] [data-thread-id=a]')).toHaveCount(1)
  await sendText(win, 'Снова можно писать')
  const a = (await savedThreads(file)).find((th) => th.threadId === 'a')!
  expect(a.status).toBe('open')
  expect(a.messages).toHaveLength(3)
})

test('an optional branch title is shown in the panel and the path, and saved (FR-058)', async () => {
  const dir = await workDir()
  const file = join(dir, 'название.branchchat')
  await writeDiscussionFile(file, [
    plainMessages(),
    { id: 'a', parent: 'main', source: 'm2', ...where(M2, 'после которого'), messages: [] }
  ])
  const { win } = await open(file)
  const item = win.locator('[data-testid=panel-branch][data-thread-id=a] .panel-label')
  await expect(item).toHaveText('после которого') // no title: an excerpt of the quote

  await item.click()
  await win.getByTestId('branch-title').fill('Про ветки')
  await win.getByTestId('branch-title').press('Enter')
  await expect(item).toHaveText('Про ветки')
  await expect(win.getByTestId('branch-path').locator('strong')).toHaveText('Про ветки')
  await expect
    .poll(async () => (await savedThreads(file)).find((th) => th.threadId === 'a')!.title)
    .toBe('Про ветки')

  await win.getByTestId('branch-title').fill('')
  await win.getByTestId('branch-title').press('Enter')
  await expect(item).toHaveText('после которого')
  await expect
    .poll(async () => (await savedThreads(file)).find((th) => th.threadId === 'a')!.title)
    .toBeUndefined()
})

test('messages show how many branches start from them; "go to source" returns to the message (FR-032, FR-035)', async () => {
  const dir = await workDir()
  const file = join(dir, 'метки.branchchat')
  const m1 = 'Первое сообщение.'
  await writeDiscussionFile(file, [
    plainMessages(),
    {
      id: 'a',
      parent: 'main',
      source: 'm2',
      ...where(M2, 'которого'),
      title: 'Первая',
      messages: []
    },
    { id: 'b', parent: 'main', source: 'm2', ...where(M2, 'ветки'), title: 'Вторая', messages: [] },
    { id: 'c', parent: 'main', source: 'm1', ...where(m1, 'Первое'), messages: [] }
  ])
  const { win } = await open(file)

  await expect(msg(win, 'Третье').getByTestId('branch-badge')).toHaveCount(0)
  const m2Badge = msg(win, 'Второе').getByTestId('branch-badge')
  await expect(m2Badge).toContainText('2')
  await m2Badge.click()
  await expect(win.getByTestId('branch-badge-item')).toHaveText(['Первая', 'Вторая'])
  await win.getByTestId('branch-badge-item').nth(1).click()
  await expect(win.getByTestId('branch-title')).toHaveValue('Вторая')

  // back to the source message in the parent thread, which is shown and flashed
  await win.getByTestId('go-to-source').click()
  await expect(win.getByTestId('thread')).toHaveAttribute('data-thread-id', 'main')
  await expect(win.locator('.row.flash')).toContainText('Второе сообщение')

  // a message with a single branch opens it directly
  await msg(win, 'Первое').getByTestId('branch-badge').click()
  await expect(win.getByTestId('branch-header')).toBeVisible()
  expect(await win.getByTestId('branch-quote').textContent()).toBe('Первое')
})

test('"go to source" scrolls a long discussion to the source message', async () => {
  test.setTimeout(90_000)
  const dir = await workDir()
  const file = join(dir, 'длинное.branchchat')
  const texts = Array.from({ length: 400 }, (_, i) => `Сообщение номер ${i}.`)
  await writeDiscussionFile(file, [
    {
      id: 'main',
      messages: texts.map((text, i) => ({
        id: `m${i}`,
        author: i % 2 ? 'anna' : 'boris',
        content: simple(text)
      }))
    },
    {
      id: 'far',
      parent: 'main',
      source: 'm5',
      ...where(texts[5]!, 'номер 5'),
      messages: [{ id: 'f1', author: 'boris', content: simple('Ответ в далёкой ветке') }]
    }
  ])
  const { win } = await open(file)
  await expect(win.getByText('Сообщение номер 399.')).toBeVisible() // opens at the newest
  await expect(win.getByText('Сообщение номер 5.')).toHaveCount(0) // far away, not in the page

  await win.locator('[data-testid=panel-branch][data-thread-id=far]').click()
  await expect(win.getByText('Ответ в далёкой ветке')).toBeVisible()
  await win.getByTestId('go-to-source').click()
  await expect(win.getByText('Сообщение номер 5.')).toBeVisible()
  await expect(win.getByText('Сообщение номер 399.')).toHaveCount(0)
  expect(await win.getByTestId('message').count()).toBeLessThan(80)
})

test('"Reply to this" appears only for a selection inside one message, and goes away with it (FR-049, FR-050)', async () => {
  const dir = await workDir()
  const file = join(dir, 'кнопка.branchchat')
  await writeDiscussionFile(file, [plainMessages()])
  const { win } = await open(file)

  await expect(reply(win)).toHaveCount(0)
  await expect(win.getByTestId('message')).toHaveCount(3) // wait until the list is on screen

  // a selection spanning two messages: no button
  await win.evaluate(() => {
    const rich = document.querySelectorAll('[data-testid=message] .rich')
    const a = document.createTreeWalker(rich[0]!, NodeFilter.SHOW_TEXT).nextNode()!
    const b = document.createTreeWalker(rich[1]!, NodeFilter.SHOW_TEXT).nextNode()!
    const range = document.createRange()
    range.setStart(a, 2)
    range.setEnd(b, 4)
    getSelection()!.removeAllRanges()
    getSelection()!.addRange(range)
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
  await expect(reply(win)).toHaveCount(0)

  // text in the composer: no button
  await composer(win).click()
  await win.keyboard.type('черновик')
  await win.keyboard.press('Control+a')
  await win.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })))
  await expect(reply(win)).toHaveCount(0)

  // a selection inside one message: button; collapsing the selection hides it
  await selectText(msg(win, 'Третье'), 'Третье')
  await expect(reply(win)).toBeVisible()
  await win.evaluate(() => getSelection()!.removeAllRanges())
  await expect(reply(win)).toHaveCount(0)
})

test('the participant name is asked for before the first branch is created (FR-019, FR-022)', async () => {
  const dir = await workDir()
  const file = join(dir, 'имя.branchchat')
  await writeDiscussionFile(file, [plainMessages()])
  const profile = await tempDir('bc-profile-') // no name saved
  dirs.push(profile)
  const { win } = await open(file, profile)

  await selectText(msg(win, 'Второе'), 'которого')
  await reply(win).click()
  await expect(win.getByTestId('name-input')).toBeVisible()
  await expect(win.getByTestId('branch-header')).toHaveCount(0) // nothing is created yet
  await win.getByTestId('name-input').fill('Вера')
  await win.getByTestId('name-confirm').click()
  // replying marks the source message as read, so the one-time read-status notice follows the name (FR-125)
  await win.getByTestId('read-notice-confirm').click()
  await expect(win.getByTestId('branch-header')).toBeVisible()
  expect(await win.getByTestId('branch-quote').textContent()).toBe('которого') // the selection was kept

  const saved = await readDiscussionFile(file)
  expect(saved.discussion.participants.map((x) => x.displayName)).toContain('Вера') // added on first write
  const settings = JSON.parse(await fs.readFile(join(profile, 'settings.json'), 'utf8')) as {
    participantId: string
  }
  expect((await readReadState(file))[settings.participantId]).toEqual(['m2'])
})

test('each thread keeps its own unsent draft while moving between branches (FR-008)', async () => {
  const dir = await workDir()
  const file = join(dir, 'черновики.branchchat')
  await writeDiscussionFile(file, [
    plainMessages(),
    { id: 'a', parent: 'main', source: 'm2', ...where(M2, 'которого'), messages: [] }
  ])
  const { t, win } = await open(file)

  await composer(win).click()
  await win.keyboard.type('черновик основной')
  await win.locator('[data-testid=panel-branch][data-thread-id=a]').click()
  await expect(composer(win)).toHaveText('') // the branch has its own, empty composer
  await win.keyboard.type('черновик ветки')

  await win.getByTestId('panel-main').click()
  await expect(composer(win)).toHaveText('черновик основной')
  await win.locator('[data-testid=panel-branch][data-thread-id=a]').click()
  await expect(composer(win)).toHaveText('черновик ветки')

  // sending in the branch does not touch the main thread's draft; closing still warns about it
  await win.keyboard.press('Control+Enter')
  await expect(win.getByTestId('message').filter({ hasText: 'черновик ветки' })).toHaveCount(1)
  await t.answer({ box: [1] })
  await t.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close())
  await expect.poll(async () => (await t.dialogs()).filter((d) => d.kind === 'box').length).toBe(1)
  await win.getByTestId('panel-main').click()
  await expect(composer(win)).toHaveText('черновик основной')
})
