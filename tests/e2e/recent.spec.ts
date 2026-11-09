import { expect, test, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { cleanup, launchApp, tempDir, type TestApp } from './helpers/app'
import { simple, writeDiscussionFile } from './helpers/craft'

// Recently opened discussions: the start screen list, the File menu, reopening the last file at startup, and the
// two settings (how many files are remembered; open the last file on startup).

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
/** A profile with a name (so no dialogs interfere), the given settings and recent list. */
async function profile(
    recent: string[] | null,
    settings: Record<string, unknown> = {}
): Promise<string> {
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
    if (recent)
        await fs.writeFile(
            join(dir, 'recent.json'),
            JSON.stringify({
                version: 1,
                // newest first, as the application keeps it
                files: recent.map((path, i) => ({
                    path,
                    openedAt: `2026-01-0${9 - i}T00:00:00.000Z`
                }))
            })
        )
    return dir
}
const readRecent = async (userData: string): Promise<string[]> =>
    (
        JSON.parse(await fs.readFile(join(userData, 'recent.json'), 'utf8')) as {
            files: { path: string }[]
        }
    ).files.map((f) => f.path)

async function start(userData: string, files: string[] = []): Promise<{ t: TestApp; win: Page }> {
    const t = await launchApp({ userData, files })
    apps.push(t)
    return { t, win: await t.app.firstWindow() }
}

test('the start screen lists recent discussions, newest first; a missing file is greyed out', async () => {
    const dir = await folder('bc-recent-')
    const a = await discussion(dir, 'Первое')
    const b = await discussion(dir, 'Ёлка')
    const gone = join(dir, 'Исчезло.branchchat')
    const userData = await profile([b, gone, a], { openLastFileOnStartup: false })
    const { win } = await start(userData)

    const items = win.getByTestId('recent-item')
    await expect(items).toHaveCount(3)
    await expect(items.nth(0)).toContainText('Ёлка') // the first entry of the stored list is the newest
    await expect(items.nth(1)).toContainText('Исчезло')
    await expect(items.nth(2)).toContainText('Первое')
    await expect(items.nth(0)).toHaveAttribute('data-exists', 'true')
    await expect(items.nth(1)).toHaveAttribute('data-exists', 'false')
    await expect(items.nth(1)).toContainText('файл не найден')
})

test('clicking an entry opens it; a missing one shows the usual message and stays in the list', async () => {
    const dir = await folder('bc-recent-')
    const a = await discussion(dir, 'Открой меня')
    const gone = join(dir, 'Нет.branchchat')
    const userData = await profile([a, gone], { openLastFileOnStartup: false })
    const { t, win } = await start(userData)

    await win.getByTestId('recent-open').filter({ hasText: 'Нет' }).click()
    await expect
        .poll(async () => (await t.dialogs()).filter((d) => d.kind === 'box').length)
        .toBe(1)
    expect((await t.dialogs()).find((d) => d.kind === 'box')!.detail).toContain('не найден')
    await expect(win.getByTestId('recent-item')).toHaveCount(2)

    await win.getByTestId('recent-open').filter({ hasText: 'Открой меня' }).click()
    await expect(win.getByTestId('message').filter({ hasText: 'Текст «Открой меня»' })).toHaveCount(
        1
    )
})

test('an entry can be removed, and the whole list cleared', async () => {
    const dir = await folder('bc-recent-')
    const files = [
        await discussion(dir, 'А'),
        await discussion(dir, 'Б'),
        await discussion(dir, 'В')
    ]
    const userData = await profile(files, { openLastFileOnStartup: false })
    const { win } = await start(userData)

    await expect(win.getByTestId('recent-item')).toHaveCount(3)
    await win
        .getByTestId('recent-item')
        .filter({ hasText: 'Б' })
        .getByTestId('recent-remove')
        .click()
    await expect(win.getByTestId('recent-item')).toHaveCount(2)
    await expect.poll(() => readRecent(userData)).toEqual([files[0], files[2]])

    await win.getByTestId('recent-clear').click()
    await expect(win.getByTestId('recent-files')).toHaveCount(0)
    await expect.poll(() => readRecent(userData)).toEqual([])
    // the discussion files themselves are untouched
    for (const f of files) expect((await fs.stat(f)).isFile()).toBe(true)
})

test('opening a discussion puts it on top of the list, once', async () => {
    const dir = await folder('bc-recent-')
    const a = await discussion(dir, 'Старое')
    const b = await discussion(dir, 'Новое')
    const userData = await profile([a], { openLastFileOnStartup: false })
    const { win } = await start(userData)

    await win.evaluate((p) => window.branchchat.openPath(p), b)
    await expect.poll(() => readRecent(userData)).toEqual([b, a])
    await win.evaluate((p) => window.branchchat.openPath(p), a)
    await expect.poll(() => readRecent(userData)).toEqual([a, b])
})

test('startup: the most recent discussion opens by itself (default)', async () => {
    const dir = await folder('bc-recent-')
    const a = await discussion(dir, 'Позавчера')
    const b = await discussion(dir, 'Вчера')
    const userData = await profile([b, a]) // no explicit setting: on by default
    const { t, win } = await start(userData)

    await expect(win.getByTestId('message').filter({ hasText: 'Текст «Вчера»' })).toHaveCount(1)
    expect(await t.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(
        1
    )
})

test('startup: nothing opens when the last file is missing, the option is off, or the list is empty', async () => {
    const dir = await folder('bc-recent-')
    const a = await discussion(dir, 'Есть')
    const gone = join(dir, 'Нет.branchchat')

    const missing = await start(await profile([gone, a])) // the newest entry is missing
    await expect(missing.win.getByTestId('launcher-new')).toBeVisible()
    await expect(missing.win.getByTestId('recent-item')).toHaveCount(2)
    await missing.t.close()
    apps.pop()

    const off = await start(await profile([a], { openLastFileOnStartup: false }))
    await expect(off.win.getByTestId('launcher-new')).toBeVisible()
    await off.t.close()
    apps.pop()

    const empty = await start(await profile(null))
    await expect(empty.win.getByTestId('launcher-new')).toBeVisible()
    await expect(empty.win.getByTestId('recent-files')).toHaveCount(0)
})

test('startup: a file given on the command line wins; the last file is not opened as well', async () => {
    const dir = await folder('bc-recent-')
    const last = await discussion(dir, 'Последнее')
    const clicked = await discussion(dir, 'Двойной щелчок')
    const { t, win } = await start(await profile([last]), [clicked])

    await expect(
        win.getByTestId('message').filter({ hasText: 'Текст «Двойной щелчок»' })
    ).toHaveCount(1)
    expect(await t.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(
        1
    )
})

test('File > Open recent lists the files and opens the chosen one', async () => {
    const dir = await folder('bc-recent-')
    const a = await discussion(dir, 'Из меню')
    const gone = join(dir, 'Пропало.branchchat')
    const { t, win } = await start(await profile([a, gone], { openLastFileOnStartup: false }))
    await expect(win.getByTestId('recent-item')).toHaveCount(2)

    const labels = (): Promise<string[]> =>
        t.app.evaluate(({ Menu }) => {
            const file = Menu.getApplicationMenu()!.items[0]!
            const recent = file.submenu!.items.find((i) => i.label === 'Открыть недавние')!
            return recent.submenu!.items.map((i) => i.label || i.type)
        })
    await expect
        .poll(labels)
        .toEqual(['Из меню', 'Пропало (не найден)', 'separator', 'Очистить список'])

    await t.app.evaluate(({ Menu }) => {
        const file = Menu.getApplicationMenu()!.items[0]!
        const recent = file.submenu!.items.find((i) => i.label === 'Открыть недавние')!
        recent.submenu!.items.find((i) => i.label === 'Из меню')!.click()
    })
    await expect(win.getByTestId('message').filter({ hasText: 'Текст «Из меню»' })).toHaveCount(1)
})

test('Settings: the startup option and the number of remembered files are saved and applied', async () => {
    const dir = await folder('bc-recent-')
    const files = await Promise.all(['1', '2', '3', '4'].map((n) => discussion(dir, `Файл ${n}`)))
    const userData = await profile(files, { openLastFileOnStartup: false })
    const { t, win } = await start(userData)
    await expect(win.getByTestId('recent-item')).toHaveCount(4)

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

    // lowering the number forgets the oldest entries
    const limit = win.getByTestId('settings-recent-limit')
    await limit.fill('2')
    await limit.press('Enter')
    await expect.poll(async () => (await saved())['recentFilesLimit']).toBe(2)
    await expect.poll(() => readRecent(userData)).toEqual([files[0], files[1]])

    // a negative or fractional number is ignored
    await limit.fill('-1')
    await limit.blur()
    await expect(limit).toHaveValue('2')
    expect((await saved())['recentFilesLimit']).toBe(2)

    await limit.fill('1.5')
    await limit.blur()
    await expect(limit).toHaveValue('2')

    // 0 keeps no list at all
    await limit.fill('0')
    await limit.press('Enter')
    await expect.poll(() => readRecent(userData)).toEqual([])
})

test('the number of remembered files is respected when files are opened', async () => {
    const dir = await folder('bc-recent-')
    const files = await Promise.all(['1', '2', '3'].map((n) => discussion(dir, `Файл ${n}`)))
    const userData = await profile([], { openLastFileOnStartup: false, recentFilesLimit: 2 })
    const { win } = await start(userData)
    for (const f of files) await win.evaluate((p) => window.branchchat.openPath(p), f)
    await expect.poll(() => readRecent(userData)).toEqual([files[2], files[1]])
})
