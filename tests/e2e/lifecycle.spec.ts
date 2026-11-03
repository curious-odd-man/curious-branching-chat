import {expect, type Page, test} from '@playwright/test'
import {promises as fs} from 'node:fs'
import {join} from 'node:path'
import {readDiscussionFile} from './helpers/readFile'
import {cleanup, launchApp, tempDir, type TestApp} from './helpers/app'

const apps: TestApp[] = []
const dirs: string[] = []
test.afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()))
  await cleanup(...dirs.splice(0))
})

async function start(
  options: Parameters<typeof launchApp>[0] = {}
): Promise<{ t: TestApp; win: Page }> {
  const t = await launchApp(options)
  apps.push(t)
  dirs.push(t.userData)
  return { t, win: await t.app.firstWindow() }
}
async function workDir(): Promise<string> {
  const d = await tempDir()
  dirs.push(d)
  return d
}

/** Creates a discussion through the UI (name prompt included) and returns once the composer is visible. */
async function createDiscussion(t: TestApp, win: Page, file: string, name = 'Анна'): Promise<void> {
  await t.answer({ save: [file] })
  await win.getByTestId('launcher-new').click()
  const prompt = win.getByTestId('name-input')
  if (await prompt.isVisible().catch(() => false)) {
    await prompt.fill(name)
    await win.getByTestId('name-confirm').click()
  }
  await expect(win.getByTestId('composer')).toBeVisible()
}

async function send(win: Page, text: string): Promise<void> {
  await win.getByTestId('composer').fill(text)
  await win.getByTestId('send').click()
}

test('create, send, close, reopen (requirements 4.1 and 4.2)', async () => {
  const dir = await workDir()
  const file = join(dir, 'Идея.branchchat')
  const { t, win } = await start()

  await createDiscussion(t, win, file)
  await expect(win.locator('h1')).toHaveText('Идея.branchchat')
  expect((await readDiscussionFile(file)).discussion.title).toBe('Идея') // file exists immediately

  await send(win, 'Привет!\nВторая строка с ёлкой.')
  const message = win.getByTestId('message')
  await expect(message).toHaveCount(1)
  await expect(message).toContainText('Анна')
  await expect(message).toContainText('Вторая строка с ёлкой.')
  await expect(win.getByTestId('status')).toHaveText('Сохранено')

  const saved = (await readDiscussionFile(file)).discussion
  expect(saved.threads[0]!.messages).toHaveLength(1)
  expect(saved.participants.map((p) => p.displayName)).toEqual(['Анна'])

  // close the window (no draft, nothing unsaved: no warning), then reopen from the file
  const profile = t.userData
  await t.close()
  const second = await start({ userData: profile, files: [file] })
  await expect(second.win.getByTestId('message')).toHaveCount(1)
  await expect(second.win.getByTestId('message')).toContainText('Привет!')

  // the name was remembered: sending needs no prompt (FR-017, FR-018)
  await send(second.win, 'Снова я')
  await expect(second.win.getByTestId('message')).toHaveCount(2)
  await expect(second.win.getByTestId('name-input')).toHaveCount(0)
})

test('asks for the name once, before the first message or new discussion (FR-019)', async () => {
  const dir = await workDir()
  const { t, win } = await start()
  await t.answer({ save: [join(dir, 'a.branchchat')] })
  await win.getByTestId('launcher-new').click()
  await expect(win.getByTestId('name-input')).toBeVisible()
  await expect(win.getByTestId('name-confirm')).toBeDisabled() // empty name is not accepted
  await win.getByTestId('name-input').fill('Борис')
  await win.getByTestId('name-confirm').click()
  await expect(win.getByTestId('composer')).toBeVisible()
  const settings = JSON.parse(await fs.readFile(join(t.userData, 'settings.json'), 'utf8'))
  expect(settings.displayName).toBe('Борис')
  expect(settings.participantId).toMatch(/[0-9a-f-]{36}/)
})

