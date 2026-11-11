import { expect, test, type Locator, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { cleanup, launchApp, tempDir, type TestApp } from './helpers/app'
import { simple, writeDiscussionFile, type CraftOptions, type CraftThread } from './helpers/craft'
import { readDiscussionFile, readReadState } from './helpers/readFile'
import { selectText } from './helpers/select'

const apps: TestApp[] = []
const dirs: string[] = []
test.afterEach(async () => {
    await Promise.all(apps.splice(0).map((a) => a.close()))
    await cleanup(...dirs.splice(0))
})

async function workDir(): Promise<string> {
    const d = await tempDir()
    dirs.push(d)
    return d
}

/** A profile with a participant name; `ack` says whether the read-status notice was already shown (FR-125). */
async function profile(
    options: { id?: string; name?: string; ack?: boolean } = {}
): Promise<string> {
    const dir = await tempDir('bc-profile-')
    dirs.push(dir)
    await fs.writeFile(
        join(dir, 'settings.json'),
        JSON.stringify({
            participantId: options.id ?? 'p-local',
            displayName: options.name ?? 'Вера',
            readNoticeAcknowledged: options.ack ?? true
        })
    )
    return dir
}

async function open(file: string, userData: string): Promise<{ t: TestApp; win: Page }> {
    const t = await launchApp({ userData, files: [file] })
    apps.push(t)
    return { t, win: await t.app.firstWindow() }
}

/**
 * main: m1 (Борис), m2 (Анна), m3 (Борис)
 * a (from m2): a1 (Борис), a2 (Анна)
 * b (from a1): b1 (Борис)
 * The local user (Вера) wrote nothing, so all six messages are unread for her (FR-109).
 */
const tree = (): CraftThread[] => [
    {
        id: 'main',
        messages: [
            { id: 'm1', author: 'boris', content: simple('Первое сообщение Бориса.') },
            {
                id: 'm2',
                author: 'anna',
                content: simple('Второе сообщение Анны, на которое ответят.')
            },
            { id: 'm3', author: 'boris', content: simple('Третье сообщение Бориса.') }
        ]
    },
    {
        id: 'a',
        parent: 'main',
        source: 'm2',
        quote: 'Второе сообщение',
        start: 0,
        end: 16,
        messages: [
            { id: 'a1', author: 'boris', content: simple('Ответ Бориса в ветке.') },
            { id: 'a2', author: 'anna', content: simple('Ответ Анны в ветке.') }
        ]
    },
    {
        id: 'b',
        parent: 'a',
        source: 'a1',
        quote: 'Ответ Бориса',
        start: 0,
        end: 12,
        messages: [{ id: 'b1', author: 'boris', content: simple('Вложенный ответ Бориса.') }]
    }
]

async function craft(options?: CraftOptions): Promise<string> {
    const file = join(await workDir(), 'непрочитанное.branchchat')
    await writeDiscussionFile(file, tree(), options)
    return file
}

const unreadMessages = (win: Page): Locator => win.locator('[data-message-id][data-unread=true]')
const total = (win: Page): Locator => win.getByTestId('unread-total')
const panel = (win: Page, id: string): Locator =>
    win.locator(`[data-testid=panel-branch][data-thread-id=${id}]`)
const windowTitle = (t: TestApp): Promise<string> =>
    t.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getTitle())
const savedReadState = async (file: string, participant = 'p-local') =>
    (await readReadState(file))[participant]

test('on first open every message by others is unread, with counts in the panel, header and window title (FR-109, FR-110, FR-113)', async () => {
    const file = await craft()
    const { t, win } = await open(file, await profile())

    await expect(total(win)).toHaveText('Непрочитано: 6')
    await expect.poll(() => windowTitle(t)).toBe('(6) непрочитанное.branchchat — BranchChat')
    await expect(unreadMessages(win)).toHaveCount(3) // the main thread shows its three
    await expect(win.getByTestId('unread-label')).toHaveCount(3)

    // per-thread counts, and a dot on threads whose branches have unread messages
    await expect(win.getByTestId('panel-main').getByTestId('panel-unread')).toHaveText('3')
    await expect(win.getByTestId('panel-main').getByTestId('panel-dot')).toHaveCount(1)
    await expect(panel(win, 'a').getByTestId('panel-unread')).toHaveText('2')
    await expect(panel(win, 'a').getByTestId('panel-dot')).toHaveCount(1) // b is below it
    await expect(panel(win, 'b').getByTestId('panel-unread')).toHaveText('1')
    await expect(panel(win, 'b').getByTestId('panel-dot')).toHaveCount(0)

    // opening threads and scrolling never mark anything as read (FR-112)
    for (const id of ['a', 'b']) {
        await panel(win, id).click()
        await win.getByTestId('messages').evaluate((el) => (el.scrollTop = 0))
        await win.getByTestId('messages').evaluate((el) => (el.scrollTop = el.scrollHeight))
    }
    await win.getByTestId('panel-main').click()
    await expect(total(win)).toHaveText('Непрочитано: 6')
    expect(await savedReadState(file)).toBeUndefined() // nothing was written
})

