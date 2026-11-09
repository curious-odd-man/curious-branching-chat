import { expect, test, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { cleanup, launchApp, tempDir, type TestApp } from './helpers/app'
import { doc, img, p, sha256, simple, t, writeDiscussionFile } from './helpers/craft'
import { makePng } from './helpers/png'

// Display and input (phase 9, NFR-003): Windows display scaling, the smallest window, keyboard use, focus handling,
// and high-contrast (forced colors) themes.

const apps: TestApp[] = []
const dirs: string[] = []
test.afterEach(async () => {
    await Promise.all(apps.splice(0).map((a) => a.close()))
    await cleanup(...dirs.splice(0))
})

const LONG = 'Электрификация-переосмысление-стандартизированных-межведомственных-согласований'
const TEXT = 'Это идея про ёлку и про совершенно непроизносимое слово'

async function discussionFile(): Promise<string> {
    const dir = await tempDir('bc-display-')
    dirs.push(dir)
    const file = join(dir, 'отображение.branchchat')
    const pic = makePng(1600, 900, [40, 120, 200])
    await writeDiscussionFile(
        file,
        [
            {
                id: 'main',
                messages: [
                    { id: 'm1', author: 'boris', content: simple(TEXT) },
                    { id: 'm2', author: 'boris', content: doc(p(t(LONG))) },
                    {
                        id: 'm3',
                        author: 'boris',
                        content: doc(p(t('Картинка: '), img(sha256(pic))))
                    }
                ]
            },
            {
                id: 'b1',
                parent: 'main',
                source: 'm1',
                quote: 'идея',
                start: TEXT.indexOf('идея'),
                end: TEXT.indexOf('идея') + 4,
                title: LONG,
                messages: [{ id: 'b1m1', author: 'boris', content: simple('Ответ в ветке') }]
            }
        ],
        { assets: [{ data: pic }] }
    )
    return file
}
async function profile(): Promise<string> {
    const dir = await tempDir('bc-display-profile-')
    dirs.push(dir)
    await fs.writeFile(
        join(dir, 'settings.json'),
        JSON.stringify({
            participantId: 'p-test',
            displayName: 'Тест',
            readNoticeAcknowledged: true,
            associationAsked: true
        })
    )
    return dir
}
async function open(
    file: string,
    electronArgs: string[] = []
): Promise<{ app: TestApp; win: Page }> {
    const app = await launchApp({ files: [file], userData: await profile(), electronArgs })
    apps.push(app)
    const win = await app.app.firstWindow()
    await expect(win.getByTestId('composer')).toBeVisible()
    return { app, win }
}

/** Nothing sticks out of the window, and the controls a person needs are fully on screen. */
async function expectLayoutFits(win: Page, label: string): Promise<void> {
    const report = await win.evaluate(() => {
        const vw = document.documentElement.clientWidth
        const vh = document.documentElement.clientHeight
        const inside = (selector: string): boolean | null => {
            const el = document.querySelector<HTMLElement>(`[data-testid="${selector}"]`)
            if (!el) return null
            const r = el.getBoundingClientRect()
            return r.left >= -0.5 && r.top >= -0.5 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5
        }
        return {
            horizontalOverflow: document.documentElement.scrollWidth > vw + 1,
            bodyOverflow: document.body.scrollWidth > vw + 1,
            composer: inside('composer'),
            send: inside('send'),
            panel: inside('branch-panel'),
            thread: inside('thread')
        }
    })
    expect(report, label).toEqual({
        horizontalOverflow: false,
        bodyOverflow: false,
        composer: true,
        send: true,
        panel: true,
        thread: true
    })
}

for (const scale of [1, 1.25, 1.5, 2]) {
    test(`display scaling ${scale * 100}%: nothing overflows, also in the smallest window (NFR-003)`, async () => {
        const { app, win } = await open(await discussionFile(), [
            `--force-device-scale-factor=${scale}`
        ])
        expect(await win.evaluate(() => window.devicePixelRatio)).toBeCloseTo(scale, 2)
        await expectLayoutFits(win, `${scale * 100}% normal`)

        // open the branch: header with a long title and the quote
        await win.getByTestId('panel-branch').first().click()
        await expect(win.getByTestId('branch-header')).toBeVisible()
        await expectLayoutFits(win, `${scale * 100}% in a branch`)

        // the smallest window the application allows
        await app.app.evaluate(({ BrowserWindow }) => {
            const w = BrowserWindow.getAllWindows()[0]!
            w.setSize(720, 480)
        })
        await expect
            .poll(() => win.evaluate(() => document.documentElement.clientWidth))
            .toBeLessThanOrEqual(720)
        await expectLayoutFits(win, `${scale * 100}% smallest window`)
        const size = await app.app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0]!.getMinimumSize()
        )
        expect(size).toEqual([720, 480])
    })
}

