import { useCallback, useEffect, useReducer, useState } from 'react'
import type { IdentityView, RosterView, SettingsView, SharedFolderChoice } from '@shared/types/ipc'
import { useApi, useIpcAction, type IpcAction } from '../../api'
import {
    candidateReducer,
    NO_CANDIDATES,
    type CandidateAction,
    type CandidateState
} from './candidates'

export const POLL_MS = 2000

/** What every wizard has: the own key, the name, and one error line. */
export interface WizardBase extends IpcAction {
    identity: IdentityView | null
    hasName: boolean
    /** The own key is there and the person has a name. */
    ready: boolean
}

export function useWizardBase(settings: SettingsView | undefined): WizardBase {
    const api = useApi()
    const action = useIpcAction()
    const { load } = action
    const [identity, setIdentity] = useState<IdentityView | null>(null)
    useEffect(() => {
        void load(() => api.getIdentity(), setIdentity)
    }, [api, load])
    const hasName = Boolean(settings?.displayName)
    return { ...action, identity, hasName, ready: identity?.state === 'ready' && hasName }
}

/** The shared folder the person chooses (new, convert, join); `root` is set once the folder passed the test. */
export function useFolderChoice(base: WizardBase): {
    folder: SharedFolderChoice | null
    root: string | null
    choose(): void
} {
    const api = useApi()
    const [folder, setFolder] = useState<SharedFolderChoice | null>(null)
    const choose = (): void => {
        base.setError(null)
        void base.load(
            () => api.pickSharedFolder(),
            (data) => {
                if (data) setFolder(data)
            }
        )
    }
    return { folder, root: folder?.test.ok ? folder.path : null, choose }
}

/** After the folder is known: the own key goes into it (design 12.3), then `then` runs. */
export function usePublishedKey(base: WizardBase, root: string | null, then?: () => void): void {
    const api = useApi()
    const { ready, load } = base
    useEffect(() => {
        if (!root || !ready) return
        void load(
            () => api.publishOwnKey(root),
            () => then?.()
        )
    }, [api, root, ready, load, then])
}

/** The keys in the shared folder and the choice of the person. */
export function useCandidates(
    base: WizardBase,
    root: string | null
): { state: CandidateState; dispatch(action: CandidateAction): void; refresh(): void } {
    const api = useApi()
    const { load } = base
    const [state, dispatch] = useReducer(candidateReducer, NO_CANDIDATES)
    const refresh = useCallback(() => {
        if (!root) return
        void load(
            () => api.listCandidates(root),
            (list) => dispatch({ type: 'merge', list })
        )
    }, [api, root, load])
    usePublishedKey(base, root, refresh)
    return { state, dispatch, refresh }
}

/** The members after the wizard is done: read again every two seconds, so the person sees who joined. */
export function useRosterAfterDone(): {
    roster: RosterView | null
    /** Shows the members, or closes the wizard if the discussion is not synchronized. */
    showRoster(onNone: () => void): Promise<void>
} {
    const api = useApi()
    const [roster, setRoster] = useState<RosterView | null>(null)
    const shown = roster !== null
    useEffect(() => {
        if (!shown) return
        const timer = setInterval(() => {
            void api.getRoster().then((r) => r.ok && r.data && setRoster(r.data))
        }, POLL_MS)
        return () => clearInterval(timer)
    }, [api, shown])
    const showRoster = useCallback(
        async (onNone: () => void): Promise<void> => {
            const r = await api.getRoster()
            if (r.ok && r.data) setRoster(r.data)
            else onNone()
        },
        [api]
    )
    return { roster, showRoster }
}
