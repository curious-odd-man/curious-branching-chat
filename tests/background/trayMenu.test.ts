import { describe, expect, it } from 'vitest'
import { trayMenuModel, type TrayDiscussion } from '../../src/main/background/trayMenu'

const healthy = {
    folder: 'ok' as const,
    quarantined: 0,
    needsUpdate: false,
    lastScanAt: null,
    keyRequests: [],
    rejoinHeardFrom: null,
    waitingFor: []
}
const d = (name: string, extra: Partial<TrayDiscussion> = {}): TrayDiscussion => ({
    conversationId: `c-${name}`,
    title: name,
    health: healthy,
    ...extra
})
const labels = (items: ReturnType<typeof trayMenuModel>) =>
    items.map((i) =>
        i.kind === 'separator' ? '---' : i.kind === 'info' ? `(${i.label})` : i.label
    )

describe('tray menu (D-33, D-35)', () => {
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

    it('shows each sync problem', () => {
        const items = trayMenuModel([
            d('Отпуск', { health: null }),
            d('Работа', { health: { ...healthy, folder: 'missing' } }),
            d('Семья', { health: { ...healthy, quarantined: 2 } })
        ])
        expect(labels(items)).toEqual([
            'Открыть',
            '---',
            '(Общие обсуждения)',
            'Отпуск',
            'Работа',
            'Семья',
            '---',
            '(«Работа»: общая папка недоступна)',
            '(«Семья»: есть проблемы синхронизации)',
            'Проверить папки',
            '---',
            'Выход'
        ])
        expect(items.find((i) => i.kind === 'action' && i.label === 'Отпуск')).toMatchObject({
            id: 'open:c-Отпуск'
        })
    })
})
