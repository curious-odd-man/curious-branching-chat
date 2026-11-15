import { expect, test, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { cleanup, launchApp, tempDir, type TestApp } from './helpers/app'
import { newDiscussion, readLibrary } from './helpers/library'

// FR-207 to FR-209: backups of the library, restore, the backup folder, and a damaged library at start.

const apps: TestApp[] = []
const dirs: string[] = []
test.afterEach(async () => {
    await Promise.all(apps.splice(0).map((a) => a.close()))
    await cleanup(...dirs.splice(0))
})

async function folder(prefix = 'bc-e2e-'): Promise<string> {
    const d = await tempDir(prefix)
    dirs.push(d)
    return d
}
async function profile(): Promise<string> {
    const d = await folder('bc-profile-')
    await fs.writeFile(
        join(d, 'settings.json'),
        JSON.stringify({
            participantId: 'p-anna',
            displayName: 'Анна',
            readNoticeAcknowledged: true
        })
    )
    return d
}
async function start(
    userData: string,
    env: Record<string, string> = {}
): Promise<{ t: TestApp; win: Page }> {
    const t = await launchApp({ userData, env })
    apps.push(t)
    return { t, win: await t.app.firstWindow() }
}
async function send(win: Page, text: string): Promise<void> {
    await win.getByTestId('composer').fill(text)
    await win.getByTestId('send').click()
    await expect(win.getByTestId('message').filter({ hasText: text })).toHaveCount(1)
    await expect(win.getByTestId('status')).toHaveText('Сохранено')
}
async function clickMenu(t: TestApp, label: string): Promise<void> {
    await t.app.evaluate(({ Menu }, l) => {
        Menu.getApplicationMenu()!
            .items[0]!.submenu!.items.find((i) => i.label === l)!
            .click()
    }, label)
}
async function backupNowInSettings(t: TestApp, win: Page): Promise<void> {
    await clickMenu(t, 'Настройки…')
    await expect(win.getByTestId('settings-backup')).toBeVisible()
    await expect(win.getByTestId('backup-not-encrypted')).toContainText('без шифрования')
    await win.getByTestId('backup-now').click()
    await expect(win.getByTestId('backup-message')).toContainText('Копия сохранена')
    await expect(win.getByTestId('backup-last')).toContainText('Последняя копия')
    await win.getByTestId('settings-close').click()
}

test('a backup now, a later message, then a restore: the library is as it was, and the replaced one is a backup (FR-207)', async () => {
    const userData = await profile()
    const { t, win } = await start(userData)
    await newDiscussion(win, 'Резерв')
    await send(win, 'до копии')
    await backupNowInSettings(t, win)
    await send(win, 'после копии')

    await clickMenu(t, 'Восстановить из резервной копии…')
    const dialog = win.getByTestId('restore-dialog')
    await expect(dialog.getByTestId('restore-item')).toHaveCount(1)
    await expect(dialog.getByTestId('restore-item')).toContainText('вручную')
    await expect(dialog.getByTestId('restore-item')).toContainText('сообщений: 1')
    await t.answer({ box: [0] }) // "Восстановить" in the confirmation
    const exited = new Promise<void>((resolve) => t.app.process().once('exit', () => resolve()))
    await dialog.getByTestId('restore-confirm').click()
    await exited // test builds end instead of restarting
    apps.splice(apps.indexOf(t), 1)

    const again = await start(userData)
    await expect(again.win.getByTestId('message').filter({ hasText: 'до копии' })).toHaveCount(1)
    await expect(again.win.getByTestId('message').filter({ hasText: 'после копии' })).toHaveCount(0)
    await clickMenu(again.t, 'Восстановить из резервной копии…')
    const items = again.win.getByTestId('restore-dialog').getByTestId('restore-item')
    await expect(items).toHaveCount(2)
    await expect(items.first()).toContainText('перед восстановлением')
    await expect(items.first()).toContainText('сообщений: 2')
})

test('a backup folder: one warning about cloud folders, then backups go there too (FR-207, FR-209)', async () => {
    const userData = await profile()
    const cloud = await folder('bc-cloud-')
    const { t, win } = await start(userData)
    await newDiscussion(win, 'Облако')
    await clickMenu(t, 'Настройки…')
    await t.answer({ open: [cloud], box: [0] })
    await win.getByTestId('backup-pick-folder').click()
    await expect(win.getByTestId('backup-folder')).toHaveText(cloud)
    const warning = (await t.dialogs()).filter((d) => d.kind === 'box')
    expect(warning).toHaveLength(1)
    expect(warning[0]!.message).toContain('облачн')
    await win.getByTestId('backup-now').click()
    await expect(win.getByTestId('backup-message')).toContainText('Копия сохранена')
    const inCloud = (await fs.readdir(join(cloud, 'BranchChat backups'))).filter((n) =>
        /^\d{4}-/.test(n)
    )
    expect(inCloud).toHaveLength(1)
    // choosing again asks no second time
    await t.answer({ open: [cloud] })
    await win.getByTestId('backup-pick-folder').click()
    await expect(win.getByTestId('backup-folder')).toHaveText(cloud)
    expect((await t.dialogs()).filter((d) => d.kind === 'box')).toHaveLength(1)
    await win.getByTestId('backup-clear-folder').click()
    await expect(win.getByTestId('backup-folder')).toHaveText('не выбрана')
})

test('a damaged library at start: it is kept, and the last backup is restored after the question (FR-208)', async () => {
    const userData = await profile()
    const first = await start(userData)
    await newDiscussion(first.win, 'Важное')
    await send(first.win, 'сохранено в копии')
    await backupNowInSettings(first.t, first.win)
    await first.t.close()
    apps.splice(apps.indexOf(first.t), 1)
    await fs.writeFile(join(userData, 'library.sqlite'), 'damaged by a disk error')
    for (const suffix of ['-wal', '-shm'])
        await fs.rm(join(userData, `library.sqlite${suffix}`), { force: true })

    const again = await start(userData, { BRANCHCHAT_E2E_BOX_ANSWERS: '[0]' })
    await expect(
        again.win.getByTestId('message').filter({ hasText: 'сохранено в копии' })
    ).toHaveCount(1)
    const box = (await again.t.dialogs()).find((d) => d.kind === 'box')!
    expect(box.message).toBe('Библиотека обсуждений повреждена')
    expect(box.detail).toContain('резервную копию')
    const kept = (await fs.readdir(userData)).filter((n) => n.startsWith('library.damaged-'))
    expect(kept).toHaveLength(1)
    expect(await fs.readFile(join(userData, kept[0]!), 'utf8')).toBe('damaged by a disk error')
    expect(readLibrary(userData, 'Важное').discussion.threads[0]!.messages).toHaveLength(1)
})