test('"Mark as read" works per message; the notice is shown once and can be declined (FR-111, FR-125)', async () => {
    const file = await craft()
    const { t, win } = await open(file, await profile({ ack: false }))
    const m1 = win.locator('[data-message-id=m1]')

    // declining the notice changes nothing
    await m1.getByTestId('mark-read').click()
    await expect(win.getByTestId('read-notice')).toBeVisible()
    await win.getByTestId('read-notice-cancel').click()
    await expect(m1).toHaveAttribute('data-unread', 'true')
    expect(await savedReadState(file)).toBeUndefined()

    // accepting it marks the message, and the file records it, with this person added as a participant (FR-022)
    await m1.getByTestId('mark-read').click()
    await win.getByTestId('read-notice-confirm').click()
    await expect(m1).toHaveAttribute('data-unread', 'false')
    await expect(m1.getByTestId('mark-read')).toHaveCount(0)
    await expect(total(win)).toHaveText('Непрочитано: 5')
    await expect.poll(() => windowTitle(t)).toContain('(5)')
    await expect.poll(() => savedReadState(file)).toEqual(['m1'])
    await expect(win.getByTestId('status')).toHaveText('Сохранено') // the file is written a moment after the screen changes
    const participants = (await readDiscussionFile(file)).discussion.participants.map(
        (p) => p.displayName
    )
    expect(participants).toContain('Вера')

    // the notice is not shown again
    await win.locator('[data-message-id=m3]').getByTestId('mark-read').click()
    await expect(win.locator('[data-message-id=m3]')).toHaveAttribute('data-unread', 'false')
    await expect(win.getByTestId('read-notice')).toHaveCount(0)
    await expect.poll(() => savedReadState(file)).toEqual(['m1', 'm3'])
    const settings = JSON.parse(await fs.readFile(join(t.userData, 'settings.json'), 'utf8')) as {
        readNoticeAcknowledged: boolean
    }
    expect(settings.readNoticeAcknowledged).toBe(true)
})

test('"Mark thread as read" and "Mark all as read" (FR-111)', async () => {
    const file = await craft()
    const { t, win } = await open(file, await profile())

    // the main thread only: branches keep their unread messages
    await win.getByTestId('mark-thread-read').click()
    await expect(win.getByTestId('thread-toolbar')).toHaveCount(0)
    await expect(unreadMessages(win)).toHaveCount(0)
    await expect(win.getByTestId('panel-main').getByTestId('panel-unread')).toHaveCount(0)
    await expect(win.getByTestId('panel-main').getByTestId('panel-dot')).toHaveCount(1) // branches below still unread
    await expect(total(win)).toHaveText('Непрочитано: 3') // a1, a2, b1

    // inside branch a: marks a's own messages (a1, a2), not b's
    await panel(win, 'a').click()
    await expect(win.getByTestId('thread-unread')).toHaveText('Непрочитано здесь: 2')
    await win.getByTestId('mark-thread-read').click()
    await expect(panel(win, 'a').getByTestId('panel-unread')).toHaveCount(0)
    await expect(panel(win, 'a').getByTestId('panel-dot')).toHaveCount(1) // b is still unread
    await expect(panel(win, 'b').getByTestId('panel-unread')).toHaveText('1')
    await expect(total(win)).toHaveText('Непрочитано: 1')

    // everything
    await win.getByTestId('mark-all-read').click()
    await expect(win.getByTestId('unread-total')).toHaveCount(0)
    await expect(win.getByTestId('panel-unread')).toHaveCount(0)
    await expect(win.getByTestId('panel-dot')).toHaveCount(0)
    await expect.poll(() => windowTitle(t)).toBe('непрочитанное.branchchat — BranchChat')
    // only messages by others are listed; all of them are
    await expect
        .poll(async () => [...((await savedReadState(file)) ?? [])].sort())
        .toEqual(['a1', 'a2', 'b1', 'm1', 'm2', 'm3'])
})

