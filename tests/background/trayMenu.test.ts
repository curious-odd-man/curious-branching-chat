import { describe, expect, it } from 'vitest'
import { trayMenuModel, type TrayDiscussion } from '../../src/main/background/trayMenu'

const healthy = { folder: 'ok' as const, quarantined: 0, needsUpdate: false, lastScanAt: null }
const d = (name: string, extra: Partial<TrayDiscussion> = {}): TrayDiscussion => ({
    conversationId: `c-${name}`,
    filePath: `C:\\Users\\x\\${name}.branchchat`,
    exists: true,
    health: healthy,
    ...extra
})
const labels = (items: ReturnType<typeof trayMenuModel>) =>
    items.map((i) =>
        i.kind === 'separator' ? '---' : i.kind === 'info' ? `(${i.label})` : i.label
    )

describe('tray menu (D-33, D-35, D-27)', () => {
    it('lists discussions by name, the sync state, "Проверить папки", and "Выход"', () => {
        expect(labels(trayMenuModel([d('Работа'), d('Отпуск')]))).toEqual([
            'Открыть',
            '---',
            '(Общие обсуждения)',
            'Отпуск',
            'Работа',
            '---',
            '(Синхронизация работает)',
            'Проверить папки',
            '---',
            'Выход'
        ])
    })

    it('shows a missing file with "Найти файл…", and each sync problem', () => {
        const items = trayMenuModel([
            d('Отпуск', { exists: false, health: null }),
            d('Работа', { health: { ...healthy, folder: 'missing' } }),
            d('Семья', { health: { ...healthy, quarantined: 2 } })
        ])
        expect(labels(items)).toEqual([
            'Открыть',
            '---',
            '(Общие обсуждения)',
            '(Файл не найден: Отпуск)',
            'Найти файл «Отпуск»…',
            'Работа',
            'Семья',
            '---',
            '(«Работа»: общая папка недоступна)',
            '(«Семья»: есть проблемы синхронизации)',
            'Проверить папки',
            '---',
            'Выход'
        ])
        expect(items.find((i) => i.kind === 'action' && i.label.startsWith('Найти'))).toMatchObject(
            {
                id: 'find:c-Отпуск'
            }
        )
    })
})
