import { useEffect, useState } from 'react'
import { describeError, texts } from '@shared/i18n'
import type { CandidateView, SettingsView } from '@shared/types/ipc'
import { useApi } from '../../api'
import { acceptedKeys, shownCandidates, type ReinviteTarget } from './candidates'
import { RosterScreen } from './roster'
import { MembersStep, WizardFrame } from './steps'
import { useCandidates, useRosterAfterDone, useWizardBase } from './useWizard'

/**
 * Invite more members to the open synchronized discussion (FR-176), or invite a member again with a new key after key
 * loss (FR-177, `target`). The shared folder and the members come from the open discussion.
 */
export function InviteWizard({
    mode,
    settings,
    target,
    onClose
}: {
    mode: 'invite' | 'reinvite'
    settings: SettingsView | undefined
    /** Set for a re-invitation. */
    target?: ReinviteTarget | undefined
    onClose(): void
}): React.JSX.Element {
    const api = useApi()
    const base = useWizardBase(settings)
    const { setError } = base
    const [root, setRoot] = useState<string | null>(null)
    const [memberIds, setMemberIds] = useState<ReadonlySet<string>>(new Set())
    const { state, dispatch, refresh } = useCandidates(base, root)
    const { roster, showRoster } = useRosterAfterDone()
    const reinvite = mode === 'reinvite'

    useEffect(() => {
        void api.getRoster().then((r) => {
            if (r.ok && r.data) {
                setRoot(r.data.sharedRoot)
                setMemberIds(new Set(r.data.members.map((m) => m.participantId)))
            } else setError(describeError('NOT_SHARED'))
        })
    }, [api, setError])

    if (roster) return <RosterScreen roster={roster} onClose={onClose} />

    const shown = shownCandidates(state.candidates, memberIds, reinvite ? target : undefined)
    const chosen = acceptedKeys(shown, state)

    const add = (candidate: CandidateView): void => {
        if (!reinvite && memberIds.has(candidate.participantId)) {
            setError(describeError('ALREADY_MEMBER'))
            return
        }
        dispatch({ type: 'add', candidate })
    }

    const send = (): void => {
        setError(null)
        if (reinvite) {
            // FR-177: exactly one new key; it replaces the keys of the target member
            const key = chosen[0]
            if (!target || !key) return
            void base.run(
                () => api.reinviteMember(target.participantId, key),
                () => showRoster(onClose)
            )
        } else
            void base.run(
                () => api.inviteMembers(acceptedKeys(state.candidates, state)),
                () => showRoster(onClose)
            )
    }
    return (
        <WizardFrame
            base={base}
            mode={mode}
            title={
                reinvite
                    ? `${texts().shared.reinviteTitle}: ${target?.displayName ?? ''}`
                    : texts().shared.inviteTitle
            }
            intro={
                reinvite
                    ? texts().shared.reinviteIntro(target?.displayName ?? '')
                    : texts().shared.inviteIntro
            }
            head={
                reinvite &&
                target && (
                    <p className="fingerprint-row">
                        <span>{texts().shared.reinviteCurrent}: </span>
                        <code className="fingerprint" data-testid="reinvite-old-fingerprint">
                            {target.fingerprint}
                        </code>
                    </p>
                )
            }
            onClose={onClose}
            action={
                <button
                    type="button"
                    className="primary"
                    data-testid={reinvite ? 'wizard-reinvite' : 'wizard-invite'}
                    disabled={
                        base.busy ||
                        !root ||
                        !base.ready ||
                        (reinvite ? chosen.length !== 1 : chosen.length === 0)
                    }
                    onClick={send}
                >
                    {reinvite ? texts().shared.reinviteSend : texts().shared.inviteSend}
                </button>
            }
        >
            {root && (
                <MembersStep
                    base={base}
                    shown={shown}
                    state={state}
                    dispatch={dispatch}
                    onRefresh={refresh}
                    onAdd={add}
                />
            )}
        </WizardFrame>
    )
}
