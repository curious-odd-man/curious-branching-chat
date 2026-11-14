import { describe, expect, it } from 'vitest'
import { plainTextToRichDoc } from '@shared/domain'
import type { DocumentContents, Message } from '@shared/validation'
import { BackgroundService, type WindowsPort } from '../../src/main/background/backgroundService'
import type { TrayItem } from '../../src/main/background/trayMenu'
import { SettingsStore } from '../../src/main/local-state/settings'
import type { ConversationStatus, SyncService } from '../../src/main/sync/syncService'
import { withTempDir } from '../helpers/fixtures'

const FILE = '/data/Отпуск.branchchat'

interface World {
    service: BackgroundService
    settings: SettingsStore
    tray: { items: TrayItem[] | null; act(id: string): void; click(): void }
    notes: Array<{ title: string; body: string; click: () => void }>
    login: boolean[]
    quits: number
    shown: string[]
    statuses: ConversationStatus[]
    active: boolean
    windows: number
    adopted: Array<[string, string]>
    errors: string[]
    pick: string | null
    docIds: Record<string, string>
}

async function world(dir: string): Promise<World> {
    const settings = new SettingsStore(dir, () => 'p-anna')
    await settings.load()
    let action: (id: string) => void = () => undefined
    let click: () => void = () => undefined
    const w = {
        settings,
        tray: {
            items: null as TrayItem[] | null,
            act: (id: string) => action(id),
            click: () => click()
        },
        notes: [],
        login: [],
        quits: 0,
        shown: [],
        statuses: [{ conversationId: 'c1', filePath: FILE, health: null }],
        active: false,
        windows: 0,
        adopted: [],
        errors: [],
        pick: null,
        docIds: {}
    } as unknown as World
    const sync = {
        get count() {
            return w.statuses.length
        },
        statusList: () => w.statuses,
        checkAll: async () => w.shown.push('check'),
        adoptMovedFile: async (id: string, path: string) => {
            w.adopted.push([id, path])
        }
    } as unknown as SyncService
    const windows: WindowsPort = {
        get windowCount() {
            return w.windows
        },
        isActive: () => w.active,
        showAny: async () => {
            w.shown.push('any')
        },
        openPath: async (p) => {
            w.shown.push(`open ${p}`)
        },
        showMessage: async (p, t, m) => {
            w.shown.push(`message ${p} ${t} ${m}`)
        }
    }
    w.service = new BackgroundService({
        settings,
        sync,
        windows,
        tray: {
            show(items, onAction, onClick) {
                w.tray.items = [...items]
                action = onAction
                click = onClick
            },
            hide() {
                w.tray.items = null
            }
        },
        notifier: { show: (n) => w.notes.push({ title: n.title, body: n.body, click: n.onClick }) },
        loginItem: { set: (enabled) => w.login.push(enabled) },
        fileExists: async (p) => p === FILE,
        pickDiscussionFile: async () => w.pick,
        readDocumentId: async (p) => w.docIds[p] ?? null,
        showError: async (message) => {
            w.errors.push(message)
        },
        quit: () => {
            w.quits++
        }
    })
    return w
}

const message = (id: string, authorId = 'p-boris'): Message =>
    ({
        messageId: id,
        threadId: 't-main',
        authorId,
        authorDisplayName: 'Боря',
        content: plainTextToRichDoc(`текст ${id}`)
    }) as unknown as Message

const contents = {
    discussion: { participants: [{ participantId: 'p-boris', displayName: 'Борис' }] }
} as unknown as DocumentContents

