import { expect, test, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { cleanup, launchApp, tempDir, type TestApp } from './helpers/app'
import { simple, writeDiscussionFile } from './helpers/craft'

// ADR-003: the window lists the discussions of the library; the start screen is only for an empty library. The File
// menu and the jump list show the most recently used ones; the last discussion opens at startup.

const apps: TestApp[] = []
const dirs: string[] = []
test.afterEach(async () => {
    await Promise.all(apps.splice(0).map((a) => a.close()))
    await cleanup(...dirs.splice(0))
})

async function folder(prefix: string): Promise<string> {
    const d = await tempDir(prefix)
    dirs.push(d)
    return d
}
async function discussion(dir: string, name: string): Promise<string> {
    const file = join(dir, `${name}.branchchat`)
    await writeDiscussionFile(file, [
        {
            id: 'main',
            messages: [{ id: 'm1', author: 'boris', content: simple(`Текст «${name}»`) }]
        }
    ])
    return file
}
/** A profile with a name (so no dialogs interfere) and the given settings. */
async function profile(settings: Record<string, unknown> = {}): Promise<string> {
    const dir = await folder('bc-recent-profile-')
    await fs.writeFile(
        join(dir, 'settings.json'),
        JSON.stringify({
            participantId: 'p-test',
            displayName: 'Тест',
            readNoticeAcknowledged: true,
            associationAsked: true,
            ...settings
        })
    )
    return dir
}
async function start(userData: string, files: string[] = []): Promise<{ t: TestApp; win: Page }> {
    const t = await launchApp({ userData, files })
    apps.push(t)
    return { t, win: await t.app.firstWindow() }
}
/** Imports the files into the library of the profile, one after the other (the last one is the most recent). */
async function seed(userData: string, files: string[]): Promise<void> {
    const { t, win } = await start(userData)
    for (const f of files) {
        const r = await win.evaluate((p) => window.branchchat.openPath(p), f)
        expect(r.ok).toBe(true)
    }
    await t.close()
    apps.splice(apps.indexOf(t), 1)
}
const listed = (win: Page): Promise<string[]> =>
    win.getByTestId('sidebar-open').locator('.sidebar-title').allInnerTexts()
const menuLabels = (t: TestApp): Promise<string[]> =>
    t.app.evaluate(({ Menu }) => {
        const file = Menu.getApplicationMenu()!.items[0]!
        const recent = file.submenu!.items.find((i) => i.label === 'Открыть недавние')!
        return recent.submenu!.items.map((i) => i.label || i.type)
    })

test('with discussions in the library, the window lists them all and asks to choose one (no start screen)', async () => {
    const dir = await folder('bc-recent-')
    const files = [await discussion(dir, 'Первое'), await discussion(dir, 'Второе')]
    const userData = await profile({ openLastFileOnStartup: false, sidebar: { sort: 'name' } })
    await seed(userData, files)
    const { win } = await start(userData)
    await expect.poll(() => listed(win)).toEqual(['Второе', 'Первое'])
    await expect(win.getByTestId('choose-hint')).toBeVisible()
    await expect(win.getByTestId('launcher')).toHaveCount(0)
})

test('a click in the list opens the discussion; opening one puts it on top', async () => {
    const dir = await folder('bc-recent-')
    const files = [await discussion(dir, 'Старое'), await discussion(dir, 'Новое')]
    const userData = await profile({ openLastFileOnStartup: false, sidebar: { sort: 'name' } })
    await seed(userData, files)
    const { t, win } = await start(userData)
    await expect.poll(() => listed(win)).toEqual(['Новое', 'Старое'])
    await expect.poll(() => menuLabels(t)).toEqual(['Новое', 'Старое'])
    await win.getByTestId('sidebar-open').filter({ hasText: 'Старое' }).click()
    await expect(win.getByTestId('message').filter({ hasText: 'Текст «Старое»' })).toHaveCount(1)
    await expect.poll(() => menuLabels(t)).toEqual(['Старое', 'Новое'])
})

test('startup: the most recent discussion opens by itself (default)', async () => {
    const dir = await folder('bc-recent-')
    const files = [await discussion(dir, 'Позавчера'), await discussion(dir, 'Вчера')]
    const userData = await profile() // no explicit setting: on by default
    await seed(userData, files)
    const { t, win } = await start(userData)

    await expect(win.getByTestId('message').filter({ hasText: 'Текст «Вчера»' })).toHaveCount(1)
    expect(await t.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(
        1
    )
})

test('startup: nothing opens when the option is off; an empty library shows the start screen', async () => {
    const dir = await folder('bc-recent-')
    const off = await profile({ openLastFileOnStartup: false })
    await seed(off, [await discussion(dir, 'Есть')])
    const first = await start(off)
    await expect(first.win.getByTestId('choose-hint')).toBeVisible()
    await expect(first.win.getByTestId('sidebar-item')).toHaveCount(1)
    await expect(first.win.getByTestId('composer')).toHaveCount(0)
    await first.t.close()
    apps.pop()

    // the start screen offers the four ways to begin
    const empty = await start(await profile())
    for (const id of ['launcher-new', 'launcher-new-shared', 'launcher-join', 'launcher-open'])
        await expect(empty.win.getByTestId(id)).toBeVisible()
    await expect(empty.win.getByTestId('sidebar')).toHaveCount(0)
})

test('startup: a file given on the command line wins; the last discussion is not opened as well', async () => {
    const dir = await folder('bc-recent-')
    const userData = await profile()
    await seed(userData, [await discussion(dir, 'Последнее')])
    const clicked = await discussion(dir, 'Двойной щелчок')
    const { t, win } = await start(userData, [clicked])

    await expect(
        win.getByTestId('message').filter({ hasText: 'Текст «Двойной щелчок»' })
    ).toHaveCount(1)
    expect(await t.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(
        1
    )
})

test('File > Open recent lists the discussions and opens the chosen one', async () => {
    const dir = await folder('bc-recent-')
    const userData = await profile({ openLastFileOnStartup: false })
    await seed(userData, [await discussion(dir, 'Из меню'), await discussion(dir, 'Другое')])
    const { t, win } = await start(userData)
    await expect.poll(() => menuLabels(t)).toEqual(['Другое', 'Из меню'])

    await t.app.evaluate(({ Menu }) => {
        const file = Menu.getApplicationMenu()!.items[0]!
        const recent = file.submenu!.items.find((i) => i.label === 'Открыть недавние')!
        recent.submenu!.items.find((i) => i.label === 'Из меню')!.click()
    })
    await expect(win.getByTestId('message').filter({ hasText: 'Текст «Из меню»' })).toHaveCount(1)
})

test('Settings: the startup option and the number of recent discussions are saved and applied', async () => {
    const dir = await folder('bc-recent-')
    const files = await Promise.all(['1', '2', '3', '4'].map((n) => discussion(dir, `Файл ${n}`)))
    const userData = await profile({ openLastFileOnStartup: false })
    await seed(userData, files)
    const { t, win } = await start(userData)
    await expect(win.getByTestId('sidebar-item')).toHaveCount(4)

    await t.app.evaluate(({ Menu }) => {
        Menu.getApplicationMenu()!
            .items[0]!.submenu!.items.find((i) => i.label === 'Настройки…')!
            .click()
    })
    const dialog = win.getByTestId('settings-dialog')
    await expect(dialog).toBeVisible()
    const settingsFile = join(userData, 'settings.json')
    const saved = async (): Promise<Record<string, unknown>> =>
        JSON.parse(await fs.readFile(settingsFile, 'utf8')) as Record<string, unknown>

    // defaults shown: the option is off in this profile; the limit is the default of 10
    await expect(win.getByTestId('settings-open-last')).not.toBeChecked()
    await expect(win.getByTestId('settings-recent-limit')).toHaveValue('10')

    await win.getByTestId('settings-open-last').check()
    await expect.poll(async () => (await saved())['openLastFileOnStartup']).toBe(true)

    // a lower number shortens the File menu; the window still lists every discussion
    const limit = win.getByTestId('settings-recent-limit')
    await limit.fill('2')
    await limit.press('Enter')
    await expect.poll(async () => (await saved())['recentFilesLimit']).toBe(2)
    await expect.poll(() => menuLabels(t)).toEqual(['Файл 4', 'Файл 3'])

    // a negative or fractional number is ignored
    await limit.fill('-1')
    await limit.blur()
    await expect(limit).toHaveValue('2')
    expect((await saved())['recentFilesLimit']).toBe(2)
    await limit.fill('1.5')
    await limit.blur()
    await expect(limit).toHaveValue('2')

    // 0: the menu is empty
    await limit.fill('0')
    await limit.press('Enter')
    await expect.poll(() => menuLabels(t)).toEqual(['Список пуст'])
    await win.keyboard.press('Escape')
    await expect(win.getByTestId('sidebar-item')).toHaveCount(4)
})
