import { expect, test, type Page } from '@playwright/test'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { cleanup, launchApp, tempDir, type TestApp } from './helpers/app'
import { startFeed, type Feed } from './helpers/feed'

// These tests run the real electron-updater (check, download, SHA-512 verification) against a local feed that looks
// like a GitHub release. Only the final step, starting the installer, is replaced by a counter.

let t: TestApp | null = null
let feed: Feed | null = null

test.beforeEach(async () => {
    // electron-updater keeps downloads in the user's cache folder; start every test without leftovers.
    const cache = join(homedir(), '.cache')
    for (const name of await readdir(cache).catch(() => [] as string[]))
        if (/branchchat.*-updater$/i.test(name))
            await rm(join(cache, name), { recursive: true, force: true })
})
test.afterEach(async () => {
    if (t) {
        await t.close()
        await cleanup(t.userData)
        t = null
    }
    await feed?.close()
    feed = null
})

async function start(
    feedOptions: Parameters<typeof startFeed>[0],
    extraEnv: Record<string, string> = {},
    userData?: string
): Promise<{ app: TestApp; win: Page }> {
    feed = await startFeed(feedOptions)
    t = await launchApp({
        ...(userData ? { userData } : {}),
        env: { BRANCHCHAT_E2E_UPDATE_FEED: feed.url, ...extraEnv }
    })
    const win = await t.app.firstWindow()
    await expect(win.getByTestId('launcher-new')).toBeVisible()
    return { app: t, win }
}

/** Help > Check for updates. */
async function checkManually(app: TestApp): Promise<void> {
    await app.app.evaluate(({ Menu }) => {
        const help = Menu.getApplicationMenu()?.items.find((i) => i.label === 'Справка')?.submenu
        help?.items.find((i) => i.label === 'Проверить обновления…')?.click()
    })
}

const installRequests = (app: TestApp): Promise<number> =>
    app.app.evaluate(
        () => (globalThis as unknown as { __installRequests: number }).__installRequests
    )
const openedLinks = (app: TestApp): Promise<string[]> =>
    app.app.evaluate(() => (globalThis as unknown as { __openedLinks: string[] }).__openedLinks)

test('manual check finds a newer release, shows its details, downloads, verifies and installs on request (FR-096 to FR-100)', async () => {
    const { app, win } = await start({ version: '0.2.0' })
    await checkManually(app)

    const dialog = win.getByTestId('update-dialog')
    await expect(dialog).toHaveAttribute('data-phase', 'available')
    await expect(dialog).toContainText('Доступна версия 0.2.0')
    await expect(dialog).toContainText('Сейчас установлена версия 0.1.0')
    await expect(win.getByTestId('update-date')).toContainText('2026')
    await expect(win.getByTestId('update-size')).toHaveText('300 КБ')
    // Notes arrive as HTML from GitHub and are shown as plain text.
    const notes = win.getByTestId('update-notes')
    await expect(notes).toContainText('Что нового')
    await expect(notes).toContainText('• Первое')
    expect(await notes.innerHTML()).not.toContain('<')

    expect(await installRequests(app)).toBe(0)
    await win.getByTestId('update-download').click()
    await expect(dialog).toHaveAttribute('data-phase', 'ready')
    await expect(win.getByTestId('update-ready')).toContainText('не изменятся')
    expect(await installRequests(app)).toBe(0) // downloaded, but nothing installed yet (FR-106)

    await win.getByTestId('update-install').click()
    await expect.poll(() => installRequests(app)).toBe(1)

    // The release file was fetched exactly as published.
    expect(feed?.requests.some((r) => r.startsWith('GET /BranchChat-Setup.exe'))).toBe(true)
})

test('"Later" keeps the dialog away; a banner offers the details again', async () => {
    const { app, win } = await start({ version: '0.2.0' })
    await checkManually(app)
    await win.getByTestId('update-later').click()
    await expect(win.getByTestId('update-dialog')).toHaveCount(0)
    await expect(win.getByTestId('update-banner')).toContainText('0.2.0')
    await win.getByTestId('update-banner-details').click()
    await expect(win.getByTestId('update-dialog')).toHaveAttribute('data-phase', 'available')
})

test('the release page opens in the browser from the dialog (FR-099)', async () => {
    const { app, win } = await start({ version: '0.2.0' })
    await checkManually(app)
    await win.getByTestId('update-open-page').click()
    await expect
        .poll(() => openedLinks(app))
        .toContain('https://github.com/test-owner/branchchat/releases/tag/v0.2.0')
})

test('a corrupted download is rejected: reported, never installable, and the app keeps working (FR-102, FR-105)', async () => {
    const { app, win } = await start({ version: '0.2.0', corrupt: true })
    await checkManually(app)
    await win.getByTestId('update-download').click()

    const dialog = win.getByTestId('update-dialog')
    await expect(dialog).toHaveAttribute('data-phase', 'error')
    await expect(win.getByTestId('update-error')).toContainText('не прошёл проверку целостности')
    await expect(win.getByTestId('update-install')).toHaveCount(0)
    expect(await installRequests(app)).toBe(0)

    await win.getByTestId('update-close').click()
    await expect(dialog).toHaveCount(0)
    await expect(win.getByTestId('launcher-new')).toBeEnabled() // the application still works
})

