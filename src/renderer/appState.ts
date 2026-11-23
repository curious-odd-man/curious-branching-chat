import type { MenuCommand, MigrationCandidate } from '@shared/types/ipc'
import type { ReinviteTarget, WizardMode } from './components/wizard/SharedWizard'

/** The dialogs of the window, and the requests to open a part of the discussion screen (code review 4.4). */
export interface AppState {
    /** The simple dialogs that are open. */
    open: ReadonlySet<SimpleDialog>
    wizard: { mode: WizardMode; target?: ReinviteTarget } | null
    /** FR-206: the discussion files of the earlier storage. */
    migration: MigrationCandidate[] | null
    /** FR-125: the action that waits for the read notice. */
    readNotice: { retry: () => void } | null
    /** FR-019: the action that waits for the name of the person. */
    askName: { run: () => void } | null
    /** The discussion whose deletion the person is asked to confirm. */
    deleting: string | null
    /** Each new value opens that part of the discussion screen (Ctrl+G, Ctrl+F, Ctrl+Shift+M). */
    requests: { jump: number; find: number; branchMap: number }
}

export type SimpleDialog = 'settings' | 'shortcuts' | 'restore' | 'searchAll' | 'askTitle'

export type AppAction =
    | { type: 'open'; dialog: SimpleDialog }
    | { type: 'close'; dialog: SimpleDialog }
    | { type: 'wizard'; mode: WizardMode; target?: ReinviteTarget }
    | { type: 'closeWizard' }
    | { type: 'migration'; candidates: MigrationCandidate[] | null }
    | { type: 'readNotice'; retry: (() => void) | null }
    | { type: 'askName'; run: (() => void) | null }
    | { type: 'request'; part: keyof AppState['requests'] }
    | { type: 'delete'; id: string | null }

export const INITIAL_APP_STATE: AppState = {
    open: new Set(),
    wizard: null,
    migration: null,
    readNotice: null,
    askName: null,
    deleting: null,
    requests: { jump: 0, find: 0, branchMap: 0 }
}

export function appReducer(state: AppState, action: AppAction): AppState {
    switch (action.type) {
        case 'open':
        case 'close': {
            const open = new Set(state.open)
            if (action.type === 'open') open.add(action.dialog)
            else open.delete(action.dialog)
            return { ...state, open }
        }
        case 'wizard':
            return {
                ...state,
                wizard: { mode: action.mode, ...(action.target ? { target: action.target } : {}) }
            }
        case 'closeWizard':
            return { ...state, wizard: null }
        case 'migration':
            return { ...state, migration: action.candidates }
        case 'readNotice':
            return { ...state, readNotice: action.retry ? { retry: action.retry } : null }
        case 'askName':
            return { ...state, askName: action.run ? { run: action.run } : null }
        case 'delete':
            return { ...state, deleting: action.id }
        case 'request':
            return {
                ...state,
                requests: { ...state.requests, [action.part]: state.requests[action.part] + 1 }
            }
    }
}

/** What the window shows, as far as the menu commands need it. */
export interface MenuContext {
    /** A discussion is shown. */
    hasDiscussion: boolean
    /** The shown discussion is synchronized. */
    synced: boolean
}

/**
 * The state change of a menu command, or null when the command does nothing now. `new`, `open` and `settings` need the
 * main process and are handled by the window itself (`undefined`).
 */
export function menuAction(
    command: MenuCommand,
    context: MenuContext
): AppAction | null | undefined {
    switch (command) {
        case 'new':
        case 'open':
        case 'settings':
            return undefined
        case 'new-shared':
            return { type: 'wizard', mode: 'new' }
        case 'join-shared':
            return { type: 'wizard', mode: 'join' }
        case 'shortcuts':
            return { type: 'open', dialog: 'shortcuts' }
        case 'jump-to-date':
            return { type: 'request', part: 'jump' }
        case 'restore':
            return { type: 'open', dialog: 'restore' }
        case 'find':
            return context.hasDiscussion ? { type: 'request', part: 'find' } : null
        case 'find-all':
            return { type: 'open', dialog: 'searchAll' }
        case 'branch-map':
            return context.hasDiscussion ? { type: 'request', part: 'branchMap' } : null
        case 'invite-member':
            return context.synced ? { type: 'wizard', mode: 'invite' } : null
        case 'make-shared':
            return context.hasDiscussion && !context.synced
                ? { type: 'wizard', mode: 'convert' }
                : null
    }
}
