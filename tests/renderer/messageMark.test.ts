import { describe, expect, it } from 'vitest'
import { buildReadSets, messageMarkOf, type MarkSync } from '@shared/domain'
import type { Message } from '@shared/validation'

const anna = { participantId: 'p-anna', displayName: 'Анна' }
const boris = { participantId: 'p-boris', displayName: 'Борис' }
const clara = { participantId: 'p-clara', displayName: 'Клара' }
const all = [anna, boris, clara]

const msg = (authorId: string, messageId = 'm1'): Message =>
    ({ messageId, authorId }) as unknown as Message

const sync = (
    localId: string,
    delivery: Record<string, string[]> = {},
    copies: MarkSync['copies'] = {}
): MarkSync => ({ localId, deliverySets: buildReadSets(delivery), copies })

const states = (mark: ReturnType<typeof messageMarkOf>) =>
    Object.fromEntries((mark?.members ?? []).map((m) => [m.participant.participantId, m.state]))

describe('message mark in a synchronized discussion (D-41)', () => {
    it('own message: clock while not written, one grey check written, two grey checks delivered to all', () => {
        const none = buildReadSets({})
        expect(
            messageMarkOf(
                msg('p-anna'),
                all,
                none,
                sync('p-anna', {}, { m1: { 'p-boris': 'pending', 'p-clara': 'written' } })
            )?.state
        ).toBe('pending')
        expect(
            messageMarkOf(
                msg('p-anna'),
                all,
                none,
                sync('p-anna', {}, { m1: { 'p-boris': 'written', 'p-clara': 'delivered' } })
            )?.state
        ).toBe('written')
        expect(
            messageMarkOf(
                msg('p-anna'),
                all,
                none,
                sync(
                    'p-anna',
                    { 'p-boris': ['m1'] },
                    { m1: { 'p-boris': 'written', 'p-clara': 'delivered' } }
                )
            )?.state
        ).toBe('delivered')
    })

    it('a message of another member: written until all others have it; the own copy counts as received', () => {
        const none = buildReadSets({})
        const mark = messageMarkOf(msg('p-boris'), all, none, sync('p-anna'))
        expect(mark?.state).toBe('written')
        expect(states(mark)).toEqual({ 'p-anna': 'delivered', 'p-clara': 'written' })
        expect(
            messageMarkOf(msg('p-boris'), all, none, sync('p-anna', { 'p-clara': ['m1'] }))?.state
        ).toBe('delivered')
    })

    it('one green check read by at least one, two green checks read by all; reading wins over delivery', () => {
        const some = buildReadSets({ 'p-clara': ['m1'] })
        const mark = messageMarkOf(msg('p-boris'), all, some, sync('p-anna'))
        expect(mark?.state).toBe('read-some')
        expect(states(mark)).toEqual({ 'p-anna': 'delivered', 'p-clara': 'read' })
        const both = buildReadSets({ 'p-anna': ['m1'], 'p-clara': ['m1'] })
        expect(messageMarkOf(msg('p-boris'), all, both, sync('p-anna'))?.state).toBe('read-all')
        expect(
            messageMarkOf(
                msg('p-anna'),
                all,
                some,
                sync('p-anna', {}, { m1: { 'p-boris': 'pending', 'p-clara': 'pending' } })
            )?.state
        ).toBe('read-some')
    })

    it('the author does not count, and a discussion of one member has no mark', () => {
        const mark = messageMarkOf(
            msg('p-anna'),
            all,
            buildReadSets({ 'p-anna': ['m1'] }),
            sync('p-anna')
        )
        expect(mark?.state).toBe('written')
        expect(mark?.members.map((m) => m.participant.participantId)).toEqual([
            'p-boris',
            'p-clara'
        ])
        expect(messageMarkOf(msg('p-anna'), [anna], buildReadSets({}), sync('p-anna'))).toBeNull()
    })
})

describe('message mark in a normal discussion (D-41)', () => {
    it('no mark while nobody has read, one green check some, two green checks all', () => {
        expect(messageMarkOf(msg('p-anna'), all, buildReadSets({}), null)).toBeNull()
        const some = messageMarkOf(msg('p-anna'), all, buildReadSets({ 'p-boris': ['m1'] }), null)
        expect(some?.state).toBe('read-some')
        expect(states(some)).toEqual({ 'p-boris': 'read', 'p-clara': 'unread' })
        expect(
            messageMarkOf(
                msg('p-anna'),
                all,
                buildReadSets({ 'p-boris': ['m1'], 'p-clara': ['m1'] }),
                null
            )?.state
        ).toBe('read-all')
    })
})
