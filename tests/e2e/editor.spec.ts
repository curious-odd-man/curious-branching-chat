import { expect, test, type Page } from '@playwright/test'
import { join } from 'node:path'
import { writeBigDiscussion } from './helpers/bigFile'
import { cleanup, launchApp, tempDir, type TestApp } from './helpers/app'
import { nodeTypes, readDiscussionFile, textNodes } from './helpers/readFile'

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
    await win.getByTestId('name-input').fill('Анна')
    await win.getByTestId('name-confirm').click()
    await expect(win.getByTestId('composer')).toBeVisible()
}
const composer = (win: Page) => win.getByTestId('composer')
const savedMessages = async (file: string) =>
    (await readDiscussionFile(file)).discussion.threads[0]!.messages

/** Types text, then selects it again (so a toolbar command can be applied to it). */
async function typeAndSelect(win: Page, text: string): Promise<void> {
    await win.keyboard.type(text)
    for (let i = 0; i < text.length; i++) await win.keyboard.press('Shift+ArrowLeft')
    // wait until the browser selection has settled before the next command reads it
    await expect.poll(() => win.evaluate(() => window.getSelection()?.toString())).toBe(text)
    await win.waitForTimeout(80)
}

test('headings, bold, italic, underline, colors and links survive saving and reopening', async () => {
    const dir = await workDir()
    const file = join(dir, 'формат.branchchat')
    const { t, win } = await start()
    await createDiscussion(t, win, file)
    await composer(win).click()

    await win.getByTestId('tb-h2').click()
    await win.keyboard.type('Заголовок')
    await win.keyboard.press('Enter')

    // marks by keyboard shortcut
    await win.keyboard.press('Control+b')
    await win.keyboard.type('жирный')
    await win.keyboard.press('Control+b')
    await win.keyboard.type(' ')
    await win.keyboard.press('Control+i')
    await win.keyboard.type('курсив')
    await win.keyboard.press('Control+i')
    await win.keyboard.type(' ')
    await win.keyboard.press('Control+u')
    await win.keyboard.type('подчёркнутый')
    await win.keyboard.press('Control+u')
    await win.keyboard.type(' ')

    // colors by toolbar
    await typeAndSelect(win, 'цветной')
    await win.getByTestId('tb-textcolor').click()
    await win.getByTestId('tb-textcolor-d32f2f').click()
    await win.keyboard.press('ArrowRight')
    await win.keyboard.type(' ')
    await typeAndSelect(win, 'фон')
    await win.getByTestId('tb-bgcolor').click()
    await win.getByTestId('tb-bgcolor-fff59d').click()
    await win.keyboard.press('ArrowRight')

    // link with label and address through the dialog (Ctrl+K)
    await win.keyboard.type(' ')
    await typeAndSelect(win, 'сайт')
    await win.keyboard.press('Control+k')
    await expect(win.getByTestId('link-label')).toHaveValue('сайт')
    await win.getByTestId('link-url').fill('example.com/page')
    await win.getByTestId('link-apply').click()
    // wait for the dialog to close and the editor to have the focus again before the next key press
    await expect(win.getByTestId('link-label')).toHaveCount(0)
    await expect(composer(win)).toBeFocused()
    await win.keyboard.press('ArrowRight')

    // a plain address becomes a link when followed by a space (FR-072)
    await win.keyboard.type(' https://example.org/auto ')
    await win.keyboard.press('Control+Enter')

    const check = async (page: Page): Promise<void> => {
        const m = page.getByTestId('message')
        await expect(m).toHaveCount(1)
        await expect(m.locator('h2')).toHaveText('Заголовок')
        await expect(m.locator('.rich strong')).toHaveText('жирный')
        await expect(m.locator('em')).toHaveText('курсив')
        await expect(m.locator('u')).toHaveText('подчёркнутый')
        await expect(m.locator('a[href="https://example.com/page"]')).toHaveText('сайт')
        await expect(m.locator('a[href="https://example.org/auto"]')).toHaveCount(1)
        await expect(m.locator('span[style*="color: rgb(211, 47, 47)"]').first()).toContainText(
            'цветной'
        )
        await expect(m.locator('.bg-mark', { hasText: 'фон' })).toHaveCSS(
            'background-color',
            'rgb(255, 245, 157)'
        )
    }
    await check(win)

    // what was written to the file
    const [message] = await savedMessages(file)
    const nodes = textNodes(message!.content)
    const marksOf = (text: string) => nodes.find((n) => n.text.includes(text))?.marks ?? []
    expect(marksOf('жирный')).toEqual([{ type: 'bold' }])
    expect(marksOf('курсив')).toEqual([{ type: 'italic' }])
    expect(marksOf('подчёркнутый')).toEqual([{ type: 'underline' }])
    expect(marksOf('цветной')).toContainEqual({ type: 'textColor', attrs: { color: '#d32f2f' } })
    expect(marksOf('фон')).toContainEqual({ type: 'backgroundColor', attrs: { color: '#fff59d' } })
    expect(marksOf('сайт')).toContainEqual({
        type: 'link',
        attrs: { href: 'https://example.com/page' }
    })
    expect(nodeTypes(message!.content).has('heading')).toBe(true)

    // close and reopen: identical result
    await t.close()
    const again = await start({ userData: t.userData, files: [file] })
    await check(again.win)
})

