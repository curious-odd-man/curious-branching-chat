import { useState, type ReactNode } from 'react'
import { texts } from '@shared/i18n'
import type { CandidateView, InvitationView, SharedFolderChoice } from '@shared/types/ipc'
import { useApi } from '../../api'
import { Modal } from '../Modal'
import type { CandidateAction, CandidateState } from './candidates'
import type { WizardBase } from './useWizard'

/**
 * The frame of every wizard (design 12.3 to 12.5): title, introduction, the own key, the steps of the mode, the error
 * line, and the buttons.
 */
export function WizardFrame({
    base,
    mode,
    title,
    intro,
    head,
    onClose,
    action,
    children
}: {
    base: WizardBase
    mode: string
    title: string
    intro: string
    /** Shown after the introduction, before the key step. */
    head?: ReactNode
    onClose(): void
    /** The main button. */
    action: ReactNode
    children: ReactNode
}): React.JSX.Element {
    return (
        <Modal labelledBy="wizard-title" onEscape={onClose}>
            <div className="dialog settings wizard" data-testid="shared-wizard" data-mode={mode}>
                <h2 id="wizard-title">{title}</h2>
                <p className="hint">{intro}</p>
                {head}
                <KeyStep base={base} />
                {children}
                {base.error && (
                    <p className="error-text" role="alert" data-testid="wizard-error">
                        {base.error}
                    </p>
                )}
                <div className="buttons">
                    <button type="button" data-testid="wizard-cancel" onClick={onClose}>
                        {texts().shared.cancel}
                    </button>
                    {action}
                </div>
            </div>
        </Modal>
    )
}

/** The own key: its fingerprint, or why it is not there (private keys never leave this computer). */
function KeyStep({ base }: { base: WizardBase }): React.JSX.Element {
    const { identity, hasName } = base
    return (
        <section>
            <h3>{texts().shared.keyStep}</h3>
            {identity?.state === 'unavailable' && (
                <p className="error-text">{texts().shared.keysUnavailable}</p>
            )}
            {identity?.state === 'ready' && (
                <p className="fingerprint-row">
                    <span>{texts().identity.fingerprintLabel}: </span>
                    <code className="fingerprint" data-testid="wizard-own-fingerprint">
                        {identity.fingerprint}
                    </code>
                </p>
            )}
            {!hasName && (
                <p className="error-text" data-testid="wizard-name-first">
                    {texts().shared.nameFirst}
                </p>
            )}
            <p className="hint">{texts().shared.keyHint}</p>
        </section>
    )
}

/** The note that the application will start with Windows (shown until the person decided once). */
export function AutoStartNote({ show }: { show: boolean }): React.JSX.Element | null {
    if (!show) return null
    return (
        <p className="hint" data-testid="wizard-autostart">
            {texts().shared.autoStartNote}
        </p>
    )
}

/** The shared folder, and the result of its test (FR-162). */
export function FolderStep({
    folder,
    ready,
    onChoose
}: {
    folder: SharedFolderChoice | null
    ready: boolean
    onChoose(): void
}): React.JSX.Element {
    return (
        <section>
            <h3>{texts().shared.folderStep}</h3>
            <p className="hint">{texts().shared.folderHint}</p>
            <div className="buttons">
                {folder && (
                    <code className="path" data-testid="wizard-folder" title={folder.path}>
                        {folder.path}
                    </code>
                )}
                <button
                    type="button"
                    data-testid="wizard-choose-folder"
                    disabled={!ready}
                    onClick={onChoose}
                >
                    {texts().shared.chooseFolder}
                </button>
            </div>
            {folder && (
                <p
                    className={folder.test.ok ? 'ok' : 'error-text'}
                    data-testid="wizard-folder-test"
                    data-ok={folder.test.ok ? 'true' : 'false'}
                >
                    {folder.test.ok
                        ? texts().shared.folderOk
                        : texts().shared.folderFailed(
                              texts().shared.folderSteps[folder.test.step] ?? folder.test.step
                          )}
                </p>
            )}
        </section>
    )
}