test('the current version, and older versions, are reported as up to date; no downgrade (FR-094)', async () => {
    for (const version of ['0.1.0', '0.0.9']) {
        const { app, win } = await start({ version })
        await checkManually(app)
        await expect(win.getByTestId('update-up-to-date')).toContainText(
            'Установлена последняя версия (0.1.0)'
        )
        await win.getByTestId('update-close').click()
        await t?.close()
        await feed?.close()
        t = null
        feed = null
    }
})

test('offline: a manual check explains the problem, an automatic check stays silent (FR-105)', async () => {
    // Manual
    const dead = await startFeed({ version: '0.2.0' })
    const deadUrl = dead.url
    await dead.close() // nothing listens on this address any more
    t = await launchApp({
        env: { BRANCHCHAT_E2E_UPDATE_FEED: deadUrl, BRANCHCHAT_E2E_UPDATE_STARTUP_MS: '300' }
    })
    const win = await t.app.firstWindow()
    await expect(win.getByTestId('launcher-new')).toBeVisible()
    await new Promise((r) => setTimeout(r, 2500)) // the automatic check ran meanwhile and failed
    await expect(win.getByTestId('update-dialog')).toHaveCount(0)
    await expect(win.getByTestId('update-banner')).toHaveCount(0)
    await expect(win.getByTestId('app-error')).toHaveCount(0)

    await checkManually(t)
    await expect(win.getByTestId('update-error')).toContainText('Не удалось проверить обновления')
    await expect(win.getByTestId('update-retry')).toBeVisible()
    await win.getByTestId('update-close').click()
    await expect(win.getByTestId('launcher-new')).toBeEnabled()
})

test('the automatic check at startup shows only a banner, no dialog (FR-095)', async () => {
    const { win } = await start({ version: '0.2.0' }, { BRANCHCHAT_E2E_UPDATE_STARTUP_MS: '300' })
    await expect(win.getByTestId('update-banner')).toContainText(
        'Доступно обновление BranchChat 0.2.0'
    )
    await expect(win.getByTestId('update-dialog')).toHaveCount(0)
    await win.getByRole('button', { name: 'Скрыть' }).click()
    await expect(win.getByTestId('update-banner')).toHaveCount(0)
})

test('automatic checks can be switched off in Settings and stay off (FR-097)', async () => {
    const userData = await tempDir('bc-profile-')
    const { app, win } = await start(
        { version: '0.2.0' },
        { BRANCHCHAT_E2E_UPDATE_STARTUP_MS: '60000' },
        userData
    )

    await app.app.evaluate(({ Menu }) => {
        Menu.getApplicationMenu()
            ?.items[0]?.submenu?.items.find((i) => i.label === 'Настройки…')
            ?.click()
    })
    const box = win.getByTestId('settings-auto-update')
    await expect(box).toBeChecked() // on by default
    await box.click()
    await expect(box).not.toBeChecked()
    await expect
        .poll(
            async () =>
                JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8')).autoUpdateCheck
        )
        .toBe(false)
    await t?.close()
    t = null

    // Restart with the stored setting and a very short startup delay: no request reaches the feed.
    const before = feed?.requests.length ?? 0
    t = await launchApp({
        userData,
        env: {
            BRANCHCHAT_E2E_UPDATE_FEED: feed?.url ?? '',
            BRANCHCHAT_E2E_UPDATE_STARTUP_MS: '300'
        }
    })
    const win2 = await t.app.firstWindow()
    await expect(win2.getByTestId('launcher-new')).toBeVisible()
    await new Promise((r) => setTimeout(r, 2000))
    expect(feed?.requests.length).toBe(before)
    await expect(win2.getByTestId('update-banner')).toHaveCount(0)
})

test('update requests carry nothing about documents or people (NFR-008)', async () => {
    const userData = await tempDir('bc-profile-')
    await mkdir(userData, { recursive: true })
    await writeFile(
        join(userData, 'settings.json'),
        JSON.stringify({
            participantId: 'secret-participant-id-123',
            displayName: 'СекретноеИмяУчастника'
        })
    )
    const { app, win } = await start({ version: '0.2.0' }, {}, userData)
    await checkManually(app)
    await win.getByTestId('update-download').click()
    await expect(win.getByTestId('update-dialog')).toHaveAttribute('data-phase', 'ready')

    expect(feed?.requests.length).toBeGreaterThan(1)
    for (const request of feed?.requests ?? []) {
        expect(request).not.toContain('secret-participant-id-123')
        expect(request).not.toContain('СекретноеИмяУчастника')
        expect(request).not.toContain(encodeURIComponent('СекретноеИмяУчастника'))
        expect(request.toLowerCase()).not.toContain('cookie')
        expect(request.toLowerCase()).not.toContain('authorization')
    }
})