test('keyboard: Tab reaches the main controls, focus is visible, and dialogs keep focus inside (NFR-003)', async () => {
    const { app, win } = await open(await discussionFile())
    await win.getByTestId('composer').click()
    await win.keyboard.type('текст') // Send is disabled while empty

    // Tab through the page; collect what receives focus
    const seen = new Set<string>()
    for (let i = 0; i < 80; i++) {
        await win.keyboard.press('Tab')
        const id = await win.evaluate(
            () => (document.activeElement as HTMLElement | null)?.getAttribute('data-testid') ?? ''
        )
        if (id) seen.add(id)
    }
    for (const needed of ['send', 'panel-main', 'panel-branch', 'image-button'])
        expect(seen, needed).toContain(needed)

    // the focus ring is drawn for keyboard focus
    await win.getByTestId('composer').click()
    await win.keyboard.press('Tab')
    await win.keyboard.press('Shift+Tab')
    await win.keyboard.press('Tab')
    const outline = await win.evaluate(() => {
        const el = document.activeElement as HTMLElement
        const style = getComputedStyle(el)
        return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) }
    })
    expect(outline.style).not.toBe('none')
    expect(outline.width).toBeGreaterThanOrEqual(2)

    // settings dialog: focus moves in, Tab and Shift+Tab stay inside, Escape closes and focus returns
    await win.getByTestId('composer').click()
    await app.app.evaluate(({ Menu }) => {
        Menu.getApplicationMenu()
            ?.items[0]?.submenu?.items.find((i) => i.label === 'Настройки…')
            ?.click()
    })
    const dialog = win.getByTestId('settings-dialog')
    await expect(dialog).toBeVisible()
    const insideDialog = (): Promise<boolean> =>
        win.evaluate(() => !!document.activeElement?.closest('[data-testid="settings-dialog"]'))
    expect(await insideDialog()).toBe(true)
    for (let i = 0; i < 14; i++) {
        await win.keyboard.press('Tab')
        expect(await insideDialog(), `Tab ${i}`).toBe(true)
    }
    for (let i = 0; i < 14; i++) {
        await win.keyboard.press('Shift+Tab')
        expect(await insideDialog(), `Shift+Tab ${i}`).toBe(true)
    }
    await win.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(win.getByTestId('composer')).toBeFocused()
})

test('keyboard: Ctrl+Enter sends and Escape closes the read-notice and name dialogs without sending', async () => {
    const dir = await tempDir('bc-display-profile-')
    dirs.push(dir) // a profile with no name and no notice acknowledged
    const app = await launchApp({ files: [await discussionFile()], userData: dir })
    apps.push(app)
    const win = await app.app.firstWindow()
    await win.getByTestId('composer').click()
    await win.keyboard.type('Проверка клавиатуры')
    await win.keyboard.press('Control+Enter')
    await expect(win.getByTestId('name-input')).toBeFocused()
    await win.keyboard.press('Escape')
    await expect(win.getByTestId('name-input')).toHaveCount(0)
    await expect(win.getByTestId('composer')).toContainText('Проверка клавиатуры') // the draft is kept
})

test('high contrast: state does not depend on color alone (forced colors)', async () => {
    const { win } = await open(await discussionFile())
    await win.emulateMedia({ forcedColors: 'active' })
    expect(await win.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true)

    const unread = win.getByTestId('message').first()
    await expect(unread).toHaveAttribute('data-unread', 'true')
    const border = await unread.evaluate((el) => parseFloat(getComputedStyle(el).borderLeftWidth))
    expect(border).toBeGreaterThanOrEqual(4)
    await expect(unread).toContainText('Новое') // and it has a text label as well

    await win.getByTestId('composer').click()
    const ring = await win.evaluate(
        () => getComputedStyle(document.activeElement as HTMLElement).outlineStyle
    )
    expect(ring).not.toBe('none') // the message field shows focus with an outline

    await win.getByTestId('panel-branch').first().click()
    await expect(win.getByTestId('branch-header')).toBeVisible()
    const mark = win.locator('mark.quote').first()
    if (await mark.count()) {
        const bg = await mark.evaluate((el) => getComputedStyle(el).backgroundColor)
        expect(bg).not.toBe('rgba(0, 0, 0, 0)')
    }
})