test('writing a message reads the earlier messages of that thread only; "Reply to this" reads the source (FR-112)', async () => {
    const file = await craft()
    const { win } = await open(file, await profile())

    // writing in the main thread reads m1, m2 and m3 — but not the branches
    await win.getByTestId('composer').click()
    await win.keyboard.type('Мой ответ в основном обсуждении')
    await win.keyboard.press('Control+Enter')
    await expect(win.getByTestId('message').filter({ hasText: 'Мой ответ' })).toHaveCount(1)
    await expect(unreadMessages(win)).toHaveCount(0)
    await expect(win.getByTestId('panel-main').getByTestId('panel-unread')).toHaveCount(0)
    await expect(panel(win, 'a').getByTestId('panel-unread')).toHaveText('2')
    await expect(total(win)).toHaveText('Непрочитано: 3')

    // replying to a2 in branch a reads a2 only; a1 stays unread
    await panel(win, 'a').click()
    await expect(win.getByTestId('thread')).toHaveAttribute('data-thread-id', 'a')
    await selectText(win.locator('[data-message-id=a2]'), 'Ответ Анны')
    await win.getByTestId('reply-to-this').click()
    // the new branch is shown (a branch header was already on screen, so wait for the thread to change)
    await expect(win.getByTestId('thread')).not.toHaveAttribute('data-thread-id', 'a')
    await expect(win.getByTestId('branch-header')).toBeVisible()
    await expect(win.locator('[data-message-id=a2]')).toHaveAttribute('data-unread', 'false')
    await expect(win.locator('[data-message-id=a1]')).toHaveAttribute('data-unread', 'true') // inherited, still unread
    await expect(panel(win, 'a').getByTestId('panel-unread')).toHaveText('1')
})

test('inherited context shows unread messages too, and they can be marked there (FR-110)', async () => {
    const file = await craft()
    const { win } = await open(file, await profile())
    await panel(win, 'b').click()

    // b's context: m1, m2, a1 — all by others, all unread
    await expect(win.getByTestId('inherited-message')).toHaveCount(3)
    await expect(win.locator('[data-testid=inherited-message][data-unread=true]')).toHaveCount(3)
    await expect(win.getByTestId('thread-unread')).toHaveText('Непрочитано здесь: 1') // b1; context is counted in its own thread

    await win
        .locator('[data-testid=inherited-message][data-message-id=m1]')
        .getByTestId('mark-read')
        .click()
    await expect(win.locator('[data-message-id=m1]')).toHaveAttribute('data-unread', 'false')
    await expect(win.getByTestId('panel-main').getByTestId('panel-unread')).toHaveText('2') // the main thread's count dropped
    await expect(total(win)).toHaveText('Непрочитано: 5')
})

test('every message shows who has read it: all, some or none of the other known participants (FR-122 to FR-124)', async () => {
    const file = join(await workDir(), 'кто-прочитал.branchchat')
    await writeDiscussionFile(
        file,
        [
            {
                id: 'main',
                messages: [
                    { id: 'x1', author: 'boris', content: simple('Прочитали все.') },
                    { id: 'x2', author: 'boris', content: simple('Прочитала только Анна.') },
                    { id: 'x3', author: 'boris', content: simple('Не прочитал никто.') },
                    {
                        id: 'x4',
                        author: 'anna',
                        content: simple('Сообщение Анны, его прочёл Борис.')
                    }
                ]
            }
        ],
        {
            people: ['anna', 'boris', 'clara'],
            readState: { 'p-anna': ['x1', 'x2'], 'p-clara': ['x1'], 'p-boris': ['x4'] }
        }
    )
    const { win } = await open(file, await profile())
    const indicator = (id: string): Locator =>
        win.locator(`[data-message-id=${id}]`).getByTestId('message-mark')

    // D-41: two green checks = read by all, one green check = read by some, no mark = nobody has read
    await expect(indicator('x1')).toHaveAttribute('data-state', 'read-all') // Анна and Клара (the author Борис is not counted)
    await expect(indicator('x2')).toHaveAttribute('data-state', 'read-some')
    await expect(indicator('x3')).toHaveCount(0)
    await expect(indicator('x4')).toHaveAttribute('data-state', 'read-some') // author Анна excluded: Борис yes, Клара no
    await expect(indicator('x1')).toHaveText('✓✓')
    await expect(indicator('x2')).toHaveText('✓')

    // names on hover (tooltip) and on click (list); the author is never listed
    await expect(indicator('x2')).toHaveAttribute(
        'title',
        /Прочитали: Анна\. Не прочитали: Клара\./
    )
    await indicator('x2').click()
    await expect(win.getByTestId('read-by')).toHaveText('Анна')
    await expect(win.getByTestId('not-read-by')).toHaveText('Клара')
    await win.keyboard.press('Escape')
    await expect(win.getByTestId('mark-popover')).toHaveCount(0)

    // the local user never wrote to the file, so they are not a known participant and are listed nowhere
    await expect(win.getByText('Вера')).toHaveCount(0)

    // after the first change of read state they become one: now they count as someone who has (not) read
    await win.locator('[data-message-id=x3]').getByTestId('mark-read').click()
    await expect(indicator('x3')).toHaveAttribute('data-state', 'read-some') // Вера has read it, Анна and Клара have not
    await expect(indicator('x1')).toHaveAttribute('data-state', 'read-some') // Вера has not read x1
    await indicator('x1').click()
    await expect(win.getByTestId('not-read-by')).toHaveText('Вера')
})