test('cancelling the Save dialog creates nothing', async () => {
  const { t, win } = await start()
  await createDiscussion(t, win, join(await workDir(), 'x.branchchat')) // sets the name
  await t.close()
  const again = await start({ userData: t.userData })
  await again.win.getByTestId('launcher-new').click() // no answer queued => dialog is cancelled
  await expect(again.win.getByTestId('launcher-new')).toBeVisible()
  expect((await again.t.dialogs()).filter((d) => d.kind === 'save')).toHaveLength(1)
})

test('opens two documents in two windows; the same file twice focuses the existing window', async () => {
  const dir = await workDir()
  const a = join(dir, 'a.branchchat')
  const b = join(dir, 'b.branchchat')
  const { t, win } = await start()
  await createDiscussion(t, win, a)
  await send(win, 'в первом')

  // a second discussion opens in a new window because the first window already has one
  await t.answer({ save: [b] })
  await win.evaluate(() => window.branchchat.newDocument())
  const [, second] = await t.windows(2)
  await expect(second!.locator('h1')).toHaveText('b.branchchat')

  // opening a again does not create a third window
  const result = await win.evaluate((p) => window.branchchat.openPath(p), a)
  expect(result).toEqual({ ok: true, data: { status: 'focused' } })
  // different spelling of the same path is recognized too
  const again = await win.evaluate(
    (p) => window.branchchat.openPath(p),
    join(dir, '.', 'a.branchchat')
  )
  expect(again).toEqual({ ok: true, data: { status: 'focused' } })
  expect(t.app.windows()).toHaveLength(2)
})

test('a second launch with a file forwards it to the running instance (FR-088)', async () => {
  const dir = await workDir()
  const a = join(dir, 'a.branchchat')
  const { t, win } = await start()
  await createDiscussion(t, win, a)
  await t.close()

  const first = await start({ userData: t.userData }) // launcher window
  expect(first.t.app.windows()).toHaveLength(1)
  // simulate Windows launching "BranchChat.exe a.branchchat" while the app runs
  await first.t.app.evaluate(({ app }, file) => {
    app.emit('second-instance', {}, ['BranchChat.exe', file], process.cwd())
  }, a)
  // the empty start window is reused for the file
  await expect(first.win.locator('h1')).toHaveText('a.branchchat')
  expect(first.t.app.windows()).toHaveLength(1)
})

test('damaged, missing and newer files give a clear message and do not crash (FR-009, FR-118)', async () => {
  const dir = await workDir()
  const garbage = join(dir, 'garbage.branchchat')
  await fs.writeFile(garbage, 'this is not a zip file')
  const { t, win } = await start()

  const damaged = await win.evaluate((p) => window.branchchat.openPath(p), garbage)
  expect(damaged).toEqual({ ok: true, data: { status: 'failed', errorCode: 'NOT_AN_ARCHIVE' } })
  const missing = await win.evaluate(
    (p) => window.branchchat.openPath(p),
    join(dir, 'nope.branchchat')
  )
  expect(missing).toEqual({ ok: true, data: { status: 'failed', errorCode: 'NOT_FOUND' } })

  const boxes = (await t.dialogs()).filter((d) => d.kind === 'box')
  expect(boxes).toHaveLength(2)
  expect(boxes[0]!.type).toBe('error')
  expect(boxes[0]!.detail).toContain('повреждён')
  expect(boxes[1]!.detail).toContain('не найден')
  await expect(win.getByTestId('launcher-new')).toBeVisible() // still alive, still a start window
})

test('a bad path on the command line shows an error and the app still starts (FR-118)', async () => {
  const dir = await workDir()
  const { t, win } = await start({ files: [join(dir, 'missing.branchchat')] })
  await expect(win.getByTestId('launcher-new')).toBeVisible()
  const boxes = (await t.dialogs()).filter((d) => d.kind === 'box')
  expect(boxes).toHaveLength(1)
  expect(boxes[0]!.detail).toContain('не найден')
})

