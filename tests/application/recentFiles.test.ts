import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RecentFilesStore } from '../../src/main/local-state/recentFiles'
import { withTempDir } from '../helpers/fixtures'
import { ru } from '@shared/i18n/ru'
import { describeDiscussions } from '../../src/main/application/recentView'
import { recentSubmenu } from '../../src/main/application/recentMenu'
import { jumpListCategories } from '../../src/main/windows/jumpListCategories'
import { extractDiscussionIds } from '../../src/main/windows/launchArgs'
import type { DiscussionSummary } from '../../src/main/library'

describe('RecentFilesStore', () => {
    it('quick adds without waiting keep the newest list in the file', async () => {
        await withTempDir(async (dir) => {
            const store = new RecentFilesStore(dir)
            await store.load()
            await Promise.all(
                ['/a/1.branchchat', '/a/2.branchchat', '/a/3.branchchat'].map((p) =>
                    store.add(p, 2)
                )
            )
            const again = new RecentFilesStore(dir)
            await again.load()
            expect(again.list().map((e) => e.path)).toEqual(['/a/3.branchchat', '/a/2.branchchat'])
        })
    })

    it('keeps the newest first, moves a reopened file to the top, and remembers it across starts', async () => {
        await withTempDir(async (dir) => {
            const store = new RecentFilesStore(dir)
            await store.load()
            await store.add('/a/один.branchchat', 10)
            await store.add('/a/два.branchchat', 10)
            await store.add('/a/один.branchchat', 10)
            expect(store.list().map((e) => e.path)).toEqual([
                '/a/один.branchchat',
                '/a/два.branchchat'
            ])

            const next = new RecentFilesStore(dir)
            await next.load()
            expect(next.list().map((e) => e.path)).toEqual([
                '/a/один.branchchat',
                '/a/два.branchchat'
            ])
        })
    })

    it('cuts the list to the limit, trims when the limit is lowered, and 0 keeps nothing', async () => {
        await withTempDir(async (dir) => {
            const store = new RecentFilesStore(dir)
            await store.load()
            for (const n of [1, 2, 3, 4]) await store.add(`/a/${n}.branchchat`, 3)
            expect(store.list().map((e) => e.path)).toEqual([
                '/a/4.branchchat',
                '/a/3.branchchat',
                '/a/2.branchchat'
            ])
            await store.trim(1)
            expect(store.list().map((e) => e.path)).toEqual(['/a/4.branchchat'])
            await store.add('/a/5.branchchat', 0)
            expect(store.list()).toEqual([])
        })
    })

    it('removes one entry, clears all, and tells listeners', async () => {
        await withTempDir(async (dir) => {
            const store = new RecentFilesStore(dir)
            await store.load()
            let changes = 0
            store.onChange(() => changes++)
            await store.add('/a/1.branchchat', 10)
            await store.add('/a/2.branchchat', 10)
            await store.remove('/a/1.branchchat')
            expect(store.list().map((e) => e.path)).toEqual(['/a/2.branchchat'])
            await store.remove('/a/unknown.branchchat') // nothing to do, no notification
            await store.clear()
            expect(store.list()).toEqual([])
            expect(changes).toBe(4)
        })
    })

    it('treats an unreadable file as an empty list', async () => {
        await withTempDir(async (dir) => {
            await fs.writeFile(join(dir, 'recent.json'), '{ not json')
            const store = new RecentFilesStore(dir)
            await store.load()
            expect(store.list()).toEqual([])
            await store.add('/a/1.branchchat', 10) // and it works again afterwards
            expect(store.list()).toHaveLength(1)
        })
    })
})

describe('recent discussions in the windows, the menu and the jump list', () => {
    const summary = (id: string, extra: Partial<DiscussionSummary> = {}): DiscussionSummary => ({
        id,
        title: `Обсуждение ${id}`,
        createdAt: '2026-11-01T10:00:00.000Z',
        updatedAt: '2026-11-01T10:00:00.000Z',
        lastMessageAt: null,
        messageCount: 0,
        synced: false,
        conversationId: null,
        openedAt: null,
        ...extra
    })

    it('orders by last opened, then last message, then creation', () => {
        const list = describeDiscussions([
            summary('a', { createdAt: '2026-11-03T00:00:00.000Z' }),
            summary('b', { openedAt: '2026-11-02T00:00:00.000Z' }),
            summary('c', { lastMessageAt: '2026-11-04T00:00:00.000Z', messageCount: 3 }),
            summary('d', { openedAt: '2026-11-05T00:00:00.000Z', synced: true })
        ])
        expect(list.map((d) => d.id)).toEqual(['d', 'c', 'a', 'b'])
        expect(list[0]).toEqual({
            id: 'd',
            title: 'Обсуждение d',
            lastMessageAt: null,
            messageCount: 0,
            synced: true
        })
    })

    it('menu: the newest entries up to the limit; an empty list shows a disabled note', () => {
        const list = describeDiscussions([summary('a'), summary('b'), summary('c')])
        const opened: string[] = []
        const items = recentSubmenu(list, 2, (id) => opened.push(id))
        expect(items.map((i) => i.label)).toHaveLength(2)
        ;(items[0]!.click as () => void)()
        expect(opened).toEqual([list[0]!.id])
        expect(recentSubmenu([], 10, () => undefined)).toEqual([
            { label: ru.recent.menuEmpty, enabled: false }
        ])
    })

    it('jump list: one "Недавние" category that starts BranchChat with the discussion ID', () => {
        const list = describeDiscussions([summary('id-1')])
        const [category] = jumpListCategories(list, 'C:\\BranchChat.exe', 10)
        expect(category?.name).toBe(ru.recent.jumpListCategory)
        expect(category?.items?.[0]).toMatchObject({
            title: 'Обсуждение id-1',
            program: 'C:\\BranchChat.exe',
            args: '--discussion=id-1'
        })
        expect(jumpListCategories([], 'x', 10)).toEqual([])
        expect(
            extractDiscussionIds(['app.exe', '--discussion=id-1', '--discussion=bad id'])
        ).toEqual(['id-1'])
    })
})
