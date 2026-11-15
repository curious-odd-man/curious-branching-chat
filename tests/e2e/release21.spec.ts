import { expect, test, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { collect, openEntry, scanZip } from '../../src/main/document/zip'
import { cleanup, launchApp, tempDir, type TestApp } from './helpers/app'
import { writeBigDiscussion } from './helpers/bigFile'
import { localDayKey } from '../../src/shared/domain/days'

// Release 2.1: log file and report (phase 1), text size and shortcuts (phase 2), dates (phase 3).

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
async function createDiscussion(t: TestApp, win: Page, file: string): Promise<void> {
    await t.answer({ save: [file] })
    await win.getByTestId('launcher-new').click()
    const prompt = win.getByTestId('name-input')
    if (await prompt.isVisible().catch(() => false)) {
        await prompt.fill('Анна')
        await win.getByTestId('name-confirm').click()
    }
    await expect(win.getByTestId('composer')).toBeVisible()
}
async function send(win: Page, text: string): Promise<void> {
    await win.getByTestId('composer').fill(text)
    await win.getByTestId('send').click()
}
/** Clicks a menu item by its label, in any top-level menu. */
async function clickMenu(t: TestApp, label: string): Promise<void> {
    await t.app.evaluate(({ Menu }, l) => {
        for (const top of Menu.getApplicationMenu()?.items ?? [])
            for (const item of top.submenu?.items ?? []) if (item.label === l) return item.click()
        throw new Error(`no menu item ${l}`)
    }, label)
}
async function zipEntries(path: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {}
    await scanZip(path, async (entry, zip) => {
        out[entry.fileName] = (await collect(await openEntry(zip, entry))).toString('utf8')
    })
    return out
}

test('phase 1: the log file, and a report without message text, names, or keys (FR-321 to FR-323)', async () => {
    const dir = await workDir()
    const { t, win } = await start()
    await createDiscussion(t, win, join(dir, 'Тайные планы.branchchat'))
    await send(win, 'Совершенно секретный текст')
    await expect(win.getByTestId('message')).toHaveCount(1)

    // the log file exists and has the start line
    const logFile = join(t.userData, 'logs', 'main.log')
    await expect
        .poll(() => fs.readFile(logFile, 'utf8').catch(() => ''), { timeout: 10_000 })
        .toContain('[app] start')

    // "Справка > Сохранить отчёт…": first what is in it, then where to save it
    const report = join(dir, 'отчёт.zip')
    await t.answer({ box: [0], save: [report] })
    await clickMenu(t, 'Сохранить отчёт…')
    await expect
        .poll(
            () =>
                fs
                    .stat(report)
                    .then(() => true)
                    .catch(() => false),
            { timeout: 10_000 }
        )
        .toBe(true)
    const shown = (await t.dialogs()).filter((d) => d.kind === 'box')
    expect(shown[0]?.detail).toContain('нет текста сообщений')
    await expect
        .poll(async () => (await t.dialogs()).filter((d) => d.kind === 'box').length)
        .toBe(2)

    const entries = await zipEntries(report)
    expect(Object.keys(entries)).toEqual(
        expect.arrayContaining(['info.json', 'logs/main.log', 'settings.json'])
    )
    const all = Object.values(entries).join('\n')
    expect(all).not.toContain('Совершенно секретный текст')
    expect(all).not.toContain('Анна')
    const keyFile = await fs.readdir(join(t.userData, 'keys')).catch(() => [])
    for (const name of keyFile) {
        const text = await fs.readFile(join(t.userData, 'keys', name), 'utf8')
        for (const secret of text.match(/[A-Za-z0-9+/]{40,}={0,2}/g) ?? [])
            expect(all).not.toContain(secret)
    }
    expect(JSON.parse(entries['info.json']!)).toMatchObject({ appVersion: expect.any(String) })
})

test('phase 1: "Отмена" in the report dialog saves nothing', async () => {
    const { t } = await start()
    await t.answer({ box: [1] })
    await clickMenu(t, 'Сохранить отчёт…')
    await expect
        .poll(async () => (await t.dialogs()).filter((d) => d.kind === 'box').length)
        .toBe(1)
    expect((await t.dialogs()).filter((d) => d.kind === 'save')).toHaveLength(0)
})

const zoomFactor = (t: TestApp): Promise<number> =>
    t.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor()
    )

