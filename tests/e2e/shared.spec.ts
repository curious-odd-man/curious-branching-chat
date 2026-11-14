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

// ---- release 1.4: tray, background sync, notifications (FR-173 to FR-175) ------------------------------------------

type Note = { title: string; body: string }
const notes = (t: TestApp): Promise<Note[]> =>
    t.app.evaluate(() =>
        (globalThis as unknown as { __notifications: Note[] }).__notifications.map((n) => ({
            title: n.title,
            body: n.body
        }))
    )
const trayLabels = (t: TestApp): Promise<string[] | null> =>
    t.app.evaluate(
        () =>
            (
                globalThis as unknown as { __tray: { items: Array<{ label?: string }> | null } }
            ).__tray.items?.map((i) => i.label ?? '---') ?? null
    )
const closeAllWindows = (t: TestApp): Promise<void> =>
    t.app.evaluate(({ BrowserWindow }) => {
        for (const w of BrowserWindow.getAllWindows()) w.close()
    })

test('release 1.4: the app stays in the tray, syncs with no window, and notifies (FR-173 to FR-175)', async () => {
    const { a, b, fileB } = await createAndJoin()

    // FR-174: the first synchronized discussion turned "start with Windows" on, on both computers
    for (const t of [a.t, b.t])
        expect(
            await t.app.evaluate(
                () => (globalThis as unknown as { __loginItem: boolean }).__loginItem
            )
        ).toBe(true)
    expect(await trayLabels(b.t)).toEqual(
        expect.arrayContaining(['Открыть', 'Планы', 'Проверить папки', 'Выход'])
    )

    // FR-173: Boris closes his window; the app keeps running in the tray, with a one-time notice
    await closeAllWindows(b.t)
    await expect.poll(() => b.t.app.windows().length).toBe(0)
    await expect
        .poll(async () => (await notes(b.t)).map((n) => n.title))
        .toEqual(['BranchChat продолжает работать'])

    // FR-175: Anna writes; Boris's app applies it to the file and raises a notification with the text
    await send(a.win, 'Привет из окна Анны')
    await expect
        .poll(async () => (await notes(b.t)).slice(1), { timeout: 15_000 })
        .toEqual([{ title: 'Анна — Планы', body: 'Привет из окна Анны' }])
    const onDisk = await fs.readFile(fileB)
    expect(onDisk.length).toBeGreaterThan(0)

    // a click on the notification opens the discussion with the message
    await b.t.app.evaluate(() =>
        (
            globalThis as unknown as { __notifications: Array<{ click(): void }> }
        ).__notifications[1]!.click()
    )
    const [reopened] = await b.t.windows(1)
    await expect(message(reopened!, 'Привет из окна Анны')).toBeVisible({ timeout: 10_000 })

    // D-38: with "Показывать текст в уведомлениях" off, the notification has no message text
    await menu(b.t, reopened!, 'Настройки…', 'settings-background')
    await reopened!.getByTestId('settings-notifyShowText').uncheck()
    await expect(reopened!.getByTestId('settings-notifyShowText')).not.toBeChecked()
    await closeAllWindows(b.t)
    await expect.poll(() => b.t.app.windows().length).toBe(0)
    await send(a.win, 'Секретный текст')
    await expect
        .poll(async () => (await notes(b.t)).slice(2), { timeout: 15_000 })
        .toEqual([{ title: 'Анна — Планы', body: 'Новое сообщение' }])

    // "Открыть" in the tray opens the discussion again; it shows both messages
    await b.t.app.evaluate(() =>
        (globalThis as unknown as { __tray: { act(l: string): boolean } }).__tray.act('Открыть')
    )
    const [again] = await b.t.windows(1)
    await expect(message(again!, 'Секретный текст')).toBeVisible({ timeout: 10_000 })

    // "Выход" ends the application
    const exited = new Promise<void>((resolve) => b.t.app.process().once('exit', () => resolve()))
    await b.t.app.evaluate(() =>
        (globalThis as unknown as { __tray: { act(l: string): boolean } }).__tray.act('Выход')
    )
    await exited
})

test('release 1.4: a normal discussion does not keep the app in the tray', async () => {
    const userData = await profile('p-solo', 'Соло')
    const { t } = await start(userData)
    expect(await trayLabels(t)).toBeNull()
    const exited = new Promise<void>((resolve) => t.app.process().once('exit', () => resolve()))
    await closeAllWindows(t)
    await exited
})

// ---- release 1.5: add members after activation (FR-176) -------------------------------------------------------------

