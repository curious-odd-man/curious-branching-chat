import { expect, test, type Page } from '@playwright/test'
import { cleanup, launchApp, type TestApp } from './helpers/app'

const EXT_KEY = 'HKCU\\Software\\Classes\\.branchchat'
const PROG_ID_KEY = 'HKCU\\Software\\Classes\\BranchChat.Discussion'
const ASKED = { 'HKCU\\Software\\BranchChat': { AssociationAsked: '1' } }

let t: TestApp | null = null
test.afterEach(async () => {
    if (t) {
        await t.close()
        await cleanup(t.userData)
        t = null
    }
})

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

test('Settings shows the association, switches it on and off, and writes only HKCU (FR-089, FR-138)', async () => {
    t = await launchApp()
    const win = await t.app.firstWindow()
    await openSettings(t, win)

    const state = win.getByTestId('settings-association-state')
    const box = win.getByTestId('settings-association')
    await expect(state).toHaveAttribute('data-state', 'off')
    await expect(box).not.toBeChecked()

    await box.click()
    await expect(box).toBeChecked()
    await expect(state).toHaveAttribute('data-state', 'on')
    const on = await t.registry()
    expect(on[EXT_KEY]).toEqual({ '': 'BranchChat.Discussion' })
    expect(on[PROG_ID_KEY]).toEqual({ '': 'Обсуждение BranchChat' })
    expect(on[`${PROG_ID_KEY}\\shell\\open\\command`]?.['']).toMatch(/^".+" "%1"$/)
    expect(on[`${PROG_ID_KEY}\\DefaultIcon`]?.['']).toMatch(/document\.ico,0$/)
    for (const key of Object.keys(on)) expect(key.startsWith('HKCU\\')).toBe(true)

    await box.click()
    await expect(box).not.toBeChecked()
    await expect(state).toHaveAttribute('data-state', 'off')
    const off = await t.registry()
    expect(off[EXT_KEY]).toBeUndefined()
    expect(off[PROG_ID_KEY]).toBeUndefined()
})

test('a file type held by another program is never taken over (FR-090)', async () => {
    const seed = {
        ...ASKED,
        [EXT_KEY]: { '': 'Other.App' },
        [`HKCU\\Software\\Classes\\Other.App\\shell\\open\\command`]: { '': 'other.exe "%1"' }
    }
    t = await launchApp({ env: { BRANCHCHAT_E2E_REGISTRY_SEED: JSON.stringify(seed) } })
    const win = await t.app.firstWindow()
    await openSettings(t, win)
    await expect(win.getByTestId('settings-association-state')).toHaveAttribute(
        'data-state',
        'other-app'
    )
    await expect(win.getByTestId('settings-association')).toBeDisabled()
    expect((await t.registry())[EXT_KEY]).toEqual({ '': 'Other.App' })
})

test('a program chosen in Windows (UserChoice) is respected too', async () => {
    const seed = {
        ...ASKED,
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.branchchat\\UserChoice':
            { ProgId: 'Applications\\notepad.exe' }
    }
    t = await launchApp({ env: { BRANCHCHAT_E2E_REGISTRY_SEED: JSON.stringify(seed) } })
    const win = await t.app.firstWindow()
    await openSettings(t, win)
    await expect(win.getByTestId('settings-association')).toBeDisabled()
    expect((await t.registry())[EXT_KEY]).toBeUndefined()
})

test('first start asks once; yes registers the association (FR-136)', async () => {
    t = await launchApp({
        env: { BRANCHCHAT_E2E_REGISTRY_SEED: '{}', BRANCHCHAT_E2E_BOX_ANSWERS: '[0]' }
    })
    await t.app.firstWindow()
    await expect
        .poll(async () => (await t!.registry())[EXT_KEY])
        .toEqual({ '': 'BranchChat.Discussion' })
    const questions = (await t.dialogs()).filter((d) => d.title?.includes('Открывать файлы'))
    expect(questions).toHaveLength(1)
    expect(questions[0]?.type).toBe('question')

    // Restarting with the same profile does not ask again, even if the registration was removed meanwhile.
    const userData = t.userData
    await t.close()
    t = await launchApp({ userData, env: { BRANCHCHAT_E2E_REGISTRY_SEED: '{}' } })
    await t.app.firstWindow()
    await new Promise((r) => setTimeout(r, 800))
    expect((await t.dialogs()).filter((d) => d.title?.includes('Открывать файлы'))).toHaveLength(0)
    expect((await t.registry())[EXT_KEY]).toBeUndefined()
})

test('first start: no registers nothing', async () => {
    t = await launchApp({
        env: { BRANCHCHAT_E2E_REGISTRY_SEED: '{}', BRANCHCHAT_E2E_BOX_ANSWERS: '[1]' }
    })
    await t.app.firstWindow()
    await expect
        .poll(
            async () =>
                (await t!.dialogs()).filter((d) => d.title?.includes('Открывать файлы')).length
        )
        .toBe(1)
    expect((await t.registry())[EXT_KEY]).toBeUndefined()
    expect((await t.registry())[PROG_ID_KEY]).toBeUndefined()
})

test('no question if the installer already asked, or another program holds the type', async () => {
    for (const seed of [
        ASKED,
        {
            [EXT_KEY]: { '': 'Other.App' },
            [`HKCU\\Software\\Classes\\Other.App\\shell\\open\\command`]: { '': 'other.exe "%1"' }
        }
    ]) {
        t = await launchApp({ env: { BRANCHCHAT_E2E_REGISTRY_SEED: JSON.stringify(seed) } })
        await t.app.firstWindow()
        await new Promise((r) => setTimeout(r, 800))
        expect(
            (await t.dialogs()).filter((d) => d.title?.includes('Открывать файлы'))
        ).toHaveLength(0)
        await t.close()
        await cleanup(t.userData)
        t = null
    }
})

test('Settings lets the person change their name, which is remembered (FR-138)', async () => {
    t = await launchApp()
    const win = await t.app.firstWindow()
    await win.evaluate(() => window.branchchat.setDisplayName('Анна'))
    await openSettings(t, win)
    await expect(win.getByTestId('settings-name')).toHaveValue('Анна')
    await win.getByTestId('settings-name').fill('Анна Иванова')
    await win.getByTestId('settings-name-save').click()
    await expect(win.getByTestId('settings-name-saved')).toBeVisible()
    const stored = await win.evaluate(() => window.branchchat.getSettings())
    expect(stored.ok && stored.data.displayName).toBe('Анна Иванова')
    await win.getByTestId('settings-close').click()
    await expect(win.getByTestId('settings-dialog')).toHaveCount(0)
})

test('a leftover plain-text value of the file type does not block the association', async () => {
    const seed = { ...ASKED, [EXT_KEY]: { '': 'Обсуждение BranchChat' } }
    t = await launchApp({ env: { BRANCHCHAT_E2E_REGISTRY_SEED: JSON.stringify(seed) } })
    const win = await t.app.firstWindow()
    await openSettings(t, win)
    await expect(win.getByTestId('settings-association-state')).toHaveAttribute('data-state', 'off')
    await expect(win.getByTestId('settings-association')).toBeEnabled()
    await win.getByTestId('settings-association').check()
    await expect(win.getByTestId('settings-association-state')).toHaveAttribute('data-state', 'on')
    expect((await t.registry())[EXT_KEY]).toEqual({ '': 'BranchChat.Discussion' })
})
