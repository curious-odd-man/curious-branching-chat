import { expect, test, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { cleanup, launchApp, tempDir, type TestApp } from './helpers/app'

const apps: TestApp[] = []
const dirs: string[] = []
test.afterEach(async () => {
    await Promise.all(apps.splice(0).map((a) => a.close()))
    await cleanup(...dirs.splice(0))
})

async function profile(settings: Record<string, unknown>): Promise<string> {
    const dir = await tempDir('bc-profile-')
    dirs.push(dir)
    await fs.writeFile(
        join(dir, 'settings.json'),
        JSON.stringify({ participantId: 'p-anna', openLastFileOnStartup: false, ...settings })
    )
    return dir
}

async function start(
    userData: string,
    env: Record<string, string> = {}
): Promise<{ t: TestApp; win: Page }> {
    const t = await launchApp({ userData, env })
    apps.push(t)
    return { t, win: await t.app.firstWindow() }
}

/** File > Settings… (the menu command races the page subscribing to it at startup, so retry). */
async function openSettings(app: TestApp, win: Page): Promise<void> {
    await expect(async () => {
        await app.app.evaluate(({ Menu }) => {
            const file = Menu.getApplicationMenu()?.items[0]?.submenu
            file?.items.find((i) => i.label === 'Настройки…')?.click()
        })
        await expect(win.getByTestId('settings-dialog')).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10_000 })
}

const GROUPED = /^[0-9A-F]{4}( [0-9A-F]{4}){7}$/

test('Settings creates the key on first use and shows the same fingerprint after a restart (FR-155, FR-157)', async () => {
    const userData = await profile({ displayName: 'Анна' })
    let { t, win } = await start(userData)
    // nothing is created before the key is used
    await expect(fs.access(join(userData, 'keys', 'identity.json'))).rejects.toThrow()
    await openSettings(t, win)
    const fingerprint = win.getByTestId('identity-fingerprint')
    await expect(fingerprint).toHaveText(GROUPED)
    const first = await fingerprint.textContent()
    await expect(win.getByTestId('identity-replaced')).toHaveCount(0)

    // the key file holds only protected secrets (test builds protect with a stand-in for DPAPI)
    const stored = JSON.parse(
        await fs.readFile(join(userData, 'keys', 'identity.json'), 'utf8')
    ) as {
        participantId: string
        protectedSecret: string
    }
    expect(stored.participantId).toBe('p-anna')
    expect(Buffer.from(stored.protectedSecret, 'base64').subarray(0, 14).toString()).toBe(
        'E2E-PROTECTED:'
    )

    await t.close()
    apps.splice(0)
    ;({ t, win } = await start(userData))
    await openSettings(t, win)
    await expect(win.getByTestId('identity-fingerprint')).toHaveText(first!)
})

test('copy puts the signed public key on the clipboard; save writes a .bckey file (FR-157)', async () => {
    const userData = await profile({ displayName: 'Анна' })
    const out = await tempDir()
    dirs.push(out)
    const { t, win } = await start(userData)
    await openSettings(t, win)
    const fingerprint = (await win.getByTestId('identity-fingerprint').textContent())!.replace(
        / /g,
        ''
    )

    await win.getByTestId('identity-copy').click()
    await expect(win.getByTestId('identity-message')).toHaveText(/скопирован/)
    const text = await t.app.evaluate(({ clipboard }) => clipboard.readText())
    expect(text).toMatch(/^BRANCHCHAT-KEY-1:[A-Za-z0-9_-]+$/)
    const fromText = JSON.parse(
        Buffer.from(text.slice('BRANCHCHAT-KEY-1:'.length), 'base64url').toString('utf8')
    ) as Record<string, string>
    expect(fromText).toMatchObject({
        format: 'branchchat-key',
        participantId: 'p-anna',
        displayName: 'Анна',
        fingerprint
    })
    expect(Object.keys(fromText)).not.toContain('protectedSecret')

    const file = join(out, 'Анна.bckey')
    await t.answer({ save: [file] })
    await win.getByTestId('identity-save').click()
    await expect(win.getByTestId('identity-message')).toHaveText(/сохранён/)
    const saved = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, string>
    expect(saved['fingerprint']).toBe(fingerprint)
    expect(saved['signature']).toMatch(/==$/)

    // cancelling the save dialog writes nothing and shows no message
    await win.getByTestId('identity-copy').click()
    await win.getByTestId('identity-save').click()
    await expect(win.getByTestId('identity-message')).toHaveCount(0)
})

test('without a name the key cannot be passed on yet', async () => {
    const { t, win } = await start(await profile({}))
    await openSettings(t, win)
    await expect(win.getByTestId('identity-fingerprint')).toHaveText(GROUPED)
    await expect(win.getByTestId('identity-name-first')).toBeVisible()
    await expect(win.getByTestId('identity-copy')).toBeDisabled()
    await expect(win.getByTestId('identity-save')).toBeDisabled()
})

test('without Windows data protection no key is created and Settings says why (FR-156)', async () => {
    const userData = await profile({ displayName: 'Анна' })
    const { t, win } = await start(userData, { BRANCHCHAT_E2E_KEYS: 'unavailable' })
    await openSettings(t, win)
    await expect(win.getByTestId('identity-unavailable')).toBeVisible()
    await expect(win.getByTestId('identity-fingerprint')).toHaveCount(0)
    await expect(fs.access(join(userData, 'keys', 'identity.json'))).rejects.toThrow()
})