test('release 1.5: a member who did not create the discussion invites a new person (FR-176)', async () => {
    const { a, b, shared } = await createAndJoin()
    await send(a.win, 'Сообщение до приглашения')
    await expect(message(b.win, 'Сообщение до приглашения')).toBeVisible({ timeout: 15_000 })

    // Clara waits for an invitation in the same folder
    const work = await dir()
    const fileC = join(work, 'Клара', 'Планы.branchchat')
    await fs.mkdir(join(work, 'Клара'))
    const c = await start(await profile('p-clara', 'Клара'))
    await menu(c.t, c.win, 'Присоединиться к обсуждению…', 'shared-wizard')
    await chooseFolder(c.t, c.win, shared)
    await expect(c.win.getByTestId('wizard-invitation')).toHaveAttribute('data-state', 'waiting')

    // Boris opens the members, then "Пригласить участника…"
    await b.win.getByTestId('roster-button').click()
    await b.win.getByTestId('roster-invite').click()
    await expect(b.win.getByTestId('shared-wizard')).toHaveAttribute('data-mode', 'invite')
    const borisPrint = await b.win.getByTestId('wizard-own-fingerprint').textContent()
    const clara = b.win.getByTestId('candidate').filter({ hasText: 'Клара' })
    await expect(async () => {
        await b.win.getByTestId('wizard-refresh').click()
        await expect(clara).toBeVisible({ timeout: 500 })
    }).toPass({ timeout: 10_000 })
    // members are not offered again
    await expect(b.win.getByTestId('candidate').filter({ hasText: 'Анна' })).toHaveCount(0)
    await clara.getByTestId('candidate-accept').check()
    await b.win.getByTestId('wizard-invite').click()
    await expect(b.win.getByTestId('shared-roster')).toBeVisible()
    await expect(b.win.getByTestId('roster-member').filter({ hasText: 'Клара' })).toHaveAttribute(
        'data-state',
        'invited'
    )

    // Anna learns about the new member without a question, and sees who added her
    await a.win.getByTestId('roster-button').click()
    const claraAtAnna = a.win.getByTestId('roster-member').filter({ hasText: 'Клара' })
    await expect(claraAtAnna).toBeVisible({ timeout: 15_000 })
    await expect(claraAtAnna.getByTestId('roster-added-by')).toHaveText('пригласил(а): Борис')
    await a.win.keyboard.press('Escape')

    // a message written after the invitation, before Clara imported it (D-23)
    await send(a.win, 'Добро пожаловать, Клара')

    // Clara checks Boris's fingerprint and joins
    await expect(c.win.getByTestId('wizard-invitation')).toHaveAttribute('data-state', 'ready', {
        timeout: 15_000
    })
    await expect(c.win.getByTestId('invitation-from')).toContainText('Борис')
    await expect(c.win.getByTestId('inviter-fingerprint')).toHaveText(borisPrint!)
    await c.t.answer({ save: [fileC] })
    await c.win.getByTestId('wizard-join').click()
    await expect(c.win.getByTestId('composer')).toBeVisible()
    await expect(message(c.win, 'Сообщение до приглашения')).toBeVisible()
    await expect(message(c.win, 'Добро пожаловать, Клара')).toBeVisible({ timeout: 15_000 })
    await expect(b.win.getByTestId('roster-member').filter({ hasText: 'Клара' })).toHaveAttribute(
        'data-state',
        'joined',
        { timeout: 15_000 }
    )

    // Clara writes; both earlier members get it
    await send(c.win, 'Спасибо!')
    await expect(message(a.win, 'Спасибо!')).toBeVisible({ timeout: 15_000 })
    await expect(message(b.win, 'Спасибо!')).toBeVisible({ timeout: 15_000 })
})

// ---- release 1.5: rejoin after key loss (FR-177) -----------------------------------------------------------------------