test('phase 2: Ctrl+plus, Ctrl+minus, Ctrl+0 change the text size of the window; it is kept (FR-301, FR-302)', async () => {
    const { t, win } = await start()
    await expect(win.getByTestId('launcher-new')).toBeVisible()
    expect(await zoomFactor(t)).toBeCloseTo(1)

    await win.keyboard.press('Control+Equal')
    await win.keyboard.press('Control+Equal')
    await expect.poll(() => zoomFactor(t)).toBeCloseTo(1.2)
    await win.keyboard.press('Control+Minus')
    await expect.poll(() => zoomFactor(t)).toBeCloseTo(1.1)

    // the Settings dialog shows the size and can reset it
    await clickMenu(t, 'Настройки…')
    await expect(win.getByTestId('text-size-value')).toHaveText('110 %')
    await win.getByTestId('text-size-larger').click()
    await expect(win.getByTestId('text-size-value')).toHaveText('120 %')
    await expect.poll(() => zoomFactor(t)).toBeCloseTo(1.2)
    await win.keyboard.press('Escape')

    // kept after a restart
    const userData = t.userData
    await t.close()
    apps.splice(apps.indexOf(t), 1)
    const again = await start({ userData })
    await expect(again.win.getByTestId('launcher-new')).toBeVisible()
    await expect.poll(() => zoomFactor(again.t)).toBeCloseTo(1.2)
    await again.win.keyboard.press('Control+0')
    await expect.poll(() => zoomFactor(again.t)).toBeCloseTo(1)
})

test('phase 2: F1 shows every shortcut, grouped (FR-311)', async () => {
    const { t, win } = await start()
    await expect(win.getByTestId('launcher-new')).toBeVisible()
    await clickMenu(t, 'Сочетания клавиш')
    const dialog = win.getByTestId('shortcuts-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('shortcuts-group')).toHaveCount(4)
    await expect(dialog.locator('[data-id="send"]')).toContainText('Ctrl+Enter')
    await expect(dialog.locator('[data-id="bold"]')).toContainText('Ctrl+B')
    await expect(dialog.locator('[data-id="zoomIn"]')).toContainText('Ctrl++')
    await win.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
})

test('phase 3: day separators, and "Перейти к дате…" opens the first message of a day (FR-241, FR-242)', async () => {
    const dir = await workDir()
    const file = join(dir, 'Дни.branchchat')
    // 6 messages, 12 hours apart, from 1 January 2026 09:00 UTC
    await writeBigDiscussion(file, 6, 12 * 60 * 60 * 1000)
    const times = Array.from({ length: 6 }, (_, i) =>
        new Date(Date.UTC(2026, 0, 1, 9) + i * 12 * 3600_000).toISOString()
    )
    const expectedDays = [...new Set(times.map((t) => localDayKey(t)))]

    const { t, win } = await start({ files: [file] })
    await expect(win.getByTestId('message')).toHaveCount(6)
    const separators = win.getByTestId('day-separator')
    await expect(separators).toHaveCount(expectedDays.length)
    expect(
        await separators.evaluateAll((els) => els.map((e) => e.getAttribute('data-day')))
    ).toEqual(expectedDays)
    // the current year (2026) is not shown
    await expect(separators.first()).toHaveText('1 января')

    // Ctrl+G (menu) opens the calendar at the newest month; days without messages cannot be chosen
    await clickMenu(t, 'Перейти к дате…')
    const dialog = win.getByTestId('jump-dialog')
    await expect(dialog.getByTestId('jump-month')).toHaveText('Январь 2026')
    await expect(dialog.locator('[data-day="2026-01-10"]')).toBeDisabled()
    const target = expectedDays[1]!
    await dialog.locator(`[data-day="${target}"]`).click()
    await expect(dialog).toHaveCount(0)
    const firstOfDay = times.findIndex((x) => localDayKey(x) === target)
    await expect(
        win.getByTestId('message').filter({ hasText: `Сообщение номер ${firstOfDay} ` })
    ).toBeInViewport()

    // the button in the header opens it too
    await win.getByTestId('jump-to-date').click()
    await expect(win.getByTestId('jump-dialog')).toBeVisible()
    await win.keyboard.press('Escape')
    await expect(win.getByTestId('jump-dialog')).toHaveCount(0)
})
