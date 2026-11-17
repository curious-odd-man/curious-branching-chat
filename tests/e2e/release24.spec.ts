import { expect, test, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { cleanup, launchApp, tempDir, type TestApp } from './helpers/app'
import { draftRows, newDiscussion, readLibrary } from './helpers/library'

// Release 2.4: reactions (FR-231 to FR-234) and file attachments (FR-261 to FR-267).

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
async function send(win: Page, text: string): Promise<void> {
    await win.getByTestId('composer').fill(text)
    await win.getByTestId('send').click()
}
const message = (win: Page, text: string) => win.getByTestId('message').filter({ hasText: text })
const openedFiles = (t: TestApp): Promise<string[]> =>
    t.app.evaluate(() => (globalThis as unknown as { __openedFiles: string[] }).__openedFiles)

test('reactions: the picker by mouse and by keyboard, counts with names, a second click removes (FR-231, FR-232)', async () => {
    const userData = await profile()
    const { t, win } = await start(userData)
    await newDiscussion(win, 'Реакции')
    await send(win, 'Идём в кино?')
    const m = message(win, 'Идём в кино?')
    await m.hover()
    await m.getByTestId('reaction-add').click()
    await expect(win.getByTestId('reaction-picker')).toBeVisible()
    await win.getByTestId('reaction-choice').and(win.locator('[data-emoji="👍"]')).click()
    const like = m.getByTestId('reaction').and(win.locator('[data-emoji="👍"]'))
    await expect(like).toHaveText(/1/)
    await expect(like).toHaveAttribute('aria-pressed', 'true')
    await expect(like).toHaveAttribute('title', 'Анна')

    // keyboard: the button takes the focus, Enter opens, arrow keys move, Enter picks, Escape closes
    await m.getByTestId('reaction-add').focus()
    await win.keyboard.press('Enter')
    await expect(win.getByTestId('reaction-picker')).toBeVisible()
    await win.keyboard.press('ArrowRight')
    await win.keyboard.press('Enter')
    await expect(win.getByTestId('reaction-picker')).toHaveCount(0)
    await expect(m.getByTestId('reaction').and(win.locator('[data-emoji="👎"]'))).toBeVisible()
    await m.getByTestId('reaction-add').focus()
    await win.keyboard.press('Enter')
    await win.keyboard.press('Escape')
    await expect(win.getByTestId('reaction-picker')).toHaveCount(0)

    // a second click on the same reaction removes it
    await like.click()
    await expect(like).toHaveCount(0)
    await expect(win.getByTestId('status')).toHaveText('Сохранено')
    const saved = readLibrary(t.userData, 'Реакции')
    const reactions = (
        saved.discussion.threads[0]!.messages[0] as unknown as {
            reactions: Array<{ emoji: string; on: boolean }>
        }
    ).reactions
    expect(reactions).toEqual([
        expect.objectContaining({ emoji: '👍', on: false }),
        expect.objectContaining({ emoji: '👎', on: true })
    ])
    // FR-234: a reaction is not a message: no unread mark for anybody, the list has one message
    await expect(win.getByTestId('unread-total')).toHaveCount(0)
})

test('attachments: attach, send without text, save a copy, open; the draft keeps a file over a restart (FR-261, FR-262, FR-251)', async () => {
    const work = await folder()
    const plan = join(work, 'план работ.txt')
    await fs.writeFile(plan, 'Пункт 1. Пункт 2.')
    const userData = await profile()
    const first = await start(userData)
    await newDiscussion(first.win, 'Файлы')

    await first.t.answer({ open: [plan] })
    await first.win.getByTestId('attach').click()
    await expect(first.win.getByTestId('draft-file')).toHaveAttribute('data-name', 'план работ.txt')
    await expect(first.win.getByTestId('send')).toBeEnabled()
    // the draft with its file is kept in the library (FR-251)
    await expect.poll(() => draftRows(userData)).toBe(1)
    await first.t.close()
    apps.splice(apps.indexOf(first.t), 1)

    const { t, win } = await start(userData)
    await win
        .getByTestId('discussion-item')
        .filter({ hasText: 'Файлы' })
        .getByTestId('discussion-open')
        .click()
    await expect(win.getByTestId('draft-file')).toHaveAttribute('data-name', 'план работ.txt')
    await win.getByTestId('send').click()
    const att = win.getByTestId('attachment')
    await expect(att).toHaveAttribute('data-name', 'план работ.txt')
    await expect(att).toContainText(`${Buffer.byteLength('Пункт 1. Пункт 2.')} Б`)
    await expect(win.getByTestId('draft-file')).toHaveCount(0)

    const copy = join(work, 'копия.txt')
    await t.answer({ save: [copy] })
    await att.getByTestId('attachment-save').click()
    await expect.poll(() => fs.readFile(copy, 'utf8').catch(() => '')).toBe('Пункт 1. Пункт 2.')

    // a text file opens without a warning; Windows gets a copy in a new temporary folder (FR-264: only on a click)
    expect(await openedFiles(t)).toEqual([])
    await att.getByTestId('attachment-open').click()
    await expect.poll(async () => (await openedFiles(t)).length).toBe(1)
    const opened = (await openedFiles(t))[0]!
    expect(opened.endsWith('план работ.txt')).toBe(true)
    expect(await fs.readFile(opened, 'utf8')).toBe('Пункт 1. Пункт 2.')
    expect((await t.dialogs()).filter((d) => d.kind === 'box')).toHaveLength(0)
})

test('a type that can run code is warned before it opens, with the type and the author; cancel opens nothing (FR-267)', async () => {
    const work = await folder()
    const script = join(work, 'обновить.bat')
    await fs.writeFile(script, '@echo off')
    const { t, win } = await start(await profile())
    await newDiscussion(win, 'Скрипт')
    await t.answer({ open: [script] })
    await win.getByTestId('attach').click()
    await expect(win.getByTestId('draft-file')).toBeVisible()
    await send(win, 'Запусти это')
    const att = message(win, 'Запусти это').getByTestId('attachment')
    await t.answer({ box: [1] })
    await att.getByTestId('attachment-open').click()
    await expect
        .poll(async () => (await t.dialogs()).filter((d) => d.kind === 'box').length)
        .toBe(1)
    const box = (await t.dialogs()).filter((d) => d.kind === 'box')[0]!
    expect(box.message).toContain('.bat')
    expect(box.detail).toContain('Анна')
    expect(await openedFiles(t)).toEqual([])
    await t.answer({ box: [0] })
    await att.getByTestId('attachment-open').click()
    await expect.poll(async () => (await openedFiles(t)).length).toBe(1)
})

test('a file above "Наибольший размер вложения" is refused with the limit named; a dropped file without a path is attached (FR-265, FR-261)', async () => {
    const work = await folder()
    const big = join(work, 'видео.mp4')
    await fs.writeFile(big, Buffer.alloc(1024 * 1024 + 10))
    const { t, win } = await start(await profile({ attachmentLimitMb: 1 }))
    await newDiscussion(win, 'Предел')
    await t.answer({ open: [big] })
    await win.getByTestId('attach').click()
    await expect(win.getByRole('alert')).toContainText('1 МБ')
    await expect(win.getByRole('alert')).toContainText('видео.mp4')
    await expect(win.getByTestId('draft-file')).toHaveCount(0)

    // a file dropped from another program (no path on disk): the bytes are taken
    await win.getByTestId('composer').evaluate((el) => {
        const dt = new DataTransfer()
        dt.items.add(new File(['заметки'], 'заметки.txt', { type: 'text/plain' }))
        el.dispatchEvent(
            new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })
        )
    })
    await expect(win.getByTestId('draft-file')).toHaveAttribute('data-name', 'заметки.txt')
    await win.getByTestId('draft-file-remove').click()
    await expect(win.getByTestId('draft-file')).toHaveCount(0)
})
