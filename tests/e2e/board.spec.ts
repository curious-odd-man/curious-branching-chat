import { expect, test, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { cleanup, launchApp, tempDir, type TestApp } from './helpers/app'
import { simple, writeDiscussionFile } from './helpers/craft'
import { libraryList } from './helpers/library'

// The list of discussions (2026-11-23): context menu, delete, archive, collapsed icons, and the stats line.

const apps: TestApp[] = []
const dirs: string[] = []
test.afterEach(async () => {
    await Promise.all(apps.splice(0).map((a) => a.close()))
    await cleanup(...dirs.splice(0))
})

async function folder(prefix = 'bc-board-'): Promise<string> {
    const d = await tempDir(prefix)
    dirs.push(d)
    return d
}
async function profile(): Promise<string> {
    const d = await folder('bc-board-profile-')
    await fs.writeFile(
        join(d, 'settings.json'),
        JSON.stringify({
            participantId: 'p-anna',
            displayName: 'Анна',
            readNoticeAcknowledged: true,
            associationAsked: true,
            openLastFileOnStartup: false
        })
    )
    return d
}
async function start(userData: string): Promise<{ t: TestApp; win: Page }> {
    const t = await launchApp({ userData })
    apps.push(t)
    return { t, win: await t.app.firstWindow() }
}
/** "Альфа" (2 messages of Boris, one read; a closed branch with 1 message of Anna) and "Бета". */
async function twoDiscussions(): Promise<{ t: TestApp; win: Page; userData: string }> {
    const dir = await folder()
    const alpha = join(dir, 'Альфа.branchchat')
    await writeDiscussionFile(
        alpha,
        [
            {
                id: 'main',
                messages: [
                    { id: 'm1', author: 'boris', content: simple('Привет') },
                    { id: 'm2', author: 'boris', content: simple('Как дела?') }
                ]
            },
            {
                id: 'branch',
                parent: 'main',
                source: 'm1',
                quote: 'Привет',
                status: 'closed',
                messages: [{ id: 'b1', author: 'anna', content: simple('Хорошо') }]
            }
        ],
        { readState: { 'p-anna': ['m1'] } }
    )
    const beta = join(dir, 'Бета.branchchat')
    await writeDiscussionFile(beta, [
        { id: 'main', messages: [{ id: 'x1', author: 'boris', content: simple('Бета') }] }
    ])
    const userData = await profile()
    const { t, win } = await start(userData)
    for (const f of [alpha, beta]) await win.evaluate((p) => window.branchchat.openPath(p), f)
    await expect(win.getByTestId('sidebar-item')).toHaveCount(2)
    return { t, win, userData }
}
const item = (win: Page, title: string) =>
    win.getByTestId('sidebar-item').filter({ hasText: title })

test('the stats line counts the messages of the whole discussion', async () => {
    const { win } = await twoDiscussions()
    await item(win, 'Альфа').getByTestId('sidebar-open').click()
    const stats = win.getByTestId('discussion-stats')
    await expect(stats.getByTestId('stats-messages')).toHaveText(
        'Сообщений: 3 (в открытых ветках: 2, в закрытых: 1)'
    )
    await expect(stats.getByTestId('stats-read')).toHaveText('Прочитано: 1, не прочитано: 1')
    await expect(stats.getByTestId('stats-text')).toHaveText(
        `Текст: ${Buffer.byteLength('ПриветКак дела?Хорошо')} Б`
    )
    await expect(stats.getByTestId('stats-files')).toHaveText('Файлы: 0 Б')
    await expect(stats.getByTestId('stats-delivery')).toHaveCount(0) // not a shared discussion
})

test('delete from the context menu: the window shows the list; the last one brings back the start screen', async () => {
    const { win, userData } = await twoDiscussions()
    await expect(win.locator('h1')).toHaveText('Бета')
    await item(win, 'Бета').click({ button: 'right' })
    await expect(win.getByTestId('context-menu')).toBeVisible()
    await win.getByTestId('menu-delete').click()
    const dialog = win.getByTestId('delete-dialog')
    await expect(dialog).toContainText('Удалить обсуждение «Бета»?')
    await dialog.getByTestId('delete-cancel').click()
    expect(libraryList(userData)).toHaveLength(2)

    await item(win, 'Бета').click({ button: 'right' })
    await win.getByTestId('menu-delete').click()
    await win.getByTestId('delete-confirm').click()
    await expect(win.getByTestId('sidebar-item')).toHaveCount(1)
    await expect(win.getByTestId('choose-hint')).toBeVisible()
    expect(libraryList(userData).map((d) => d.title)).toEqual(['Альфа'])

    // a discussion that is not on screen
    await item(win, 'Альфа').click({ button: 'right' })
    await win.getByTestId('menu-delete').click()
    await win.getByTestId('delete-confirm').click()
    await expect(win.getByTestId('launcher-new')).toBeVisible()
    expect(libraryList(userData)).toHaveLength(0)
})

test('archive: the discussion moves to the closed "Архив" group, also after a restart; restore brings it back', async () => {
    const { t, win, userData } = await twoDiscussions()
    await item(win, 'Альфа').click({ button: 'right' })
    await win.getByTestId('menu-archive').click()
    await expect(win.getByTestId('sidebar-item')).toHaveCount(1)
    await expect(win.getByTestId('sidebar-archived')).toHaveText('▸ Архив (1)')
    await t.close()
    apps.pop()

    const again = await start(userData)
    await expect(again.win.getByTestId('sidebar-item')).toHaveCount(1)
    await again.win.getByTestId('sidebar-archived').click()
    await expect(item(again.win, 'Альфа')).toHaveAttribute('data-archived', 'true')
    await item(again.win, 'Альфа').click({ button: 'right' })
    await again.win.getByTestId('menu-restore').click()
    await expect(again.win.getByTestId('sidebar-archived')).toHaveCount(0)
    await expect(again.win.getByTestId('sidebar-item')).toHaveCount(2)
})

test('the "+" menu of the collapsed list creates a discussion; icons show initials and unread counts', async () => {
    const { win } = await twoDiscussions()
    await win.getByTestId('sidebar-hide').click()
    const alpha = win.locator('[data-testid=rail-item][title="Альфа"]')
    await expect(alpha).toHaveText('А1')
    await expect(alpha).toHaveAttribute('aria-label', 'Альфа, не прочитано: 1')
    await alpha.click()
    await expect(win.locator('h1')).toHaveText('Альфа')

    await win.getByTestId('sidebar-add').click()
    await win.getByTestId('menu-add-local').click()
    await win.getByTestId('new-title-input').fill('Гамма')
    await win.getByTestId('new-title-confirm').click()
    await expect(win.locator('h1')).toHaveText('Гамма')
    await expect(win.getByTestId('rail-item')).toHaveCount(3)
    await expect(win.locator('[data-testid=rail-item][title="Гамма"]')).toHaveAttribute(
        'aria-current',
        'true'
    )
})
