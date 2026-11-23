import { expect, test, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { readDiscussionFile } from './helpers/readFile'
import { draftRows, exportOpen, libraryList, newDiscussion, readLibrary } from './helpers/library'
import { cleanup, launchApp, tempDir, type TestApp } from './helpers/app'

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
async function createDiscussion(win: Page, title = 'Обсуждение', name = 'Анна'): Promise<void> {
    await newDiscussion(win, title, name)
}

/** A new start would reopen the last discussion (the default); tests that expect the start screen turn that off. */
async function turnOffReopenLast(userData: string): Promise<void> {
    const file = join(userData, 'settings.json')
    const settings = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>
    await fs.writeFile(file, JSON.stringify({ ...settings, openLastFileOnStartup: false }))
}

async function send(win: Page, text: string): Promise<void> {
    await win.getByTestId('composer').fill(text)
    await win.getByTestId('send').click()
}

test('create, send, close, reopen (requirements 4.1 and 4.2)', async () => {
    const { t, win } = await start()

    await createDiscussion(win, 'Идея')
    await expect(win.locator('h1')).toHaveText('Идея')
    expect(readLibrary(t.userData).discussion.title).toBe('Идея') // in the library immediately (FR-202)

    await send(win, 'Привет!\nВторая строка с ёлкой.')
    const message = win.getByTestId('message')
    await expect(message).toHaveCount(1)
    await expect(message).toContainText('Анна')
    await expect(message).toContainText('Вторая строка с ёлкой.')
    await expect(win.getByTestId('status')).toHaveText('Сохранено')

    const saved = readLibrary(t.userData).discussion
    expect(saved.threads[0]!.messages).toHaveLength(1)
    expect(saved.participants.map((p) => p.displayName)).toEqual(['Анна'])

    // close the window (no draft, nothing unsaved: no warning); the next start opens the last discussion
    const profile = t.userData
    await t.close()
    const second = await start({ userData: profile })
    await expect(second.win.getByTestId('message')).toHaveCount(1)
    await expect(second.win.getByTestId('message')).toContainText('Привет!')

    // the name was remembered: sending needs no prompt (FR-017, FR-018)
    await send(second.win, 'Снова я')
    await expect(second.win.getByTestId('message')).toHaveCount(2)
    await expect(second.win.getByTestId('name-input')).toHaveCount(0)
})

test('asks for the name once, before the first message or new discussion (FR-019)', async () => {
    const { t, win } = await start()
    await win.getByTestId('launcher-new').click()
    await expect(win.getByTestId('name-input')).toBeVisible()
    await expect(win.getByTestId('name-confirm')).toBeDisabled() // empty name is not accepted
    await win.getByTestId('name-input').fill('Борис')
    await win.getByTestId('name-confirm').click()
    // then the name of the discussion (FR-202)
    await expect(win.getByTestId('new-title-input')).toHaveValue('Новое обсуждение')
    await win.getByTestId('new-title-input').fill('  ')
    await expect(win.getByTestId('new-title-confirm')).toBeDisabled()
    await win.getByTestId('new-title-input').fill('План')
    await win.getByTestId('new-title-confirm').click()
    await expect(win.getByTestId('composer')).toBeVisible()
    await expect(win.locator('h1')).toHaveText('План')
    const settings = JSON.parse(await fs.readFile(join(t.userData, 'settings.json'), 'utf8'))
    expect(settings.displayName).toBe('Борис')
    expect(settings.participantId).toMatch(/[0-9a-f-]{36}/)
})

test('cancelling the name of a new discussion creates nothing; the window lists the discussions', async () => {
    const { t, win } = await start()
    await createDiscussion(win, 'Первое') // sets the name
    await t.close()
    await turnOffReopenLast(t.userData) // otherwise the second start reopens the discussion just created
    const again = await start({ userData: t.userData })
    await expect(again.win.getByTestId('sidebar-item')).toHaveCount(1)
    await expect(again.win.getByTestId('sidebar-item')).toContainText('Первое')
    await expect(again.win.getByTestId('sidebar-item')).toContainText('нет сообщений')
    await again.win.getByTestId('sidebar-add').click()
    await again.win.getByTestId('menu-add-local').click()
    await expect(again.win.getByTestId('name-input')).toHaveCount(0) // the name is known
    await again.win.getByTestId('new-title-input').press('Escape')
    await expect(again.win.getByTestId('new-title-input')).toHaveCount(0)
    await expect(again.win.getByTestId('choose-hint')).toBeVisible()
    expect(libraryList(t.userData)).toHaveLength(1)
    expect((await again.t.dialogs()).filter((d) => d.kind === 'save')).toHaveLength(0)

    // a click in the list opens the discussion
    await again.win.getByTestId('sidebar-open').click()
    await expect(again.win.locator('h1')).toHaveText('Первое')
})

test('a new discussion replaces the shown one in the window; "Открыть в новом окне" opens a second window; an open discussion is focused (FR-225)', async () => {
    const dir = await workDir()
    const { t, win } = await start()
    await createDiscussion(win, 'a')
    await send(win, 'в первом')
    await expect(win.getByTestId('status')).toHaveText('Сохранено')

    // a second discussion opens in the same window (one main window)
    await win.evaluate(() => window.branchchat.newDocument('b'))
    await expect(win.locator('h1')).toHaveText('b')
    expect(t.app.windows()).toHaveLength(1)

    // a in a new window
    const idA = readLibrary(t.userData, 'a').id
    const opened = await win.evaluate((id) => window.branchchat.openDiscussionInNewWindow(id), idA)
    expect(opened).toEqual({ ok: true, data: { status: 'opened' } })
    const [, second] = await t.windows(2)
    await expect(second!.locator('h1')).toHaveText('a')

    // opening a again from the first window does not open it twice: its window gets the focus
    const result = await win.evaluate((id) => window.branchchat.openDiscussion(id), idA)
    expect(result).toEqual({ ok: true, data: { status: 'focused' } })
    await expect(win.locator('h1')).toHaveText('b')
    // importing a file of the same discussion: merged into it (nothing new), its window gets the focus (FR-204)
    const file = join(dir, 'a.branchchat')
    await exportOpen(t, second!, file)
    const again = await win.evaluate((p) => window.branchchat.openPath(p), file)
    expect(again).toEqual({ ok: true, data: { status: 'focused' } })
    await expect(second!.getByTestId('notice')).toContainText('нет ничего нового')
    expect(t.app.windows()).toHaveLength(2)
    expect(libraryList(t.userData)).toHaveLength(2)
})

test('a second launch with a file or a discussion forwards it to the running instance (FR-088)', async () => {
    const dir = await workDir()
    const a = join(dir, 'a.branchchat')
    const { t, win } = await start()
    await createDiscussion(win, 'a')
    await exportOpen(t, win, a)
    await t.close()

    // another profile: the file is imported, then shown in the empty start window
    const first = await start() // launcher window
    expect(first.t.app.windows()).toHaveLength(1)
    // simulate Windows launching "BranchChat.exe a.branchchat" while the app runs
    await first.t.app.evaluate(({ app }, file) => {
        app.emit('second-instance', {}, ['BranchChat.exe', file], process.cwd())
    }, a)
    await expect(first.win.locator('h1')).toHaveText('a')
    expect(first.t.app.windows()).toHaveLength(1)
    const id = readLibrary(first.t.userData, 'a').id

    // a jump list entry starts the app with the ID of the discussion
    await first.t.app.evaluate(({ app }, arg) => {
        app.emit('second-instance', {}, ['BranchChat.exe', arg], process.cwd())
    }, `--discussion=${id}`)
    await expect(first.win.locator('h1')).toHaveText('a')
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
    expect(libraryList(t.userData)).toHaveLength(0)
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
    await createDiscussion(win, 'src')
    await exportOpen(t, win, join(dir, 'src.branchchat'))
    // build a newer-version file from the exported one
    const { buildNewerCopy } = await import('./helpers/newer')
    await buildNewerCopy(join(dir, 'src.branchchat'), file)
    const result = await win.evaluate((p) => window.branchchat.openPath(p), file)
    expect(result).toEqual({
        ok: true,
        data: { status: 'failed', errorCode: 'UNSUPPORTED_VERSION' }
    })
    const box = (await t.dialogs()).filter((d) => d.kind === 'box').at(-1)!
    expect(box.detail).toContain('более новой версией')
})

test('an exported copy that got a message elsewhere is merged on import (FR-204, ADR-003)', async () => {
    const dir = await workDir()
    const a = join(dir, 'a.branchchat')
    const b = join(dir, 'b.branchchat')
    const one = await start()
    await createDiscussion(one.win, 'Общее')
    await send(one.win, 'общий текст')
    await expect(one.win.getByTestId('status')).toHaveText('Сохранено')
    await exportOpen(one.t, one.win, a)

    // another person imports the file, answers, and sends the file back
    const profile = await workDir()
    await fs.writeFile(
        join(profile, 'settings.json'),
        JSON.stringify({
            participantId: 'p-boris',
            displayName: 'Борис',
            readNoticeAcknowledged: true
        })
    )
    const two = await start({ userData: profile, files: [a] })
    await expect(two.win.getByTestId('message')).toHaveCount(1)
    await send(two.win, 'ответ из копии')
    await expect(two.win.getByTestId('message')).toHaveCount(2)
    await expect(two.win.getByTestId('status')).toHaveText('Сохранено')
    await exportOpen(two.t, two.win, b)

    // the first person imports it into the open discussion
    const r = await one.win.evaluate((p) => window.branchchat.openPath(p), b)
    expect(r).toEqual({ ok: true, data: { status: 'focused' } })
    await expect(one.win.getByTestId('message')).toHaveCount(2)
    await expect(one.win.getByTestId('notice')).toContainText('Новых сообщений: 1')
    expect(libraryList(one.t.userData)).toHaveLength(1)
    expect((await readDiscussionFile(b)).discussion.threads[0]!.messages).toHaveLength(2)
})

test('a failed save keeps the message, shows an error, and recovers on retry (FR-008)', async () => {
    const { t, win } = await start()
    await createDiscussion(win)

    await t.app.evaluate(() => {
        ;(globalThis as unknown as { __saveFault: boolean }).__saveFault = true
    })
    await send(win, 'не сохранится')
    await expect(win.getByTestId('save-error')).toBeVisible()
    await expect(win.getByTestId('message')).toHaveCount(1) // the message is still shown, not lost
    await expect(win.getByTestId('composer')).toHaveText('') // and it left the composer

    await t.app.evaluate(() => {
        ;(globalThis as unknown as { __saveFault: boolean }).__saveFault = false
    })
    await win.getByTestId('retry-save').click()
    await expect(win.getByTestId('save-error')).toHaveCount(0)
    await expect(win.getByTestId('status')).toHaveText('Сохранено')
    expect(readLibrary(t.userData).discussion.threads[0]!.messages).toHaveLength(1)
})

test('closing with an unsent draft asks nothing; the draft is there after the restart (FR-251, FR-254)', async () => {
    const { t, win } = await start()
    await createDiscussion(win)
    await win.getByTestId('composer').fill('черновик')
    const exited = new Promise<void>((resolve) => t.app.process().once('exit', () => resolve()))
    await t.app
        .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close())
        .catch(() => undefined) // the app quits while this call is answered
    await exited
    expect((await t.dialogs().catch(() => [])).filter((d) => d.kind === 'box')).toHaveLength(0)

    const again = await start({ userData: t.userData })
    await expect(again.win.getByTestId('composer')).toHaveText('черновик')
    await again.win.getByTestId('send').click()
    await expect(again.win.getByTestId('message')).toHaveCount(1)
    await expect(again.win.getByTestId('composer')).toHaveText('')
    await expect(again.win.getByTestId('status')).toHaveText('Сохранено')
    await expect.poll(() => draftRows(again.t.userData)).toBe(0) // the sent text is no draft any more
})

test('closing right after sending still saves the message', async () => {
    const { t, win } = await start()
    await createDiscussion(win)
    await send(win, 'последнее сообщение')
    const exited = new Promise<void>((resolve) => t.app.process().once('exit', () => resolve()))
    // no waiting for "Сохранено": the app quits while this call is answered
    await t.app
        .evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close())
        .catch(() => undefined)
    await exited
    expect(readLibrary(t.userData).discussion.threads[0]!.messages).toHaveLength(1)
})