/** The keys to accept: from the shared folder, from a file, or pasted (FR-158). */
export function MembersStep({
    base,
    shown,
    state,
    dispatch,
    onRefresh,
    onAdd
}: {
    base: WizardBase
    shown: readonly CandidateView[]
    state: CandidateState
    dispatch(action: CandidateAction): void
    onRefresh(): void
    /** A key from a file or from the clipboard. */
    onAdd(candidate: CandidateView): void
}): React.JSX.Element {
    const api = useApi()
    const [pasted, setPasted] = useState('')
    const addPasted = (): void => {
        base.setError(null)
        void base.load(
            () => api.parseKey(pasted),
            (candidate) => {
                onAdd(candidate)
                setPasted('')
            }
        )
    }
    const fromFile = (): void => {
        base.setError(null)
        void base.load(
            () => api.pickKeyFile(),
            (candidate) => {
                if (candidate) onAdd(candidate)
            }
        )
    }
    return (
        <section data-testid="wizard-members">
            <h3>{texts().shared.membersStep}</h3>
            <p className="hint">{texts().shared.membersHint}</p>
            {shown.length === 0 && <p className="hint">{texts().shared.noCandidates}</p>}
            <ul className="candidates">
                {shown.map((c) => (
                    <li key={c.participantId} data-testid="candidate" data-name={c.displayName}>
                        <span className="candidate-name">{c.displayName}</span>
                        <code className="fingerprint">{c.fingerprint}</code>
                        <span className="candidate-actions">
                            <label className="check">
                                <input
                                    type="checkbox"
                                    data-testid="candidate-accept"
                                    checked={state.accepted.has(c.participantId)}
                                    onChange={(e) =>
                                        dispatch({
                                            type: 'toggle',
                                            participantId: c.participantId,
                                            accept: e.target.checked
                                        })
                                    }
                                />
                                <span>
                                    {state.discarded.has(c.participantId)
                                        ? texts().shared.discarded
                                        : texts().shared.accept}
                                </span>
                            </label>
                        </span>
                    </li>
                ))}
            </ul>
            <div className="buttons">
                <button type="button" data-testid="wizard-refresh" onClick={onRefresh}>
                    {texts().shared.refresh}
                </button>
                <button type="button" data-testid="wizard-key-file" onClick={fromFile}>
                    {texts().shared.fromFile}
                </button>
            </div>
            <label>
                {texts().shared.pasteLabel}
                <textarea
                    data-testid="wizard-paste"
                    rows={2}
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                />
            </label>
            <div className="buttons">
                <button
                    type="button"
                    data-testid="wizard-add-pasted"
                    disabled={pasted.trim().length === 0}
                    onClick={addPasted}
                >
                    {texts().shared.addPasted}
                </button>
            </div>
        </section>
    )
}

/** Join: the invitation found in the shared folder, and the fingerprint of the person who invited. */
export function InvitationStep({
    invitation
}: {
    invitation: InvitationView | null
}): React.JSX.Element {
    return (
        <section data-testid="wizard-invitation" data-state={invitation?.state ?? 'waiting'}>
            {(!invitation || invitation.state === 'waiting') && (
                <p className="hint">{texts().shared.joinWaiting}</p>
            )}
            {invitation?.state === 'incomplete' && (
                <p className="hint">
                    {texts().shared.joinIncomplete(invitation.received, invitation.total)}
                    <progress max={invitation.total} value={invitation.received} />
                </p>
            )}
            {invitation?.state === 'already' && (
                <p className="hint">{texts().shared.joinAlready}</p>
            )}
            {invitation?.state === 'ready' && (
                <>
                    <h3 data-testid="invitation-from">
                        {texts().shared.joinReady(invitation.inviterName)}
                    </h3>
                    <p>«{invitation.title}»</p>
                    <p className="fingerprint-row">
                        <span>{texts().identity.fingerprintLabel}: </span>
                        <code className="fingerprint" data-testid="inviter-fingerprint">
                            {invitation.inviterFingerprint}
                        </code>
                    </p>
                    <p className="hint">{texts().shared.joinCheck}</p>
                    {invitation.rejoin && (
                        <p className="hint" data-testid="invitation-rejoin">
                            {texts().shared.rejoinNote}
                        </p>
                    )}
                </>
            )}
        </section>
    )
}
