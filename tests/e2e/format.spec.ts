import { expect, test, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { cleanup, launchApp, tempDir, type TestApp } from './helpers/app'
import { simple, writeDiscussionFile } from './helpers/craft'
import { readEntries } from './helpers/readFile'

const apps: TestApp[] = []
const dirs: string[] = []
test.afterEach(async () => {
    await Promise.all(apps.splice(0).map((a) => a.close()))
    await cleanup(...dirs.splice(0))
})

async function namedProfile(): Promise<string> {
    const dir = await tempDir('bc-profile-')
    dirs.push(dir)
    await fs.writeFile(
        join(dir, 'settings.json'),
        JSON.stringify({
            participantId: 'p-local',
            displayName: 'Вера',
            readNoticeAcknowledged: true
        })
    )
    return dir
}

interface RawMessage {
    messageId: string
    sequence: number
    clock: number
}
interface RawThread {
    threadId: string
    clock: number
    messages: RawMessage[]
}

async function rawFile(path: string): Promise<{ version: number; threads: RawThread[] }> {
    const entries = await readEntries(path)
    const manifest = JSON.parse(entries.get('manifest.json')!.toString('utf8')) as {
        schemaVersion: number
    }
    const discussion = JSON.parse(entries.get('discussion.json')!.toString('utf8')) as {
        threads: RawThread[]
    }
    return { version: manifest.schemaVersion, threads: discussion.threads }
}

async function send(win: Page, text: string): Promise<void> {
    await win.getByTestId('composer').fill(text)
    await win.getByTestId('send').click()
}

test('a version 1 file opens unchanged, and the next save writes version 2 with clocks (FR-151, FR-152)', async () => {
    const dir = await tempDir()
    dirs.push(dir)
    const file = join(dir, 'старый.branchchat')
    await writeDiscussionFile(file, [
        {
            id: 'main',
            messages: [
                { id: 'm1', author: 'anna', content: simple('Первое.') },
                { id: 'm2', author: 'boris', content: simple('Второе.') }
            ]
        },
        {
            id: 'b1',
            parent: 'main',
            source: 'm2',
            quote: 'Второе',
            messages: [{ id: 'b1m1', author: 'anna', content: simple('В ветке.') }]
        }
    ])
    const before = await fs.readFile(file)

    const t = await launchApp({ userData: await namedProfile(), files: [file] })
    apps.push(t)
    const win = await t.app.firstWindow()
    await expect(win.getByTestId('composer')).toBeVisible()
    await expect(win.getByText('Второе.')).toBeVisible()
    // opening alone never rewrites the file (FR-012)
    expect((await fs.readFile(file)).equals(before)).toBe(true)

    await send(win, 'Третье, уже в новом формате.')
    await expect.poll(async () => (await rawFile(file)).version, { timeout: 10_000 }).toBe(2)

    const { threads } = await rawFile(file)
    const main = threads.find((th) => th.threadId === 'main')!
    const branch = threads.find((th) => th.threadId === 'b1')!
    expect(main.clock).toBe(0)
    expect(branch.clock).toBeGreaterThan(0)
    expect(main.messages.map((m) => m.messageId).slice(0, 2)).toEqual(['m1', 'm2'])
    expect(main.messages).toHaveLength(3)
    expect(main.messages.map((m) => m.sequence)).toEqual([0, 1, 2])
    const clocks = main.messages.map((m) => m.clock)
    expect(clocks).toEqual([...clocks].sort((a, b) => a - b))
    // the new message has the highest clock in the file
    const all = threads.flatMap((th) => [th.clock, ...th.messages.map((m) => m.clock)])
    expect(main.messages[2]!.clock).toBe(Math.max(...all))
})
