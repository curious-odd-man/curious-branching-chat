import { expect, test, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import yazl from 'yazl'
import { cleanup, launchApp, tempDir, type TestApp } from './helpers/app'
import { doc, img, p, sha256, t as text, writeDiscussionFile } from './helpers/craft'
import { libraryList, readLibrary } from './helpers/library'
import { makePng } from './helpers/png'

// FR-206: the first start with the library offers the discussion files of the earlier storage (recent list and sync
// registry) for the library. A profile of the earlier storage is built here from a running shared discussion: its library is written back into a
// `.branchchat` file with the member list, and the library is removed.

const apps: TestApp[] = []
const dirs: string[] = []
test.afterEach(async () => {
    await Promise.all(apps.splice(0).map((a) => a.close()))
    await cleanup(...dirs.splice(0))
})
test.setTimeout(120_000)

const ENV = { BRANCHCHAT_E2E_SCAN_MS: '500' }

async function dir(prefix = 'bc-e2e-'): Promise<string> {
    const d = await tempDir(prefix)
    dirs.push(d)
    return d
}
async function profile(participantId: string, displayName: string): Promise<string> {
    const d = await dir('bc-profile-')
    await fs.writeFile(
        join(d, 'settings.json'),
        JSON.stringify({
            participantId,
            displayName,
            readNoticeAcknowledged: true,
            openLastFileOnStartup: false
        })
    )
    return d
}
async function start(userData: string, files: string[] = []): Promise<{ t: TestApp; win: Page }> {
    const t = await launchApp({ userData, env: ENV, files })
    apps.push(t)
    return { t, win: await t.app.firstWindow() }
}
async function menu(app: TestApp, win: Page, label: string, expectTestId: string): Promise<void> {
    await expect(async () => {
        await app.app.evaluate(({ Menu }, l) => {
            Menu.getApplicationMenu()
                ?.items[0]?.submenu?.items.find((i) => i.label === l)
                ?.click()
        }, label)
        await expect(win.getByTestId(expectTestId)).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10_000 })
}
async function chooseFolder(t: TestApp, win: Page, folder: string): Promise<void> {
    await t.answer({ open: [folder] })
    await win.getByTestId('wizard-choose-folder').click()
    await expect(win.getByTestId('wizard-folder-test')).toHaveAttribute('data-ok', 'true')
}
async function send(win: Page, value: string): Promise<void> {
    await win.getByTestId('composer').fill(value)
    await win.getByTestId('send').click()
}
const message = (win: Page, value: string) => win.getByTestId('message').filter({ hasText: value })

/** Writes a discussion of a library as a file of the earlier storage (with the member list and delivery marks). */
async function writeOldFile(userData: string, title: string, path: string): Promise<void> {
    const d = readLibrary(userData, title)
    const zip = new yazl.ZipFile()
    const add = (name: string, value: unknown): void =>
        zip.addBuffer(Buffer.from(JSON.stringify(value)), name)
    add('manifest.json', d.manifest)
    add('discussion.json', d.discussion)
    add('readstate.json', d.readState)
    if (d.sync) add('sync.json', d.sync)
    if (d.sync && d.delivery) add('delivery.json', d.delivery)
    zip.end()
    const chunks: Buffer[] = []
    for await (const c of zip.outputStream) chunks.push(c as Buffer)
    await fs.writeFile(path, Buffer.concat(chunks))
}

test('a profile of the earlier storage: the files are offered once, imported with images and sync state, and sync goes on (FR-206)', async () => {
    const work = await dir()
    const shared = join(work, 'Общая')
    await fs.mkdir(shared)
    const a = await start(await profile('p-anna', 'Анна'))
    const b = await start(await profile('p-boris', 'Борис'))

    // Anna and Boris have a shared discussion "Планы" with one message
    await menu(b.t, b.win, 'Присоединиться к обсуждению…', 'shared-wizard')
    await chooseFolder(b.t, b.win, shared)
    await menu(a.t, a.win, 'Новое общее обсуждение…', 'shared-wizard')
    await chooseFolder(a.t, a.win, shared)
    const boris = a.win.getByTestId('candidate').filter({ hasText: 'Борис' })
    await expect(async () => {
        await a.win.getByTestId('wizard-refresh').click()
        await expect(boris).toBeVisible({ timeout: 500 })
    }).toPass({ timeout: 10_000 })
    await boris.getByTestId('candidate-accept').check()
    await a.win.getByTestId('wizard-title').fill('Планы')
    await a.win.getByTestId('wizard-create').click()
    await expect(b.win.getByTestId('wizard-invitation')).toHaveAttribute('data-state', 'ready', {
        timeout: 15_000
    })
    await b.win.getByTestId('wizard-join').click()
    await a.win.getByTestId('wizard-close').click()
    await send(a.win, 'До обновления')
    await expect(message(b.win, 'До обновления')).toBeVisible({ timeout: 15_000 })
    await expect(a.win.getByTestId('status')).toHaveText('Сохранено')

    // Anna's computer as the earlier storage left it: files, the recent list, and the registry with file paths
    const annaData = a.t.userData
    await a.t.close()
    apps.splice(apps.indexOf(a.t), 1)
    const docs = join(work, 'Документы')
    await fs.mkdir(docs)
    const sharedFile = join(docs, 'Планы.branchchat')
    await writeOldFile(annaData, 'Планы', sharedFile)
    const picture = makePng(30, 20, [200, 40, 40])
    const plainFile = join(docs, 'Рецепты.branchchat')
    await writeDiscussionFile(
        plainFile,
        [
            {
                id: 'main',
                messages: [
                    {
                        id: 'm1',
                        author: 'boris',
                        content: doc(p(text('Борщ')), p(img(sha256(picture))))
                    }
                ]
            }
        ],
        { assets: [{ data: picture }] }
    )
    const missingFile = join(docs, 'Удалено.branchchat')
    const conversationId = readLibrary(annaData, 'Планы').id
    const registryFile = join(annaData, 'sync', 'registry.json')
    const registry = JSON.parse(await fs.readFile(registryFile, 'utf8')) as {
        entries: Array<Record<string, string>>
    }
    registry.entries = registry.entries.map((e) => ({ ...e, filePath: sharedFile }))
    await fs.writeFile(registryFile, JSON.stringify(registry))
    await fs.writeFile(
        join(annaData, 'recent.json'),
        JSON.stringify({
            version: 1,
            files: [plainFile, missingFile, sharedFile].map((path) => ({
                path,
                openedAt: '2026-11-01T00:00:00.000Z'
            }))
        })
    )
    for (const name of ['library.sqlite', 'library.sqlite-wal', 'library.sqlite-shm', 'blobs'])
        await fs.rm(join(annaData, name), { recursive: true, force: true })
    const before = await fs.readFile(sharedFile)

    // Boris writes while Anna is away
    await send(b.win, 'Пока ты обновлялась')

    // the first start with the library asks once, with everything selected that exists
    const again = await start(annaData)
    const dialog = again.win.getByTestId('migration-dialog')
    await expect(dialog).toBeVisible()
    const items = dialog.getByTestId('migration-item')
    await expect(items).toHaveCount(3)
    await expect(items.filter({ hasText: 'Планы' }).locator('input')).toBeChecked()
    await expect(items.filter({ hasText: 'Рецепты' }).locator('input')).toBeChecked()
    await expect(items.filter({ hasText: 'Удалено' }).locator('input')).toBeDisabled()
    await dialog.getByTestId('migration-run').click()
    await expect(dialog.getByTestId('migration-result')).toHaveCount(2)
    await expect(
        dialog.getByTestId('migration-result').filter({ hasText: 'Планы' })
    ).toHaveAttribute('data-status', 'imported')
    await dialog.getByTestId('migration-done').click()
    await expect(again.win.getByTestId('sidebar-item')).toHaveCount(2)
    expect((await fs.readFile(sharedFile)).equals(before)).toBe(true) // the original is not changed
    expect(libraryList(annaData).find((d) => d.title === 'Планы')).toMatchObject({
        id: conversationId,
        synced: true
    })

    // the image came along
    await again.win.getByTestId('sidebar-open').filter({ hasText: 'Рецепты' }).click()
    await expect(again.win.getByTestId('message-image')).toBeVisible()
    await expect
        .poll(() =>
            again.win
                .getByTestId('message-image')
                .evaluate((el) => (el as HTMLImageElement).naturalWidth)
        )
        .toBe(30)

    // sync goes on in both directions, with what Boris wrote meanwhile
    const result = await again.win.evaluate(
        (id) => window.branchchat.openDiscussion(id),
        conversationId
    )
    expect(result.ok).toBe(true)
    const plans = again.win // FR-225: in place, in the same window
    await expect(message(plans, 'Пока ты обновлялась')).toBeVisible({ timeout: 15_000 })
    await send(plans, 'Я снова здесь, уже с библиотекой')
    await expect(message(b.win, 'Я снова здесь, уже с библиотекой')).toBeVisible({
        timeout: 15_000
    })

    // the question is not asked again
    await again.t.close()
    apps.splice(apps.indexOf(again.t), 1)
    const third = await start(annaData)
    await expect(third.win.getByTestId('sidebar-item')).toHaveCount(2)
    await expect(third.win.getByTestId('migration-dialog')).toHaveCount(0)
})
