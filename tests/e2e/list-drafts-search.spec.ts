import { expect, test, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { cleanup, launchApp, tempDir, type TestApp } from './helpers/app'
import { simple, writeDiscussionFile, type CraftMessage } from './helpers/craft'

// The discussion list in the window (FR-221 to FR-225), drafts (FR-251 to FR-254), search (FR-211 to
// FR-215), and the branch map (FR-271 to FR-273).

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
async function profile(settings: Record<string, unknown> = {}): Promise<string> {
    const d = await folder('bc-profile-')
    await fs.writeFile(
        join(d, 'settings.json'),
        JSON.stringify({
            participantId: 'p-anna',
            displayName: 'Анна',
            readNoticeAcknowledged: true,
            openLastFileOnStartup: false,
            ...settings
        })
    )
    return d
}
async function start(userData: string, files: string[] = []): Promise<{ t: TestApp; win: Page }> {
    const t = await launchApp({ userData, files })
    apps.push(t)
    return { t, win: await t.app.firstWindow() }
}
const many = (prefix: string, n: number, author: 'anna' | 'boris' = 'boris'): CraftMessage[] =>
    Array.from({ length: n }, (_, i) => ({
        id: `${prefix}${i}`,
        author,
        content: simple(`${prefix} сообщение ${i}`)
    }))

/** Three discussions in the library of a new profile: "Альфа" (with a branch), "Бета", "Гамма". */
async function threeDiscussions(): Promise<{ t: TestApp; win: Page; userData: string }> {
    const dir = await folder()
    const files: string[] = []
    for (const [name, extra] of [
        ['Альфа', true],
        ['Бета', false],
        ['Гамма', false]
    ] as const) {
        const file = join(dir, `${name}.branchchat`)
        await writeDiscussionFile(
            file,
            [
                {
                    id: 'main',
                    messages: [
                        ...many(`${name}-`, 30),
                        ...(name === 'Бета'
                            ? [
                                  {
                                      id: 'ezh',
                                      author: 'boris' as const,
                                      content: simple('Вчера видели ЁЖИКА у дороги')
                                  }
                              ]
                            : [])
                    ]
                },
                ...(extra
                    ? [
                          {
                              id: 'branch',
                              parent: 'main',
                              source: `${name}-0`,
                              quote: name,
                              title: 'Ветка Альфы',
                              status: 'closed' as const,
                              messages: many('ветка-', 3, 'anna')
                          }
                      ]
                    : [])
            ],
            { readState: { 'p-anna': [] } }
        )
        files.push(file)
    }
    const userData = await profile()
    const { t, win } = await start(userData)
    for (const f of files) await win.evaluate((p) => window.branchchat.openPath(p), f)
    return { t, win, userData }
}
const sidebarItem = (win: Page, title: string) =>
    win.getByTestId('sidebar-item').filter({ hasText: title })

test('the list in the window: unread counts, switching in place, the branch kept, filter, sort, collapse (FR-221 to FR-224)', async () => {
    const { t, win, userData } = await threeDiscussions()
    await expect(win.locator('h1')).toHaveText('Гамма')
    await expect(win.getByTestId('sidebar-item')).toHaveCount(3)
    await expect(sidebarItem(win, 'Альфа').getByTestId('sidebar-unread')).toHaveText('30')
    await expect(sidebarItem(win, 'Бета').getByTestId('sidebar-unread')).toHaveText('31')
    expect(t.app.windows()).toHaveLength(1)

    // open "Альфа" in place, go to its branch, then to "Бета" and back: the branch is still open
    await sidebarItem(win, 'Альфа').getByTestId('sidebar-open').click()
    await expect(win.locator('h1')).toHaveText('Альфа')
    await expect(sidebarItem(win, 'Альфа')).toHaveClass(/current/)
    await win.locator('[data-testid=panel-branch][data-thread-id=branch]').click()
    await expect(win.getByTestId('thread')).toHaveAttribute('data-thread-id', 'branch')
    await sidebarItem(win, 'Бета').getByTestId('sidebar-open').click()
    await expect(win.locator('h1')).toHaveText('Бета')
    await sidebarItem(win, 'Альфа').getByTestId('sidebar-open').click()
    await expect(win.getByTestId('thread')).toHaveAttribute('data-thread-id', 'branch')
    expect(t.app.windows()).toHaveLength(1)

    // filter (ё = е, any case) and sort by name
    await win.getByTestId('sidebar-filter').fill('БЕТ')
    await expect(win.getByTestId('sidebar-item')).toHaveCount(1)
    await win.getByTestId('sidebar-filter').fill('')
    await win.getByTestId('sidebar-sort').selectOption('name')
    await expect(win.getByTestId('sidebar-item').first()).toContainText('Альфа')

    // collapse to icons; the state and the width stay after a restart (FR-223)
    const handle = win.getByTestId('sidebar-resize')
    const box = (await handle.boundingBox())!
    await win.mouse.move(box.x + box.width / 2, box.y + 50)
    await win.mouse.down()
    await win.mouse.move(box.x + 80, box.y + 50, { steps: 4 })
    await win.mouse.up()
    await expect
        .poll(
            async () =>
                JSON.parse(await fs.readFile(join(userData, 'settings.json'), 'utf8')).sidebar
                    ?.width
        )
        .toBeGreaterThan(300)
    await win.getByTestId('sidebar-hide').click()
    await expect(win.getByTestId('sidebar')).toHaveCount(0)
    await expect(win.getByTestId('rail-item')).toHaveCount(3)
    await expect(win.locator('[data-testid=rail-item][title="Альфа"]')).toHaveAttribute(
        'aria-current',
        'true'
    )
    await t.close()
    apps.pop()
    const again = await start(userData)
    await again.win.locator('[data-testid=rail-item][title="Бета"]').click()
    await expect(again.win.locator('h1')).toHaveText('Бета')
    await expect(again.win.getByTestId('sidebar-show')).toBeVisible()
    await again.win.getByTestId('sidebar-show').click()
    await expect(again.win.getByTestId('sidebar')).toBeVisible()
    const width = await again.win
        .getByTestId('sidebar')
        .evaluate((el) => el.getBoundingClientRect().width)
    expect(width).toBeGreaterThan(300)
    await expect(again.win.getByTestId('sidebar-sort')).toHaveValue('name')
})

test('"Открыть в новом окне": a second window; the open discussion is not opened twice (FR-225)', async () => {
    const { t, win } = await threeDiscussions()
    await sidebarItem(win, 'Альфа').getByTestId('sidebar-new-window').click()
    const [, second] = await t.windows(2)
    await expect(second!.locator('h1')).toHaveText('Альфа')
    await expect(win.locator('h1')).toHaveText('Гамма')
    // from the first window, "Альфа" brings its window to the front instead of opening it again
    await sidebarItem(win, 'Альфа').getByTestId('sidebar-open').click()
    await expect(win.locator('h1')).toHaveText('Гамма')
    expect(t.app.windows()).toHaveLength(2)
    // reading in the second window updates the unread count in the list of the first window
    await second!.getByTestId('mark-all-read').click()
    await expect(sidebarItem(win, 'Альфа').getByTestId('sidebar-unread')).toHaveCount(0)
})

test('a draft stays with its discussion when the window shows another one; the list marks it (FR-251, FR-253)', async () => {
    const { win } = await threeDiscussions()
    await sidebarItem(win, 'Альфа').getByTestId('sidebar-open').click()
    await expect(win.locator('h1')).toHaveText('Альфа')
    await win.getByTestId('composer').click()
    await win.keyboard.type('не отправлено')
    await sidebarItem(win, 'Бета').getByTestId('sidebar-open').click()
    await expect(win.locator('h1')).toHaveText('Бета')
    await expect(sidebarItem(win, 'Альфа').getByTestId('sidebar-draft')).toBeVisible()
    await expect(win.getByTestId('composer')).toHaveText('')
    await sidebarItem(win, 'Альфа').getByTestId('sidebar-open').click()
    await expect(win.getByTestId('composer')).toHaveText('не отправлено')
    await win.getByTestId('send').click()
    await expect(sidebarItem(win, 'Альфа').getByTestId('sidebar-draft')).toHaveCount(0)
})

const highlights = (win: Page): Promise<number> =>
    win.evaluate(
        () =>
            (CSS as unknown as { highlights: Map<string, { size: number }> }).highlights.get(
                'search'
            )?.size ?? 0
    )

/** A menu item (Playwright keys do not reach the menu accelerators). */
async function viewMenu(t: TestApp, label: string): Promise<void> {
    await t.app.evaluate(({ Menu }, l) => {
        const view = Menu.getApplicationMenu()!.items.find((i) => i.label === 'Вид')!
        view.submenu!.items.find((i) => i.label === l)!.click()
    }, label)
}

test('Ctrl+F: results in all branches (also closed), the next and previous result, the highlight (FR-211 to FR-214)', async () => {
    const { t, win } = await threeDiscussions()
    await sidebarItem(win, 'Альфа').getByTestId('sidebar-open').click()
    await expect(win.locator('h1')).toHaveText('Альфа')
    await viewMenu(t, 'Найти в обсуждении…')
    await win.getByTestId('search-input').fill('ВЕТКА')
    // the branch title and the three messages of the closed branch
    await expect(win.getByTestId('search-result')).toHaveCount(4)
    await expect(win.getByTestId('search-result').first()).toContainText('название ветки')
    await expect(win.getByTestId('search-result').nth(1)).toContainText('ветка «Ветка Альфы»')
    await expect(win.getByTestId('search-result').nth(1).locator('mark')).toHaveText('ветка')

    await win.getByTestId('search-input').press('Enter')
    await expect(win.getByTestId('search-count')).toHaveText('1 из 4')
    await expect(win.getByTestId('thread')).toHaveAttribute('data-thread-id', 'branch')
    await win.getByTestId('search-input').press('Enter')
    await expect(win.getByTestId('search-count')).toHaveText('2 из 4')
    await expect(win.locator('.message-flash, [data-message-id="ветка-0"]').first()).toBeVisible()
    await expect.poll(() => highlights(win)).toBeGreaterThan(0)
    await win.getByTestId('search-input').press('Shift+Enter')
    await expect(win.getByTestId('search-count')).toHaveText('1 из 4')
    await win.getByTestId('search-input').fill('несуществующее')
    await expect(win.getByTestId('search-count')).toHaveText('Ничего не найдено')
    await win.getByTestId('search-close').click()
    await expect(win.getByTestId('search-bar')).toHaveCount(0)
    await expect.poll(() => highlights(win)).toBe(0)
})

test('Ctrl+Shift+F: all discussions, grouped; a result opens the discussion at the message (FR-212, FR-215)', async () => {
    const { t, win } = await threeDiscussions()
    await viewMenu(t, 'Найти во всех обсуждениях…')
    const dialog = win.getByTestId('search-all')
    await dialog.getByTestId('search-all-input').fill('ежик')
    await expect(dialog.getByTestId('search-group')).toHaveCount(1)
    await expect(dialog.getByTestId('search-group')).toContainText('Бета')
    await expect(dialog.getByTestId('search-all-result').locator('mark')).toHaveText('ЁЖИК')
    await dialog.getByTestId('search-all-result').click()
    await expect(win.getByTestId('search-all')).toHaveCount(0)
    await expect(win.locator('h1')).toHaveText('Бета')
    await expect(win.locator('[data-message-id="ezh"]')).toBeInViewport()
    await expect.poll(() => highlights(win)).toBe(1)

    // a word that is in every discussion: one group per discussion
    await win.getByTestId('sidebar-search-all').click()
    await win.getByTestId('search-all-input').fill('сообщ')
    await expect(win.getByTestId('search-group')).toHaveCount(3)
})

test('the branch map: tree, states, counts, filters, keyboard, and a click opens the branch (FR-271 to FR-273)', async () => {
    const dir = await folder()
    const file = join(dir, 'Карта.branchchat')
    await writeDiscussionFile(
        file,
        [
            { id: 'main', messages: many('о', 3) },
            {
                id: 'a',
                parent: 'main',
                source: 'о0',
                quote: 'о',
                title: 'Ветка А',
                messages: many('а', 2)
            },
            {
                id: 'b',
                parent: 'a',
                source: 'а0',
                quote: 'а',
                title: 'Закрытая Б',
                status: 'closed',
                messages: many('б', 1, 'anna')
            },
            {
                id: 'c',
                parent: 'b',
                source: 'б0',
                quote: 'б',
                title: 'Внутри В',
                messages: many('в', 1, 'anna')
            }
        ],
        { readState: { 'p-anna': [] } }
    )
    const { t, win } = await start(await profile(), [file])
    await expect(win.locator('h1')).toHaveText('Карта')
    await viewMenu(t, 'Карта веток…')
    const map = win.getByTestId('branch-map')
    const items = map.getByTestId('branch-map-item')
    await expect(items).toHaveCount(4)
    await expect(items.nth(0)).toHaveAttribute('aria-current', 'true')
    await expect(items.nth(0)).toBeFocused()
    await expect(items.nth(1)).toContainText('Ветка А')
    await expect(items.nth(1)).toContainText('2 сообщения')
    await expect(items.nth(1).getByTestId('branch-map-unread-count')).toHaveText('2')
    await expect(items.nth(2)).toContainText('закрыта')
    await expect(items.nth(3)).toHaveAttribute('aria-level', '4')

    // only open branches: the closed one stays as the way to the open one below it
    await map.getByTestId('branch-map-open').check()
    await expect(items).toHaveCount(4)
    await expect(items.nth(2)).toHaveClass(/context/)
    await map.getByTestId('branch-map-open').uncheck()
    // only branches with unread messages
    await map.getByTestId('branch-map-unread').check()
    await expect(items).toHaveCount(2)
    await map.getByTestId('branch-map-unread').uncheck()

    // keyboard: down twice, Enter opens "Закрытая Б"
    await items.nth(0).focus()
    await win.keyboard.press('ArrowDown')
    await win.keyboard.press('ArrowDown')
    await expect(items.nth(2)).toBeFocused()
    await win.keyboard.press('Enter')
    await expect(win.getByTestId('branch-map')).toHaveCount(0)
    await expect(win.getByTestId('thread')).toHaveAttribute('data-thread-id', 'b')

    // the button opens it too; a click on a branch opens it
    await win.getByTestId('open-branch-map').click()
    await expect(win.getByTestId('branch-map-item').nth(2)).toHaveAttribute('aria-current', 'true')
    await win.getByTestId('branch-map-item').filter({ hasText: 'Внутри В' }).click()
    await expect(win.getByTestId('thread')).toHaveAttribute('data-thread-id', 'c')
})
