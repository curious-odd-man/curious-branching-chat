import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { describeRecent } from '../../src/main/application/recentView'
import { recentSubmenu } from '../../src/main/application/recentMenu'
import { RecentFilesStore } from '../../src/main/local-state/recentFiles'
import { jumpListCategories } from '../../src/main/windows/jumpListCategories'
import { withTempDir } from '../helpers/fixtures'

const view = (name: string, exists = true) => ({
    path: `C:\\Обсуждения\\${name}.branchchat`,
    name,
    directory: 'C:\\Обсуждения',
    exists
})

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

describe('recent files in the windows, the menu and the jump list', () => {
    it('describes entries and marks the missing ones', async () => {
        const views = await describeRecent(
            [
                { path: '/papka/Ёлка.branchchat', openedAt: '2026-01-01T00:00:00Z' },
                { path: '/papka/gone.branchchat', openedAt: '2026-01-01T00:00:00Z' }
            ],
            (p) => Promise.resolve(!p.includes('gone'))
        )
        expect(views).toEqual([
            { path: '/papka/Ёлка.branchchat', name: 'Ёлка', directory: '/papka', exists: true },
            { path: '/papka/gone.branchchat', name: 'gone', directory: '/papka', exists: false }
        ])
    })

    it('menu: entries, missing ones disabled, then Clear; an empty list shows a disabled note', () => {
        const opened: string[] = []
        const items = recentSubmenu(
            [view('один'), view('два', false)],
            (p) => opened.push(p),
            () => undefined
        )
        expect(items.map((i) => i.label ?? i.type)).toEqual([
            'один',
            'два (не найден)',
            'separator',
            'Очистить список'
        ])
        expect(items[1]!.enabled).toBe(false)
        ;(items[0]!.click as () => void)()
        expect(opened).toEqual([view('один').path])
        const empty = recentSubmenu(
            [],
            () => undefined,
            () => undefined
        )
        expect(empty).toEqual([{ label: 'Список пуст', enabled: false }])
    })

    it('jump list: one "Недавние" category that starts BranchChat with the file; missing files are left out', () => {
        const categories = jumpListCategories(
            [view('один'), view('два', false)],
            'C:\\BranchChat.exe'
        )
        expect(categories).toHaveLength(1)
        expect(categories[0]).toMatchObject({ type: 'custom', name: 'Недавние' })
        expect(categories[0]!.items).toEqual([
            expect.objectContaining({
                type: 'task',
                title: 'один',
                program: 'C:\\BranchChat.exe',
                args: '"C:\\Обсуждения\\один.branchchat"'
            })
        ])
        expect(jumpListCategories([], 'x')).toEqual([])
    })
})