test('a file from a newer schema version is refused with an update hint (FR-012)', async () => {
  const dir = await workDir()
  const file = join(dir, 'new.branchchat')
  const { t, win } = await start()
  await createDiscussion(t, win, join(dir, 'src.branchchat'))
  // build a newer-version file from the saved one
  const { buildNewerCopy } = await import('./helpers/newer')
  await buildNewerCopy(join(dir, 'src.branchchat'), file)
  const result = await win.evaluate((p) => window.branchchat.openPath(p), file)
  expect(result).toEqual({ ok: true, data: { status: 'failed', errorCode: 'UNSUPPORTED_VERSION' } })
  const box = (await t.dialogs()).filter((d) => d.kind === 'box').at(-1)!
  expect(box.detail).toContain('более новой версией')
})

test('two copies of the same discussion: notice names both files, nothing is merged (FR-117)', async () => {
  const dir = await workDir()
  const a = join(dir, 'a.branchchat')
  const b = join(dir, 'a (1).branchchat')
  const { t, win } = await start()
  await createDiscussion(t, win, a)
  await send(win, 'общий текст')
  await fs.copyFile(a, b)

  await win.evaluate((p) => window.branchchat.openPath(p), b)
  const [, copy] = await t.windows(2)
  const notice = copy!.getByTestId('notice')
  await expect(notice).toContainText('a.branchchat')
  await expect(notice).toContainText('a (1).branchchat')
  await expect(win.getByTestId('notice')).toHaveCount(0) // the first window is unchanged
})

test('a failed save keeps the message, shows an error, and recovers on retry (FR-008)', async () => {
  const dir = await workDir()
  const sub = join(dir, 'sub')
  await fs.mkdir(sub)
  const file = join(sub, 'a.branchchat')
  const { t, win } = await start()
  await createDiscussion(t, win, file)

  await fs.rm(sub, { recursive: true }) // the folder disappears (e.g. a removed USB stick)
  await send(win, 'не сохранится')
  await expect(win.getByTestId('save-error')).toBeVisible()
  await expect(win.getByTestId('message')).toHaveCount(1) // the message is still shown, not lost
  expect(win.getByTestId('composer')).toHaveValue('') // and it left the composer

  await fs.mkdir(sub)
  await win.getByTestId('retry-save').click()
  await expect(win.getByTestId('save-error')).toHaveCount(0)
  await expect(win.getByTestId('status')).toHaveText('Сохранено')
  expect((await readDiscussionFile(file)).discussion.threads[0]!.messages).toHaveLength(1)
})

test('closing warns only for an unsent draft or a failed save (FR-008)', async () => {
  const dir = await workDir()
  const file = join(dir, 'a.branchchat')
  const { t, win } = await start()
  await createDiscussion(t, win, file)

  // 1. unsent draft: the dialog appears; "cancel" (button 1) keeps the window
  await win.getByTestId('composer').fill('черновик')
  expect((await t.dialogs()).filter((d) => d.kind === 'box')).toHaveLength(0) // typing alone shows nothing
  await t.answer({ box: [1] })
  await t.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close())
  await expect.poll(async () => (await t.dialogs()).filter((d) => d.kind === 'box').length).toBe(1)
  const warning = (await t.dialogs()).find((d) => d.kind === 'box')!
  expect(warning.type).toBe('warning')
  expect(warning.detail).toContain('неотправленное сообщение')
  expect(t.app.windows()).toHaveLength(1)
  await expect(win.getByTestId('composer')).toHaveValue('черновик') // nothing was lost

  // 2. send it; now nothing is unsaved, so closing shows no further dialog and the app exits
  await win.getByTestId('send').click()
  await expect(win.getByTestId('status')).toHaveText('Сохранено')
  const exited = new Promise<void>((resolve) => t.app.process().once('exit', () => resolve()))
  await t.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close())
  await exited
  expect((await readDiscussionFile(file)).discussion.threads[0]!.messages).toHaveLength(1)
})

test('closing right after sending still saves the message', async () => {
  const dir = await workDir()
  const file = join(dir, 'a.branchchat')
  const { t, win } = await start()
  await createDiscussion(t, win, file)
  await send(win, 'последнее сообщение')
  const exited = new Promise<void>((resolve) => t.app.process().once('exit', () => resolve()))
  await t.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close()) // no waiting for "Сохранено"
  await exited
  expect((await readDiscussionFile(file)).discussion.threads[0]!.messages).toHaveLength(1)
})