describe('BackgroundService (release 1.4)', () => {
    it('stays in the tray when the last window closes, with the notice only the first time (D-33)', async () => {
        await withTempDir(async (dir) => {
            const w = await world(dir)
            await w.service.start()
            expect(w.tray.items).not.toBeNull()
            await w.service.windowsGone()
            expect(w.quits).toBe(0)
            expect(w.notes.map((n) => n.title)).toEqual(['BranchChat продолжает работать'])
            await w.service.windowsGone()
            expect(w.notes).toHaveLength(1)
        })
    })

    it('quits when no synchronized discussion exists, and hides the tray', async () => {
        await withTempDir(async (dir) => {
            const w = await world(dir)
            w.statuses = []
            await w.service.start()
            expect(w.tray.items).toBeNull()
            await w.service.windowsGone()
            expect(w.quits).toBe(1)
        })
    })

    it('"Выход" quits after the windows close; a cancelled close keeps the app (FR-141)', async () => {
        await withTempDir(async (dir) => {
            const w = await world(dir)
            await w.service.start()
            w.windows = 1
            w.tray.act('exit')
            expect(w.quits).toBe(1) // app.quit() starts closing the windows
            w.service.closeCancelled()
            await w.service.windowsGone()
            expect(w.quits).toBe(1) // the person kept a window open earlier; a later close goes to the tray
            w.tray.act('exit')
            await w.service.windowsGone()
            expect(w.quits).toBe(3)
        })
    })

    it('notifies about messages of others, but not when the window is active or the setting is off (D-33, D-42)', async () => {
        await withTempDir(async (dir) => {
            const w = await world(dir)
            const arrival = {
                conversationId: 'c1',
                filePath: FILE,
                messages: [message('m1')],
                contents
            }
            w.service.newMessages(arrival)
            expect(w.notes.map((n) => [n.title, n.body])).toEqual([['Борис — Отпуск', 'текст m1']])
            w.notes[0]!.click()
            expect(w.shown).toEqual([`message ${FILE} t-main m1`])
            w.active = true
            w.service.newMessages(arrival)
            expect(w.notes).toHaveLength(1)
            w.active = false
            await w.settings.setFlag('notifyShowText', false)
            w.service.newMessages(arrival)
            expect(w.notes[1]?.body).toBe('Новое сообщение')
            await w.settings.setFlag('notifyNewMessages', false)
            w.service.newMessages(arrival)
            expect(w.notes).toHaveLength(2)
        })
    })

    it('the first synchronized discussion turns on start with Windows once (FR-174)', async () => {
        await withTempDir(async (dir) => {
            const w = await world(dir)
            await w.service.start()
            expect(w.login).toEqual([false])
            await w.service.discussionAdded()
            await w.service.discussionAdded()
            expect(w.login).toEqual([false, true])
            await w.service.setFlag('startWithWindows', false)
            expect(w.login).toEqual([false, true, false])
            await w.service.discussionAdded()
            expect(w.login).toEqual([false, true, false])
        })
    })

    it('a missing file: "Найти файл…" accepts only the same discussion (D-27)', async () => {
        await withTempDir(async (dir) => {
            const w = await world(dir)
            w.statuses = [
                { conversationId: 'c2', filePath: '/gone/Работа.branchchat', health: null }
            ]
            await w.service.start()
            const find = w.tray.items!.find((i) => i.kind === 'action' && i.id === 'find:c2')
            expect(find).toBeDefined()
            w.pick = '/new/other.branchchat'
            w.docIds[w.pick] = 'c-other'
            w.tray.act('find:c2')
            await new Promise((r) => setTimeout(r, 10))
            expect(w.errors).toHaveLength(1)
            expect(w.adopted).toEqual([])
            w.pick = '/new/Работа.branchchat'
            w.docIds[w.pick] = 'c2'
            w.tray.act('find:c2')
            await new Promise((r) => setTimeout(r, 10))
            expect(w.adopted).toEqual([['c2', '/new/Работа.branchchat']])
            expect(w.shown).toContain('open /new/Работа.branchchat')
        })
    })

    it('a left click on the icon shows a window', async () => {
        await withTempDir(async (dir) => {
            const w = await world(dir)
            await w.service.start()
            w.tray.click()
            expect(w.shown).toEqual(['any'])
        })
    })
})
