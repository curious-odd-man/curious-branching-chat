import { describe, expect, it } from 'vitest'
import type { ThreadContext } from '@shared/domain'
import type { DocumentView } from '@shared/types/ipc'
import { buildThreadRows, compareByClock } from '../../src/renderer/components/chat/threadRows'

type Loading = DocumentView['loading'][number]

const message = (messageId: string, clock: number, createdAt: string) =>
    ({
        messageId,
        clock,
        authorId: 'p-a',
        createdAt,
        content: { type: 'doc', content: [] }
    }) as never

const context = (own: unknown[]): ThreadContext =>
    ({
        thread: { threadId: 't-main' },
        path: [],
        inherited: [],
        own
    }) as unknown as ThreadContext

const loading = (
    messageId: string,
    clock: number,
    createdAt: string,
    threadId = 't-main'
): Loading => ({ messageId, clock, authorId: 'p-a', createdAt, threadId }) as unknown as Loading

const kinds = (rows: ReturnType<typeof buildThreadRows>): string[] =>
    rows.map((r) =>
        r.kind === 'message'
            ? r.message.messageId
            : r.kind === 'loading'
              ? `loading:${r.loading.messageId}`
              : r.kind === 'day'
                ? `day:${r.day}`
                : r.id
    )

describe('rows of the message list (FR-152, FR-241)', () => {
    it('orders by clock, then author, then message ID', () => {
        const a = { clock: 1, authorId: 'p-b', messageId: 'm1' }
        expect(compareByClock(a, { ...a, clock: 2 })).toBeLessThan(0)
        expect(compareByClock(a, { ...a, authorId: 'p-a' })).toBeGreaterThan(0)
        expect(compareByClock(a, { ...a, messageId: 'm2' })).toBeLessThan(0)
    })

    it('loading messages of this thread take their place in the clock order', () => {
        const day = '2026-11-18T09:00:00'
        const rows = buildThreadRows(
            context([message('m1', 1, day), message('m3', 3, day)]),
            [loading('m4', 4, day), loading('m2', 2, day), loading('x', 2, day, 't-other')],
            '2026-11-18'
        )
        expect(kinds(rows).filter((k) => !k.startsWith('day:'))).toEqual([
            'm1',
            'loading:m2',
            'm3',
            'loading:m4'
        ])
    })

    it('a day separator comes before the first message of each day', () => {
        const rows = buildThreadRows(
            context([
                message('m1', 1, '2026-11-16T09:00:00'),
                message('m2', 2, '2026-11-16T10:00:00'),
                message('m3', 3, '2026-11-18T09:00:00')
            ]),
            [],
            '2026-11-18'
        )
        expect(kinds(rows)).toEqual(['day:2026-11-16', 'm1', 'm2', 'day:2026-11-18', 'm3'])
    })
})
