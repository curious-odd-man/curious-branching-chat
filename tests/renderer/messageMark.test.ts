import { describe, expect, it } from 'vitest'
import type { WhoHasRead } from '@shared/domain'
import { markState } from '../../src/renderer/components/chat/DeliveryMark'

const anna = { participantId: 'p-anna', displayName: 'Анна' }
const boris = { participantId: 'p-boris', displayName: 'Борис' }
const read = (state: WhoHasRead['state'], readers = state === 'none' ? [] : [anna]): WhoHasRead =>
    ({ state, others: [anna, boris], readers }) as WhoHasRead
const delivery = (state: 'pending' | 'written' | 'delivered') => ({ state, members: [] })

describe('combined mark of own messages (D-40)', () => {
    it('one grey check written, two grey checks delivered by all', () => {
        expect(markState(delivery('pending'), read('none'))).toBe('pending')
        expect(markState(delivery('written'), read('none'))).toBe('written')
        expect(markState(delivery('delivered'), read('none'))).toBe('delivered')
    })

    it('one green check read by at least one, two green checks read by all; reading wins over delivery', () => {
        expect(markState(delivery('written'), read('some'))).toBe('read-some')
        expect(markState(delivery('delivered'), read('some'))).toBe('read-some')
        expect(markState(delivery('written'), read('all', [anna, boris]))).toBe('read-all')
    })
})
