import { expect, test, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { cleanup, launchApp, tempDir, type TestApp } from './helpers/app'
import { writeBigDiscussion } from './helpers/bigFile'
import { doc, img, p, sha256, t, writeDiscussionFile } from './helpers/craft'
import { makePng } from './helpers/png'
import { readEntries } from './helpers/readFile'

// Performance pass (phase 9). There are no product limits to enforce (NFR-015); these tests record how the
// application behaves on large discussions and fail only on gross regressions (budgets are deliberately loose,
// because CI machines differ). The measured numbers are written to test-results/performance.json and summarized in
// docs/performance.md.

const results: Record<string, number | string> = {}
const apps: TestApp[] = []
const dirs: string[] = []
test.afterAll(async () => {
    await fs.mkdir('test-results', { recursive: true })
    await fs.writeFile(join('test-results', 'performance.json'), JSON.stringify(results, null, 2))
    console.log('PERFORMANCE', JSON.stringify(results, null, 2))
})
test.afterEach(async () => {
    await Promise.all(apps.splice(0).map((a) => a.close()))
    await cleanup(...dirs.splice(0))
})
test.setTimeout(120_000)

async function workDir(): Promise<string> {
    const d = await tempDir('bc-perf-')
    dirs.push(d)
    return d
}
async function readMessageCount(file: string): Promise<number> {
    const entries = await readEntries(file)
    const d = JSON.parse(entries.get('discussion.json')!.toString('utf8')) as {
        threads: { messages: unknown[] }[]
    }
    return d.threads.reduce((n, th) => n + th.messages.length, 0)
}
/** A profile that already has a name and has seen the read notice, so sending needs no dialogs. */
async function seededProfile(): Promise<string> {
    const dir = await tempDir('bc-perf-profile-')
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
const now = (): number => Number(process.hrtime.bigint() / 1_000_000n)
const memoryMb = (app: TestApp): Promise<number> =>
    app.app.evaluate(({ app }) =>
        Math.round(app.getAppMetrics().reduce((sum, m) => sum + m.memory.workingSetSize, 0) / 1024)
    )

async function openAndMeasure(
    label: string,
    file: string,
    firstText: RegExp
): Promise<{ app: TestApp; win: Page }> {
    const t0 = now()
    const app = await launchApp({ files: [file], userData: await seededProfile() })
    apps.push(app)
    const win = await app.app.firstWindow()
    await expect(win.getByTestId('message').first()).toContainText(firstText, { timeout: 60_000 })
    results[`${label}: launch to first message (ms)`] = now() - t0
    results[`${label}: message rows in the page`] = await win.getByTestId('message').count()
    results[`${label}: memory after open (MB)`] = await memoryMb(app)
    return { app, win }
}

test('startup: launch to a usable window', async () => {
    const t0 = now()
    const app = await launchApp()
    apps.push(app)
    dirs.push(app.userData)
    const win = await app.app.firstWindow()
    await expect(win.getByTestId('launcher-new')).toBeVisible()
    results['startup: launch to start window (ms)'] = now() - t0
    results['startup: memory (MB)'] = await memoryMb(app)
    expect(now() - t0).toBeLessThan(15_000)
})

for (const count of [5_000, 20_000]) {
    test(`${count} messages: open, scroll, and send a message`, async () => {
        const dir = await workDir()
        const file = join(dir, 'big.branchchat')
        await writeBigDiscussion(file, count)
        const size = (await fs.stat(file)).size
        results[`${count}: file size (KB)`] = Math.round(size / 1024)

        const { app, win } = await openAndMeasure(String(count), file, /Сообщение номер/)
        expect(results[`${count}: launch to first message (ms)`]).toBeLessThan(20_000)
        expect(results[`${count}: message rows in the page`]).toBeLessThan(200) // the list is virtualized

        await expect(win.getByText(`Сообщение номер ${count - 1} — ёж`)).toBeVisible({
            timeout: 30_000
        }) // opens at the newest

        // Sending while scrolled far up: how long until the message is visible, and until it is safely in the file.
        await win.getByTestId('messages').evaluate((el) => (el.scrollTop = 0))
        await win.getByTestId('composer').click()
        const t0 = now()
        await win.keyboard.type('Новое сообщение после большого списка')
        results[`${count}: typing 37 characters (ms)`] = now() - t0
        const t1 = now()
        await win.keyboard.press('Control+Enter')
        await expect(
            win.getByTestId('message').filter({ hasText: 'Новое сообщение после большого списка' })
        ).toBeVisible()
        results[`${count}: sent message visible (ms)`] = now() - t1
        await expect
            .poll(() => readMessageCount(file), { timeout: 30_000, intervals: [20] })
            .toBe(count + 1)
        results[`${count}: sent message saved in the file (ms)`] = now() - t1
        await expect(win.getByTestId('status')).toHaveText('Сохранено')
        results[`${count}: memory after send (MB)`] = await memoryMb(app)

        expect(results[`${count}: sent message visible (ms)`]).toBeLessThan(2_000)
        expect(results[`${count}: sent message saved in the file (ms)`]).toBeLessThan(15_000)
    })
}

test('many images: 300 pictures in one discussion, then the whole list is scrolled through', async () => {
    const dir = await workDir()
    const file = join(dir, 'images.branchchat')
    const assets = Array.from({ length: 300 }, (_, i) => ({
        data: makePng(640, 480, [i % 256, Math.floor(i / 256), 7])
    }))
    await writeDiscussionFile(
        file,
        [
            {
                id: 'main',
                messages: assets.map((a, i) => ({
                    id: `m${i}`,
                    author: i % 2 ? 'boris' : 'anna',
                    content: doc(p(t(`Картинка ${i}: `), img(sha256(a.data))))
                }))
            }
        ],
        { assets }
    )
    results['300 images: file size (MB)'] = Math.round((await fs.stat(file)).size / 1024 / 1024)
    const { app, win } = await openAndMeasure('300 images', file, /Картинка/)

    const t0 = now()
    const list = win
        .getByTestId('message')
        .first()
        .locator('xpath=ancestor::*[contains(@class,"messages")][1]')
    for (let step = 0; step < 40; step++) {
        await list.evaluate((el) => el.scrollBy(0, el.clientHeight * 4))
        await new Promise((r) => setTimeout(r, 40))
    }
    results['300 images: 40 scroll steps (ms)'] = now() - t0
    results['300 images: memory after scrolling (MB)'] = await memoryMb(app)
    expect(await win.getByTestId('message').count()).toBeLessThan(200)
    await expect(win.locator('app-error, [data-testid="app-error"]')).toHaveCount(0)
})

test('a 17 MB picture in a 5,000-message discussion: staging time', async () => {
    const dir = await workDir()
    const file = join(dir, 'bigpic.branchchat')
    await writeBigDiscussion(file, 5_000)
    const { win } = await openAndMeasure('5000 + 20 MB picture', file, /Сообщение номер/)
    const png = makePng(2400, 2400, undefined, true) // uncompressed noise, about 17 MB
    results['20 MB picture: file bytes'] = png.length
    const staged = await win.evaluate(async (base64) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
        const t0 = performance.now()
        const r = await window.branchchat.stageImage(bytes)
        return { ok: r.ok, ms: Math.round(performance.now() - t0) }
    }, png.toString('base64'))
    results['20 MB picture: staging (ms)'] = staged.ms
    expect(staged.ok).toBe(true)
})