test('exchange: A writes, B reads and replies, A opens the returned file and sees it all (acceptance criterion 22)', async () => {
    const dir = await workDir()
    const file = join(dir, 'обмен.branchchat')
    const profileA = await profile({ id: 'p-a', name: 'Анна', ack: true })
    const profileB = await profile({ id: 'p-b', name: 'Борис', ack: false })

    // A creates the discussion and writes
    const first = await launchApp({ userData: profileA })
    apps.push(first)
    const a1 = await first.app.firstWindow()
    await first.answer({ save: [file] })
    await a1.getByTestId('launcher-new').click()
    await expect(a1.getByTestId('composer')).toBeVisible()
    await a1.getByTestId('composer').click()
    await a1.keyboard.type('Вопрос про ёлку')
    await a1.keyboard.press('Control+Enter')
    await expect(a1.getByTestId('status')).toHaveText('Сохранено')
    await first.close()
    const questionId = (await readDiscussionFile(file)).discussion.threads[0]!.messages[0]!
        .messageId

    // B opens the file: the question is unread; replying in a branch reads it (after the one-time notice)
    const second = await open(file, profileB)
    await expect(second.win.locator(`[data-message-id="${questionId}"]`)).toHaveAttribute(
        'data-unread',
        'true'
    )
    await expect.poll(() => windowTitle(second.t)).toContain('(1)')
    await selectText(second.win.locator(`[data-message-id="${questionId}"]`), 'ёлку')
    await second.win.getByTestId('reply-to-this').click()
    await second.win.getByTestId('read-notice-confirm').click()
    await expect(second.win.getByTestId('branch-header')).toBeVisible()
    await second.win.getByTestId('composer').click()
    await second.win.keyboard.type('Ответ про ёлку')
    await second.win.keyboard.press('Control+Enter')
    await expect(
        second.win.getByTestId('message').filter({ hasText: 'Ответ про ёлку' })
    ).toHaveCount(1)
    await expect(second.win.getByTestId('status')).toHaveText('Сохранено')
    await second.t.close()
    const afterB = await readReadState(file)
    expect(afterB['p-b']).toEqual([questionId])

    // A opens the returned file
    const third = await open(file, profileA)
    const question = third.win.locator(`[data-message-id="${questionId}"]`)
    await expect(question).toHaveAttribute('data-unread', 'false') // A wrote it
    await expect(question.getByTestId('message-mark')).toHaveAttribute('data-state', 'read-all') // B read it
    await question.getByTestId('message-mark').click()
    await expect(third.win.getByTestId('read-by')).toHaveText('Борис')
    await third.win.keyboard.press('Escape')

    // B's reply is unread for A, with a count on the branch and in the title
    await expect(total(third.win)).toHaveText('Непрочитано: 1')
    await expect.poll(() => windowTitle(third.t)).toContain('(1)')
    await third.win.getByTestId('panel-branch').click()
    const reply = third.win.getByTestId('message').filter({ hasText: 'Ответ про ёлку' })
    await expect(reply).toHaveAttribute('data-unread', 'true')
    await expect(reply.getByTestId('message-mark')).toHaveCount(0)

    // A marks it read: A's entry is added, B's entry is untouched (FR-120)
    await reply.getByTestId('mark-read').click()
    await expect(reply).toHaveAttribute('data-unread', 'false')
    await expect(reply.getByTestId('message-mark')).toHaveAttribute('data-state', 'read-all')
    await expect
        .poll(async () => Object.keys(await readReadState(file)).sort())
        .toEqual(['p-a', 'p-b'])
    const final = await readReadState(file)
    expect(final['p-b']).toEqual(afterB['p-b'])
    const replyId = (await reply.getAttribute('data-message-id'))!
    expect(final['p-a']).toEqual([replyId])
})