test('bullet and numbered lists, nested with Tab and the indent buttons, round-trip', async () => {
    const dir = await workDir()
    const file = join(dir, 'списки.branchchat')
    const { t, win } = await start()
    await createDiscussion(t, win, file)
    await composer(win).click()

    await win.getByTestId('tb-bullet').click()
    await win.keyboard.type('один')
    await win.keyboard.press('Enter')
    await win.keyboard.type('два')
    await win.keyboard.press('Tab') // nested under "один"
    await win.keyboard.press('Enter')
    await win.keyboard.type('три')
    await expect(win.getByTestId('tb-outdent')).toBeEnabled()
    await win.getByTestId('tb-outdent').click() // back to the outer level
    await expect(win.getByTestId('tb-indent')).toBeEnabled()
    await win.getByTestId('tb-indent').click() // and nested again
    await win.getByTestId('send').click()

    await composer(win).click()
    await win.getByTestId('tb-ordered').click()
    await win.keyboard.type('первый')
    await win.keyboard.press('Enter')
    await win.keyboard.type('второй')
    await win.getByTestId('send').click()

    const bullets = win.getByTestId('message').first()
    await expect(bullets.locator('ul > li > ul > li')).toHaveCount(2) // "два" and "три" are nested
    await expect(
        bullets.locator('ul > li').first().locator(':scope > p, :scope > span').first()
    ).toContainText('один')
    const numbered = win.getByTestId('message').nth(1)
    await expect(numbered.locator('ol > li')).toHaveCount(2)

    const saved = await savedMessages(file)
    expect(nodeTypes(saved[0]!.content)).toEqual(
        new Set(['doc', 'bulletList', 'listItem', 'paragraph', 'text'])
    )
    expect(nodeTypes(saved[1]!.content).has('orderedList')).toBe(true)

    await t.close()
    const again = await start({ userData: t.userData, files: [file] })
    await expect(again.win.getByTestId('message').first().locator('ul > li > ul > li')).toHaveCount(
        2
    )
    await expect(again.win.getByTestId('message').nth(1).locator('ol > li')).toHaveCount(2)
})

