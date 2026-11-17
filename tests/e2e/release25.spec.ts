import { expect, test, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { cleanup, launchApp, tempDir, type TestApp } from './helpers/app'

// Release 2.5: the English user interface (FR-291 to FR-295).

const apps: TestApp[] = []
const dirs: string[] = []
test.afterEach(async () => {
    await Promise.all(apps.splice(0).map((a) => a.close()))
    await cleanup(...dirs.splice(0))
})

async function profile(settings: Record<string, unknown> = {}): Promise<string> {
    const d = await tempDir('bc-profile-')
    dirs.push(d)
    await fs.writeFile(
        join(d, 'settings.json'),
        JSON.stringify({
            participantId: 'p-anna',
            displayName: 'Anna',
            readNoticeAcknowledged: true,
            openLastFileOnStartup: false,
            ...settings
        })
    )
    return d
}
async function start(userData: string): Promise<{ t: TestApp; win: Page }> {
    const t = await launchApp({ userData })
    apps.push(t)
    return { t, win: await t.app.firstWindow() }
}
const menuLabels = (t: TestApp): Promise<string[]> =>
    t.app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((i) => i.label) ?? [])

test('the default is Russian; "Язык / Language" applies after a restart (FR-292, FR-293)', async () => {
    const userData = await profile()
    const first = await start(userData)
    await expect(first.win.getByTestId('launcher-new')).toHaveText('Новое обсуждение')
    expect(await menuLabels(first.t)).toContain('Файл')
    expect(await first.win.evaluate(() => document.documentElement.lang)).toBe('ru')

    // Settings: English is chosen; nothing changes until the restart
    await first.t.app.evaluate(({ Menu }) => {
        const file = Menu.getApplicationMenu()?.items[0]?.submenu
        file?.items.find((i) => i.label === 'Настройки…')?.click()
    })
    await first.win.getByTestId('settings-language-en').click()
    await expect(first.win.getByTestId('settings-language-en')).toBeChecked()
    await expect(first.win.getByTestId('settings-restart')).toHaveText('Перезапустить сейчас')
    await expect(first.win.getByTestId('launcher-new')).toHaveText('Новое обсуждение')
    const settings = JSON.parse(await fs.readFile(join(userData, 'settings.json'), 'utf8'))
    expect(settings.language).toBe('en')
    // "Restart now" ends the app (a test build does not start it again)
    await first.win.getByTestId('settings-restart').click()
    await expect.poll(() => first.t.app.windows().length, { timeout: 10_000 }).toBe(0)
    apps.splice(apps.indexOf(first.t), 1)

    const { t, win } = await start(userData)
    await expect(win.getByTestId('launcher-new')).toHaveText('New discussion')
    expect(await menuLabels(t)).toEqual(expect.arrayContaining(['File', 'Edit', 'View', 'Help']))
    expect(await win.evaluate(() => document.documentElement.lang)).toBe('en')
})

test('English: a discussion, an error text, dates, and the text of messages is not translated (FR-291, FR-295)', async () => {
    const { win } = await start(await profile({ language: 'en' }))
    await win.getByTestId('launcher-new').click()
    await expect(win.getByTestId('new-title-input')).toBeVisible()
    await win.getByTestId('new-title-input').fill('Планы')
    await win.getByTestId('new-title-confirm').click()
    await expect(win.getByTestId('composer')).toBeVisible()
    await expect(win.getByTestId('send')).toHaveText('Send')
    await win.getByTestId('composer').fill('Привет, это текст по-русски')
    await win.getByTestId('send').click()
    const m = win.getByTestId('message').filter({ hasText: 'Привет, это текст по-русски' })
    await expect(m).toBeVisible()
    await expect(win.getByTestId('day-separator').first()).toHaveText('Today')
    await expect(win.getByTestId('status')).toHaveText('Saved')
    const r = await win.evaluate(() => window.branchchat.openPath('/no/such/file.branchchat'))
    expect(JSON.stringify(r)).not.toMatch(/[А-Яа-я]/)
})
