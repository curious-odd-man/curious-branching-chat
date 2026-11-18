import type { CandidateView } from '@shared/types/ipc'

/** The keys the wizard offers, and the choice of the person for each (FR-158). */
export interface CandidateState {
    candidates: CandidateView[]
    accepted: ReadonlySet<string>
    /** Keys the person took out again: shown as "discarded". */
    discarded: ReadonlySet<string>
}

export type CandidateAction =
    /** A new read of the shared folder: new keys are added, known keys are updated. */
    | { type: 'merge'; list: CandidateView[] }
    /** A key from a file or from the clipboard: it is accepted at once. */
    | { type: 'add'; candidate: CandidateView }
    | { type: 'toggle'; participantId: string; accept: boolean }

export const NO_CANDIDATES: CandidateState = {
    candidates: [],
    accepted: new Set(),
    discarded: new Set()
}

const withItem = (set: ReadonlySet<string>, id: string, on: boolean): Set<string> => {
    const next = new Set(set)
    if (on) next.add(id)
    else next.delete(id)
    return next
}

export function candidateReducer(state: CandidateState, action: CandidateAction): CandidateState {
    switch (action.type) {
        case 'merge': {
            const byId = new Map(state.candidates.map((c) => [c.participantId, c]))
            for (const c of action.list) byId.set(c.participantId, c)
            return { ...state, candidates: [...byId.values()] }
        }
        case 'add': {
            const id = action.candidate.participantId
            return {
                candidates: [
                    ...state.candidates.filter((x) => x.participantId !== id),
                    action.candidate
                ],
                accepted: withItem(state.accepted, id, true),
                discarded: withItem(state.discarded, id, false)
            }
        }
        case 'toggle':
            return {
                ...state,
                accepted: withItem(state.accepted, action.participantId, action.accept),
                discarded: withItem(state.discarded, action.participantId, !action.accept)
            }
    }
}

/** The member to re-invite after key loss (FR-177). */
export interface ReinviteTarget {
    participantId: string
    displayName: string
    fingerprint: string
}

/**
 * The keys shown: not the keys of members. A re-invitation (FR-177) offers new keys only: not other members, and not
 * the key the member has now.
 */
export function shownCandidates(
    candidates: readonly CandidateView[],
    memberIds: ReadonlySet<string>,
    reinvite?: ReinviteTarget
): CandidateView[] {
    return candidates.filter((c) =>
        reinvite
            ? c.fingerprint !== reinvite.fingerprint &&
              (c.participantId === reinvite.participantId || !memberIds.has(c.participantId))
            : !memberIds.has(c.participantId)
    )
}

/** The key texts of the accepted keys among `list`. */
export const acceptedKeys = (list: readonly CandidateView[], state: CandidateState): string[] =>
    list.filter((c) => state.accepted.has(c.participantId)).map((c) => c.text)