test('links open only after a click, only in the system browser, and bad addresses are refused (FR-073, NFR-014)', async () => {
    const dir = await workDir()
    const { t, win } = await start()
    await createDiscussion(t, win, join(dir, 'ссылки.branchchat'))
    await composer(win).click()

    // unsafe addresses are refused in the dialog
    await win.keyboard.type('x')
    await win.keyboard.press('Shift+ArrowLeft')
    await win.keyboard.press('Control+k')
    for (const bad of [
        'javascript:alert(1)',
        'file:///C:/Windows/System32/cmd.exe',
        'ftp://example.com'
    ]) {
        await win.getByTestId('link-url').fill(bad)
        await win.getByTestId('link-apply').click()
        await expect(win.getByTestId('link-error')).toBeVisible()
    }
    await win.getByTestId('link-url').fill('example.org/click')
    await win.getByTestId('link-apply').click()
    await expect(win.getByTestId('link-error')).toHaveCount(0)
    await win.getByTestId('send').click()

    const link = win.getByTestId('message').locator('a')
    await expect(link).toHaveAttribute('href', 'https://example.org/click')
    await expect(link).toHaveAttribute('title', /example\.org\/click/) // the destination is visible before clicking
    expect(
        await t.app.evaluate(
            () => (globalThis as unknown as { __openedLinks: string[] }).__openedLinks
        )
    ).toEqual([])

    const before = win.url()
    await link.click()
    await expect
        .poll(() =>
            t.app.evaluate(
                () => (globalThis as unknown as { __openedLinks: string[] }).__openedLinks
            )
        )
        .toEqual(['https://example.org/click'])
    expect(win.url()).toBe(before) // the app window itself never navigates
    expect(t.app.windows()).toHaveLength(1)
})

test('an existing link can be edited or removed (FR-071)', async () => {
    const dir = await workDir()
    const { t, win } = await start()
    await createDiscussion(t, win, join(dir, 'a.branchchat'))
    await composer(win).click()
    await win.keyboard.type('привет ')
    await typeAndSelect(win, 'тут')
    await win.keyboard.press('Control+k')
    await win.getByTestId('link-url').fill('example.com')
    await win.getByTestId('link-apply').click()
    await expect(composer(win).locator('a')).toHaveCount(1)

    // put the cursor inside the link: the dialog shows the current address and offers to remove it
    await win.keyboard.press('ArrowRight')
    await win.keyboard.press('ArrowLeft')
    await win.keyboard.press('Control+k')
    await expect(win.getByTestId('link-url')).toHaveValue('https://example.com')
    await win.getByTestId('link-remove').click()
    await expect(composer(win).locator('a')).toHaveCount(0)
    await expect(composer(win)).toContainText('привет тут')
})

test('markup typed or pasted into the editor can never become active content (NFR-014)', async () => {
    const dir = await workDir()
    const file = join(dir, 'безопасность.branchchat')
    const { t, win } = await start()
    await createDiscussion(t, win, file)

    // 1. markup typed as text stays text
    const attack = '<script>window.__xss=1</script><img src=x onerror="window.__xss=2">'
    await composer(win).fill(attack)
    await win.getByTestId('send').click()
    const first = win.getByTestId('message').first()
    await expect(first).toContainText(attack)
    await expect(first.locator('img, script, iframe')).toHaveCount(0)

    // 2. pasting rich HTML: only the supported formatting survives
    await composer(win).click()
    await win.evaluate(() => {
        const dt = new DataTransfer()
        dt.setData(
            'text/html',
            '<h4>Четыре</h4><p>a <strike>b</strike> <img src="https://evil.example/x.png"> ' +
                '<a href="javascript:alert(1)">c</a> <b>d</b></p><pre><code>код</code></pre><iframe src="https://evil.example"></iframe>'
        )
        document
            .querySelector('[data-testid=composer]')!
            .dispatchEvent(
                new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
            )
    })
    await expect(composer(win)).toContainText('Четыре')
    await win.getByTestId('send').click()
    const pasted = win.getByTestId('message').nth(1)
    await expect(pasted.locator('img, iframe, script, pre, code, a, s, strike')).toHaveCount(0)
    await expect(pasted.locator('.rich strong')).toHaveText('d') // bold is supported, so it survives
    await expect(pasted).toContainText('код')

    const saved = await savedMessages(file)
    const allowed = new Set([
        'doc',
        'paragraph',
        'text',
        'heading',
        'hardBreak',
        'bulletList',
        'orderedList',
        'listItem'
    ])
    for (const type of nodeTypes(saved[1]!.content)) expect(allowed.has(type)).toBe(true)
    for (const n of textNodes(saved[1]!.content))
        for (const m of n.marks) expect(['bold', 'italic', 'underline'].includes(m.type)).toBe(true)

    expect(
        await win.evaluate(() => (window as unknown as { __xss?: number }).__xss)
    ).toBeUndefined()
})

