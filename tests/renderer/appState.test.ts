import { describe, expect, it } from 'vitest'
import type { MenuCommand } from '@shared/types/ipc'
import { appReducer, INITIAL_APP_STATE, menuAction } from '../../src/renderer/appState'

describe('window state (code review 4.4)', () => {
    it('opens and closes simple dialogs independently', () => {
        let s = appReducer(INITIAL_APP_STATE, { type: 'open', dialog: 'settings' })
        s = appReducer(s, { type: 'open', dialog: 'restore' })
        s = appReducer(s, { type: 'close', dialog: 'settings' })
        expect([...s.open]).toEqual(['restore'])
        expect([...INITIAL_APP_STATE.open]).toEqual([])
    })

    it('each request has its own counter', () => {
        let s = appReducer(INITIAL_APP_STATE, { type: 'request', part: 'find' })
        s = appReducer(s, { type: 'request', part: 'find' })
        s = appReducer(s, { type: 'request', part: 'jump' })
        expect(s.requests).toEqual({ jump: 1, find: 2, branchMap: 0 })
    })

    it('a re-invitation keeps its member; an invitation has none', () => {
        const target = { participantId: 'p-b', displayName: 'Борис', fingerprint: 'F' }
        let s = appReducer(INITIAL_APP_STATE, { type: 'wizard', mode: 'reinvite', target })
        expect(s.wizard).toEqual({ mode: 'reinvite', target })
        s = appReducer(s, { type: 'wizard', mode: 'invite' })
        expect(s.wizard).toEqual({ mode: 'invite' })
        expect(appReducer(s, { type: 'closeWizard' }).wizard).toBeNull()
    })
})

describe('menu commands (code review 4.4)', () => {
    const none = { hasDiscussion: false, synced: false }
    const local = { hasDiscussion: true, synced: false }
    const shared = { hasDiscussion: true, synced: true }

    it('new, open and settings are left to the window', () => {
        for (const c of ['new', 'open', 'settings'] as MenuCommand[])
            expect(menuAction(c, local)).toBeUndefined()
    })

    it('find and the branch map need a discussion', () => {
        expect(menuAction('find', none)).toBeNull()
        expect(menuAction('find', local)).toEqual({ type: 'request', part: 'find' })
        expect(menuAction('branch-map', none)).toBeNull()
        expect(menuAction('branch-map', local)).toEqual({ type: 'request', part: 'branchMap' })
    })

    it('invite needs a synchronized discussion; convert needs one that is not', () => {
        expect(menuAction('invite-member', local)).toBeNull()
        expect(menuAction('invite-member', shared)).toEqual({ type: 'wizard', mode: 'invite' })
        expect(menuAction('make-shared', none)).toBeNull()
        expect(menuAction('make-shared', shared)).toBeNull()
        expect(menuAction('make-shared', local)).toEqual({ type: 'wizard', mode: 'convert' })
    })

    it('the other commands work without a discussion', () => {
        expect(menuAction('new-shared', none)).toEqual({ type: 'wizard', mode: 'new' })
        expect(menuAction('join-shared', none)).toEqual({ type: 'wizard', mode: 'join' })
        expect(menuAction('shortcuts', none)).toEqual({ type: 'open', dialog: 'shortcuts' })
        expect(menuAction('restore', none)).toEqual({ type: 'open', dialog: 'restore' })
        expect(menuAction('find-all', none)).toEqual({ type: 'open', dialog: 'searchAll' })
        expect(menuAction('jump-to-date', none)).toEqual({ type: 'request', part: 'jump' })
    })
})
