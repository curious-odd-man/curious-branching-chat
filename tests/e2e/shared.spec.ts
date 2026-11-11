import { expect, test, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { cleanup, launchApp, tempDir, type TestApp } from './helpers/app'
import { makePng } from './helpers/png'

// Two (or three) application instances, each with its own profile, and one temporary folder as the shared folder.
// Scans run every 0.5 s in test builds with BRANCHCHAT_E2E_SCAN_MS.

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

/** Clicks a File menu item (the menu command races the page subscribing at startup, so retry). */
async function menu(app: TestApp, win: Page, label: string, expectTestId: string): Promise<void> {
    await expect(async () => {
        await app.app.evaluate(({ Menu }, l) => {
            const file = Menu.getApplicationMenu()?.items[0]?.submenu
            file?.items.find((i) => i.label === l)?.click()
        }, label)
        await expect(win.getByTestId(expectTestId)).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10_000 })
}

async function chooseFolder(t: TestApp, win: Page, folder: string): Promise<void> {
    await t.answer({ open: [folder] })
    await win.getByTestId('wizard-choose-folder').click()
    await expect(win.getByTestId('wizard-folder-test')).toHaveAttribute('data-ok', 'true')
}

async function send(win: Page, text: string): Promise<void> {
    await win.getByTestId('composer').fill(text)
    await win.getByTestId('send').click()
}

const message = (win: Page, text: string) => win.getByTestId('message').filter({ hasText: text })

/** Anna creates a shared discussion; Boris joins it. Returns both windows. */
async function createAndJoin(): Promise<{
    a: { t: TestApp; win: Page }
    b: { t: TestApp; win: Page }
    shared: string
    fileA: string
    fileB: string
}> {
    const work = await dir()
    const shared = join(work, 'Google Диск', 'Общая')
    await fs.mkdir(shared, { recursive: true })
    const fileA = join(work, 'Анна', 'Планы.branchchat')
    const fileB = join(work, 'Борис', 'Планы.branchchat')
    await fs.mkdir(join(work, 'Анна'))
    await fs.mkdir(join(work, 'Борис'))
    const a = await start(await profile('p-anna', 'Анна'))
    const b = await start(await profile('p-boris', 'Борис'))

    // Boris starts "join": his key goes into the folder
    await menu(b.t, b.win, 'Присоединиться к обсуждению…', 'shared-wizard')
    await chooseFolder(b.t, b.win, shared)
    await expect(b.win.getByTestId('wizard-invitation')).toHaveAttribute('data-state', 'waiting')

    // Anna creates the discussion and accepts Boris after checking his fingerprint
    await menu(a.t, a.win, 'Новое общее обсуждение…', 'shared-wizard')
    const annaPrint = await a.win.getByTestId('wizard-own-fingerprint').textContent()
    await chooseFolder(a.t, a.win, shared)
    const boris = a.win.getByTestId('candidate').filter({ hasText: 'Борис' })
    await expect(async () => {
        await a.win.getByTestId('wizard-refresh').click()
        await expect(boris).toBeVisible({ timeout: 500 })
    }).toPass({ timeout: 10_000 })
    await boris.getByTestId('candidate-accept').check()
    await a.t.answer({ save: [fileA] })
    await a.win.getByTestId('wizard-create').click()
    await expect(a.win.getByTestId('shared-roster')).toBeVisible()
    await expect(a.win.getByTestId('roster-member').filter({ hasText: 'Борис' })).toHaveAttribute(
        'data-state',
        'invited'
    )

    // Boris sees the invitation with Anna's fingerprint, and accepts it
    await expect(b.win.getByTestId('wizard-invitation')).toHaveAttribute('data-state', 'ready', {
        timeout: 15_000
    })
    await expect(b.win.getByTestId('invitation-from')).toContainText('Анна')
    await expect(b.win.getByTestId('inviter-fingerprint')).toHaveText(annaPrint!)
    await b.t.answer({ save: [fileB] })
    await b.win.getByTestId('wizard-join').click()
    await expect(b.win.getByTestId('composer')).toBeVisible()

    // Anna's roster shows that Boris joined
    await expect(a.win.getByTestId('roster-member').filter({ hasText: 'Борис' })).toHaveAttribute(
        'data-state',
        'joined',
        {
            timeout: 15_000
        }
    )
    await a.win.getByTestId('wizard-close').click()
    await expect(a.win.getByTestId('composer')).toBeVisible()
    return { a, b, shared, fileA, fileB }
}

test('create, join, and write in both directions through the shared folder (FR-158 to FR-163)', async () => {
    const { a, b, shared, fileA } = await createAndJoin()

    await send(a.win, 'Привет, Борис!')
    await expect(message(b.win, 'Привет, Борис!')).toBeVisible({ timeout: 15_000 })
    await send(b.win, 'Привет, Анна. Я на месте.')
    await expect(message(a.win, 'Привет, Анна. Я на месте.')).toBeVisible({ timeout: 15_000 })

    // Boris answered, so Anna's message is read by him (FR-112)
    // one mark for delivery and reading: two green checks = read by all (D-40, D-41)
    const ownMark = message(a.win, 'Привет, Борис!').getByTestId('message-mark')
    await expect(ownMark).toHaveAttribute('data-state', 'read-all', { timeout: 15_000 })
    await expect(ownMark).toHaveText('✓✓')

    // the shared folder holds only encrypted protocol files; the plain text is never there (FR-160)
    const files = (await fs.readdir(shared, { recursive: true, withFileTypes: true })).filter((e) =>
        e.isFile()
    )
    for (const f of files) {
        const content = await fs.readFile(join(f.parentPath, f.name))
        expect(content.includes(Buffer.from('Привет'))).toBe(false)
        expect(f.name).not.toMatch(/\.(tmp|branchchat)$/)
    }
    // the roster button shows both members
    await expect(a.win.getByTestId('roster-button')).toContainText('2')
    expect(fileA).toBeTruthy()
})

test('a copy of the file is detached; "Отправить копию…" saves a copy without the member list (FR-154, FR-167)', async () => {
    const { a, fileA } = await createAndJoin()
    const copy = join(await dir(), 'для WhatsApp.branchchat')
    await a.t.answer({ save: [copy] })
    await a.t.app.evaluate(({ Menu }) => {
        const file = Menu.getApplicationMenu()?.items[0]?.submenu
        file?.items.find((i) => i.label === 'Отправить копию…')?.click()
    })
    await expect
        .poll(
            () =>
                fs.stat(copy).then(
                    () => true,
                    () => false
                ),
            { timeout: 10_000 }
        )
        .toBe(true)
    const { readEntries } = await import('./helpers/readFile')
    expect([...(await readEntries(copy)).keys()]).not.toContain('sync.json')

    // a copy made in Explorer still has the member list, but it is not the registered file
    const explorerCopy = join(await dir(), 'копия.branchchat')
    await fs.copyFile(fileA, explorerCopy)
    const c = await start(await profile('p-anna-2', 'Анна'), [explorerCopy])
    await expect(c.win.getByTestId('notice')).toContainText('отдельная копия')
})

test('a large picture arrives in parts: the message shows as loading until all parts are there (FR-165, D-37)', async () => {
    const { a, b, shared, fileB } = await createAndJoin()
    const bobData = b.t.userData
    await b.t.close()
    apps.splice(apps.indexOf(b.t), 1)

    // Anna sends a 9 MB picture while Boris is away: three parts
    const picture = join(await dir(), 'большая.png')
    await fs.writeFile(picture, makePng(1800, 1700, [0, 0, 0], true))
    await a.win.getByTestId('composer').fill('Большая картинка')
    await a.t.answer({ open: [picture] })
    await a.win.getByTestId('tb-image').click()
    await expect(a.win.getByTestId('composer').locator('img.editor-image')).toHaveCount(1)
    await a.win.getByTestId('send').click()
    const inbox = join(shared, 'inbox', 'p-boris')
    await expect
        .poll(async () => (await fs.readdir(inbox)).filter((n) => n.endsWith('.bcpart')).length, {
            timeout: 15_000
        })
        .toBeGreaterThanOrEqual(3)

    // the sync product has not delivered one part yet
    const part = (await fs.readdir(inbox)).find((n) => n.endsWith('.bcpart'))!
    const aside = join(await dir(), 'part')
    await fs.rename(join(inbox, part), aside)

    const b2 = await start(bobData, [fileB])
    const loading = b2.win.getByTestId('loading-message')
    await expect(loading).toBeVisible({ timeout: 15_000 })
    await expect(loading.getByTestId('loading-text')).toContainText('из 3 частей')
    await expect(loading).toContainText('Большая картинка')
    await expect(loading.getByTestId('image-loading')).toBeVisible()
    // no "mark as read" and no unread label while it loads (D-37)
    await expect(loading.getByTestId('mark-read')).toHaveCount(0)

    await fs.rename(aside, join(inbox, part))
    await expect(message(b2.win, 'Большая картинка').getByTestId('message-image')).toBeVisible({
        timeout: 20_000
    })
    await expect(b2.win.getByTestId('loading-message')).toHaveCount(0)
})

test('an existing discussion becomes shared; the key is pasted as text; the history reaches the new member (D-02, D-21)', async () => {
    const work = await dir()
    const shared = join(work, 'shared')
    await fs.mkdir(shared)
    const fileA = join(work, 'Старое.branchchat')
    const fileB = join(work, 'Старое у Бориса.branchchat')
    const a = await start(await profile('p-anna', 'Анна'))
    await a.t.answer({ save: [fileA] })
    await a.win.getByTestId('launcher-new').click()
    await expect(a.win.getByTestId('composer')).toBeVisible()
    await send(a.win, 'Это было до общей папки')
    await expect(message(a.win, 'Это было до общей папки')).toBeVisible()

    // Boris copies his key in Settings and sends it to Anna (here: the clipboard)
    const b = await start(await profile('p-boris', 'Борис'))
    await menu(b.t, b.win, 'Настройки…', 'settings-dialog')
    await b.win.getByTestId('identity-copy').click()
    await expect(b.win.getByTestId('identity-message')).toBeVisible()
    const bobKey = await b.t.app.evaluate(({ clipboard }) => clipboard.readText())
    await b.win.getByTestId('settings-close').click()
    await menu(b.t, b.win, 'Присоединиться к обсуждению…', 'shared-wizard')
    await chooseFolder(b.t, b.win, shared)

    await menu(a.t, a.win, 'Сделать обсуждение общим…', 'shared-wizard')
    await chooseFolder(a.t, a.win, shared)
    await a.win.getByTestId('wizard-paste').fill(bobKey)
    await a.win.getByTestId('wizard-add-pasted').click()
    await expect(
        a.win.getByTestId('candidate').filter({ hasText: 'Борис' }).getByTestId('candidate-accept')
    ).toBeChecked()
    await a.win.getByTestId('wizard-create').click()
    await expect(a.win.getByTestId('shared-roster')).toBeVisible()
    await a.win.getByTestId('wizard-close').click()
    await expect(a.win.getByTestId('roster-button')).toBeVisible()

    await expect(b.win.getByTestId('wizard-invitation')).toHaveAttribute('data-state', 'ready', {
        timeout: 15_000
    })
    await b.t.answer({ save: [fileB] })
    await b.win.getByTestId('wizard-join').click()
    await expect(message(b.win, 'Это было до общей папки')).toBeVisible()
    await send(b.win, 'А это уже после')
    await expect(message(a.win, 'А это уже после')).toBeVisible({ timeout: 15_000 })
})

test('a moved shared file is recognized after the person confirms it (FR-168)', async () => {
    const { a, b, fileA } = await createAndJoin()
    const annaData = a.t.userData
    await a.t.close()
    apps.splice(apps.indexOf(a.t), 1)
    const moved = join(await dir(), 'Переименовано.branchchat')
    await fs.rename(fileA, moved)

    const again = await start(annaData, [moved])
    await expect(again.win.getByTestId('composer')).toBeVisible()
    // the question was asked, and "Да, это он" (the default answer in test builds) was chosen
    const asked = await again.t.dialogs()
    expect(asked.some((d) => d.kind === 'box' && String(d['message']).includes('перемещено'))).toBe(
        true
    )
    await expect(again.win.getByTestId('roster-button')).toBeVisible()
    await send(again.win, 'Из перемещённого файла')
    await expect(message(b.win, 'Из перемещённого файла')).toBeVisible({ timeout: 15_000 })
})

test('release 1.3: delivery marks, per-member details, and the status line (FR-169, FR-172)', async () => {
    const { a, b, shared, fileA } = await createAndJoin()
    await send(a.win, 'Дошло?')
    const mark = message(a.win, 'Дошло?').getByTestId('message-mark')
    await expect(mark).toHaveAttribute('data-state', 'delivered', { timeout: 15_000 })
    // two grey checks: delivered to all (D-40)
    await expect(mark).toHaveText('✓✓')
    // Boris sees the same mark on the message of Anna: he has it, so it is delivered to all (D-41)
    const atBoris = message(b.win, 'Дошло?').getByTestId('message-mark')
    await expect(atBoris).toHaveAttribute('data-state', 'delivered')
    // Boris marks it read: two green checks (with two members, "all" comes at once)
    await message(b.win, 'Дошло?').getByTestId('mark-read').click()
    await expect(atBoris).toHaveAttribute('data-state', 'read-all')
    await expect(mark).toHaveAttribute('data-state', 'read-all', { timeout: 15_000 })
    await mark.click()
    await expect(a.win.getByTestId('mark-member').filter({ hasText: 'Борис' })).toHaveAttribute(
        'data-state',
        'read'
    )
    await a.win.keyboard.press('Escape')

    // Boris is away: the message stays "in the folder"
    await b.t.close()
    apps.splice(apps.indexOf(b.t), 1)
    await send(a.win, 'Пока тебя нет')
    const away = message(a.win, 'Пока тебя нет').getByTestId('message-mark')
    // one grey check: written to the shared folder
    await expect(away).toHaveAttribute('data-state', 'written', { timeout: 15_000 })
    await expect(away).toHaveText('✓')
    await away.click()
    await expect(a.win.getByTestId('mark-member').filter({ hasText: 'Борис' })).toHaveAttribute(
        'data-state',
        'written'
    )
    await a.win.keyboard.press('Escape')

    // the shared folder disappears (for example Drive for Desktop is closed): the status line says so.
    // Windows refuses to rename a folder that the running app watches, so Anna's app is closed for the rename.
    const annaData = a.t.userData
    const reopen = async (): Promise<{ t: TestApp; win: Page }> => {
        const next = await start(annaData, [fileA])
        apps.push(next.t)
        await expect(next.win.getByTestId('composer')).toBeVisible()
        return next
    }
    await a.t.close()
    apps.splice(apps.indexOf(a.t), 1)
    await fs.rename(shared, `${shared}-away`)
    const away1 = await reopen()
    await away1.win.getByTestId('sync-check').click()
    await expect(away1.win.getByTestId('sync-status')).toHaveAttribute('data-folder', 'missing', {
        timeout: 10_000
    })
    await expect(away1.win.getByTestId('sync-status')).toContainText('Общая папка недоступна')

    await away1.t.close()
    apps.splice(apps.indexOf(away1.t), 1)
    await fs.rename(`${shared}-away`, shared)
    const back = await reopen()
    await back.win.getByTestId('sync-check').click()
    await expect(back.win.getByTestId('sync-status')).toHaveCount(0, { timeout: 10_000 })
})