test('Cyrillic, ё and emoji are kept exactly, in the page and in the file (FR-077 to FR-080)', async () => {
    const dir = await workDir()
    const file = join(dir, 'юникод.branchchat')
    const { t, win } = await start()
    await createDiscussion(t, win, file)
    const text = 'Ёлка, ёж, Щ — 🌲 привет 👩‍👩‍👧 日本語 العربية'
    await composer(win).fill(text)
    await win.getByTestId('send').click()
    await expect(win.getByTestId('message')).toContainText(text)
    const [m] = await savedMessages(file)
    expect(
        textNodes(m!.content)
            .map((n) => n.text)
            .join('')
    ).toBe(text)
})

test('Ctrl+Enter sends, Enter adds a line, and an empty message cannot be sent', async () => {
    const dir = await workDir()
    const { t, win } = await start()
    await createDiscussion(t, win, join(dir, 'a.branchchat'))
    await expect(win.getByTestId('send')).toBeDisabled()
    await composer(win).click()
    await win.keyboard.type('   ')
    await expect(win.getByTestId('send')).toBeDisabled() // whitespace only
    await win.keyboard.press('Control+Enter')
    await expect(win.getByTestId('message')).toHaveCount(0)

    await win.keyboard.type('строка 1')
    await win.keyboard.press('Enter')
    await win.keyboard.type('строка 2')
    await win.keyboard.press('Control+Enter')
    await expect(win.getByTestId('message')).toHaveCount(1)
    await expect(win.getByTestId('message').locator('p')).toHaveCount(2)
    await expect(composer(win)).toHaveText('')
})

test('a discussion with 5,000 messages stays responsive: virtualized list, scrolling, sending (NFR-004)', async () => {
    test.setTimeout(120_000)
    const dir = await workDir()
    const file = join(dir, 'большое.branchchat')
    await writeBigDiscussion(file, 5000)

    const t0 = Date.now()
    const { t, win } = await start({ files: [file] })
    const rows = win.getByTestId('message')
    await expect(win.getByText('Сообщение номер 4999 — ёж')).toBeVisible({ timeout: 30_000 }) // opens at the newest
    const openMs = Date.now() - t0

    const renderedAtEnd = await rows.count()
    expect(renderedAtEnd).toBeLessThan(150) // virtualized: nowhere near 5,000 elements

    // jump to the start, then to the middle
    await win.getByTestId('messages').evaluate((el) => (el.scrollTop = 0))
    await expect(win.getByText('Сообщение номер 0 — ёж')).toBeVisible()
    await win.getByTestId('messages').evaluate((el) => (el.scrollTop = el.scrollHeight / 2))
    await expect.poll(() => rows.count()).toBeGreaterThan(3)
    expect(await rows.count()).toBeLessThan(150)

    // writing while scrolled far up brings the new message into view (own messages always scroll)
    await win.getByTestId('messages').evaluate((el) => (el.scrollTop = 0))
    await composer(win).click()
    const sentAt = Date.now()
    await win.keyboard.type('новое сообщение в конце')
    const typedMs = Date.now() - sentAt
    const sendStart = Date.now()
    await win.keyboard.press('Control+Enter')
    await expect(win.getByText('новое сообщение в конце')).toBeVisible()
    const sendMs = Date.now() - sendStart
    await expect(win.getByTestId('status')).toHaveText('Сохранено', { timeout: 30_000 })

    const metrics = { messages: 5000, openMs, renderedAtEnd, typedMs, sendToVisibleMs: sendMs }
    console.log('large discussion metrics', JSON.stringify(metrics))
    test.info().annotations.push({ type: 'metrics', description: JSON.stringify(metrics) })
    expect(openMs).toBeLessThan(20_000)
    expect(sendMs).toBeLessThan(5_000)
    void t
})
