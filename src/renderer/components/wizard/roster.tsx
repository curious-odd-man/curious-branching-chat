import { useEffect, useState } from 'react'
import { texts } from '@shared/i18n'
import type { RosterView } from '@shared/types/ipc'
import { useApi } from '../../api'
import { Modal } from '../Modal'
import type { ReinviteTarget } from './candidates'
import { POLL_MS } from './useWizard'

const stateLabel = (state: 'self' | 'invited' | 'joined' | 'member'): string =>
    ({
        self: texts().shared.stateSelf,
        invited: texts().shared.stateInvited,
        joined: texts().shared.stateJoined,
        member: texts().shared.stateMember
    })[state]

export function RosterList({
    roster,
    onReinvite
}: {
    roster: RosterView
    /** FR-177: re-invite a member who lost the keys. */
    onReinvite?: (target: ReinviteTarget) => void
}): React.JSX.Element {
    return (
        <ul className="candidates" data-testid="roster">
            {roster.members.map((m) => (
                <li
                    key={m.participantId}
                    data-testid="roster-member"
                    data-name={m.displayName}
                    data-state={m.state}
                >
                    <span className="candidate-name">{m.displayName}</span>
                    <code className="fingerprint">{m.fingerprint}</code>
                    <span className="roster-state">{stateLabel(m.state)}</span>
                    <span className="roster-added" data-testid="roster-added-by">
                        {m.addedByName
                            ? texts().shared.addedBy(m.addedByName)
                            : texts().shared.creator}
                    </span>
                    {onReinvite && m.state !== 'self' && (
                        <button
                            type="button"
                            className="link-button"
                            data-testid="roster-reinvite"
                            onClick={() =>
                                onReinvite({
                                    participantId: m.participantId,
                                    displayName: m.displayName,
                                    fingerprint: m.fingerprint
                                })
                            }
                        >
                            {texts().shared.reinviteTitle}…
                        </button>
                    )}
                </li>
            ))}
        </ul>
    )
}

/** The last screen of a wizard that created or changed a synchronized discussion: who has joined. */
export function RosterScreen({
    roster,
    onClose
}: {
    roster: RosterView
    onClose(): void
}): React.JSX.Element {
    return (
        <Modal labelledBy="wizard-title" onEscape={onClose}>
            <div className="dialog settings wizard" data-testid="shared-roster">
                <h2 id="wizard-title">{texts().shared.rosterTitle}</h2>
                <RosterList roster={roster} />
                <div className="buttons">
                    <button
                        type="button"
                        className="primary"
                        data-testid="wizard-close"
                        onClick={onClose}
                    >
                        {texts().shared.close}
                    </button>
                </div>
            </div>
        </Modal>
    )
}

/** The members of the open synchronized discussion (header button "Участники"). */
export function RosterDialog({
    onClose,
    onInvite,
    onReinvite
}: {
    onClose(): void
    /** FR-176: opens the invite wizard. */
    onInvite(): void
    /** FR-177: opens the re-invite wizard for a member. */
    onReinvite(target: ReinviteTarget): void
}): React.JSX.Element {
    const api = useApi()
    const [roster, setRoster] = useState<RosterView | null>(null)
    useEffect(() => {
        const load = (): void => void api.getRoster().then((r) => r.ok && setRoster(r.data))
        load()
        const timer = setInterval(load, POLL_MS)
        return () => clearInterval(timer)
    }, [api])
    return (
        <Modal labelledBy="roster-title" onEscape={onClose}>
            <div className="dialog settings wizard" data-testid="roster-dialog">
                <h2 id="roster-title">{texts().shared.rosterTitle}</h2>
                {roster && <RosterList roster={roster} onReinvite={onReinvite} />}
                <div className="buttons">
                    <button type="button" data-testid="roster-invite" onClick={onInvite}>
                        {texts().shared.inviteTitle}…
                    </button>
                    {/* focus inside the dialog, so Escape and Tab work at once */}
                    <button
                        type="button"
                        className="primary"
                        data-testid="roster-close"
                        autoFocus
                        onClick={onClose}
                    >
                        {texts().shared.close}
                    </button>
                </div>
            </div>
        </Modal>
    )
}