test('release 1.5: a person who lost the keys is re-invited; another member rejects, then accepts (FR-177)', async () => {
    const { a, b, shared } = await createAndJoin()
    const work = await dir()

    // Anna invites Clara (three members)
    const fileC = join(work, 'Клара.branchchat')
    const c = await start(await profile('p-clara', 'Клара'))
    await menu(c.t, c.win, 'Присоединиться к обсуждению…', 'shared-wizard')
    await chooseFolder(c.t, c.win, shared)
    await a.win.getByTestId('roster-button').click()
    await a.win.getByTestId('roster-invite').click()
    const claraCandidate = a.win.getByTestId('candidate').filter({ hasText: 'Клара' })
    await expect(async () => {
        await a.win.getByTestId('wizard-refresh').click()
        await expect(claraCandidate).toBeVisible({ timeout: 500 })
    }).toPass({ timeout: 10_000 })
    await claraCandidate.getByTestId('candidate-accept').check()
    await a.win.getByTestId('wizard-invite').click()
    await a.win.getByTestId('wizard-close').click()
    await expect(c.win.getByTestId('wizard-invitation')).toHaveAttribute('data-state', 'ready', {
        timeout: 15_000
    })
    await c.t.answer({ save: [fileC] })
    await c.win.getByTestId('wizard-join').click()
    await expect(c.win.getByTestId('composer')).toBeVisible()
    await send(b.win, 'Борис до потери ключа')
    await expect(message(c.win, 'Борис до потери ключа')).toBeVisible({ timeout: 15_000 })

    // Boris loses his keys and his settings: a new profile with a new participant ID
    await b.t.close()
    apps.splice(apps.indexOf(b.t), 1)
    const fileB2 = join(work, 'Борис-снова.branchchat')
    const b2 = await start(await profile('p-boris-new', 'Борис'))
    await menu(b2.t, b2.win, 'Присоединиться к обсуждению…', 'shared-wizard')
    await chooseFolder(b2.t, b2.win, shared)
    const borisNewPrint = await b2.win.getByTestId('wizard-own-fingerprint').textContent()

    // Anna re-invites him with the new key
    await a.win.getByTestId('roster-button').click()
    await a.win
        .getByTestId('roster-member')
        .filter({ hasText: 'Борис' })
        .getByTestId('roster-reinvite')
        .click()
    await expect(a.win.getByTestId('shared-wizard')).toHaveAttribute('data-mode', 'reinvite')
    const newKey = a.win.getByTestId('candidate').filter({ hasText: borisNewPrint! })
    await expect(async () => {
        await a.win.getByTestId('wizard-refresh').click()
        await expect(newKey).toBeVisible({ timeout: 500 })
    }).toPass({ timeout: 10_000 })
    // the old key of Boris is not offered
    await expect(a.win.getByTestId('candidate')).toHaveCount(1)
    await newKey.getByTestId('candidate-accept').check()
    await a.win.getByTestId('wizard-reinvite').click()
    await expect(a.win.getByTestId('shared-roster')).toBeVisible()
    await a.win.getByTestId('wizard-close').click()

    // Boris imports the re-invitation and has the whole history
    await expect(b2.win.getByTestId('wizard-invitation')).toHaveAttribute('data-state', 'ready', {
        timeout: 15_000
    })
    await expect(b2.win.getByTestId('invitation-rejoin')).toBeVisible()
    await b2.t.answer({ save: [fileB2] })
    await b2.win.getByTestId('wizard-join').click()
    await expect(b2.win.getByTestId('composer')).toBeVisible()
    await expect(message(b2.win, 'Борис до потери ключа')).toBeVisible()
    // he has his old participant ID again
    const settings = JSON.parse(await fs.readFile(join(b2.t.userData, 'settings.json'), 'utf8'))
    expect(settings.participantId).toBe('p-boris')

    // Clara: a request with the new fingerprint in the status line; she rejects it
    const request = c.win.getByTestId('key-request')
    await expect(request).toHaveAttribute('data-state', 'pending', { timeout: 15_000 })
    await expect(request.getByTestId('key-request-fingerprint')).toHaveText(borisNewPrint!)
    await request.getByTestId('key-reject').click()
    await expect(request).toHaveAttribute('data-state', 'rejected')

    // messages flow between Anna and Boris; Clara does not get Boris's message
    await send(b2.win, 'Я снова здесь')
    await expect(message(a.win, 'Я снова здесь')).toBeVisible({ timeout: 15_000 })
    await send(a.win, 'С возвращением')
    await expect(message(b2.win, 'С возвращением')).toBeVisible({ timeout: 15_000 })
    await expect(message(c.win, 'С возвращением')).toBeVisible({ timeout: 15_000 })
    await c.win.getByTestId('sync-check').click()
    await expect(message(c.win, 'Я снова здесь')).toHaveCount(0)
    // Boris sees that Clara has not accepted his new keys
    await expect(b2.win.getByTestId('sync-status')).toContainText('Клара', { timeout: 15_000 })

    // Clara changes her mind and accepts: the waiting message arrives, and hers reach Boris
    await request.getByTestId('key-accept').click()
    await expect(c.win.getByTestId('key-request')).toHaveCount(0)
    await expect(message(c.win, 'Я снова здесь')).toBeVisible({ timeout: 15_000 })
    await send(c.win, 'Принято')
    await expect(message(b2.win, 'Принято')).toBeVisible({ timeout: 15_000 })
    await expect(b2.win.getByTestId('sync-status')).toHaveCount(0, { timeout: 15_000 })
})
