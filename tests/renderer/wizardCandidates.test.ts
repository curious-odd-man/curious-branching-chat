import { describe, expect, it } from 'vitest'
import type { CandidateView } from '@shared/types/ipc'
import {
    acceptedKeys,
    candidateReducer,
    NO_CANDIDATES,
    shownCandidates
} from '../../src/renderer/components/wizard/candidates'

const key = (participantId: string, fingerprint = `F-${participantId}`): CandidateView => ({
    participantId,
    displayName: participantId,
    fingerprint,
    text: `key-${participantId}-${fingerprint}`
})

describe('keys in the wizards (FR-158, FR-176, FR-177)', () => {
    it('a new read adds new keys and updates known ones, without changing the choice', () => {
        let s = candidateReducer(NO_CANDIDATES, { type: 'merge', list: [key('a'), key('b')] })
        s = candidateReducer(s, { type: 'toggle', participantId: 'a', accept: true })
        s = candidateReducer(s, { type: 'merge', list: [key('a', 'F-new'), key('c')] })
        expect(s.candidates.map((c) => c.fingerprint)).toEqual(['F-new', 'F-b', 'F-c'])
        expect([...s.accepted]).toEqual(['a'])
    })

    it('a pasted key is accepted at once and replaces the key of the same person', () => {
        let s = candidateReducer(NO_CANDIDATES, { type: 'merge', list: [key('a'), key('b')] })
        s = candidateReducer(s, { type: 'toggle', participantId: 'b', accept: false })
        expect([...s.discarded]).toEqual(['b'])
        s = candidateReducer(s, { type: 'add', candidate: key('b', 'F-pasted') })
        expect(s.candidates.map((c) => c.fingerprint)).toEqual(['F-a', 'F-pasted'])
        expect([...s.accepted]).toEqual(['b'])
        expect([...s.discarded]).toEqual([])
    })

    it('an invitation does not offer members again', () => {
        const shown = shownCandidates([key('a'), key('b')], new Set(['a']))
        expect(shown.map((c) => c.participantId)).toEqual(['b'])
    })

    it('a re-invitation offers new keys of the member and keys of others, not the old key', () => {
        const target = { participantId: 'a', displayName: 'a', fingerprint: 'F-old' }
        const shown = shownCandidates(
            [key('a', 'F-old'), key('a', 'F-new'), key('m'), key('x')],
            new Set(['a', 'm']),
            target
        )
        expect(shown.map((c) => c.fingerprint)).toEqual(['F-new', 'F-x'])
    })

    it('gives the key texts of the accepted keys of a list', () => {
        let s = candidateReducer(NO_CANDIDATES, { type: 'merge', list: [key('a'), key('b')] })
        s = candidateReducer(s, { type: 'toggle', participantId: 'b', accept: true })
        expect(acceptedKeys(s.candidates, s)).toEqual(['key-b-F-b'])
    })
})
