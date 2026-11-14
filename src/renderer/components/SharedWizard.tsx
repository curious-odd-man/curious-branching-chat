import { useCallback, useEffect, useState } from 'react'
import { Modal } from './Modal'
import { ru } from '@shared/i18n/ru'
import type {
    CandidateView,
    IdentityView,
    InvitationView,
    RosterView,
    SettingsView,
    SharedFolderChoice
} from '@shared/types/ipc'

export type WizardMode = 'new' | 'convert' | 'join'

interface Props {
    mode: WizardMode
    settings: SettingsView | undefined
    onClose(): void
}

const POLL_MS = 2000

const stepName: Record<string, string> = {
    root: 'папка не найдена',
    write: 'запись',
    read: 'чтение',
    delete: 'удаление'
}

/**
 * Wizards of synchronized discussions (design 12.3 to 12.5, FR-158, FR-162): create, convert the open discussion, or
 * join by invitation. The person checks every fingerprint; private keys never leave this computer.
 */
export function SharedWizard({ mode, settings, onClose }: Props): React.JSX.Element {
    const api = window.branchchat
    const [identity, setIdentity] = useState<IdentityView | null>(null)
    const [folder, setFolder] = useState<SharedFolderChoice | null>(null)
    const [candidates, setCandidates] = useState<CandidateView[]>([])
    const [accepted, setAccepted] = useState<Set<string>>(new Set())
    const [discarded, setDiscarded] = useState<Set<string>>(new Set())
    const [pasted, setPasted] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const [roster, setRoster] = useState<RosterView | null>(null)
    const [invitation, setInvitation] = useState<InvitationView | null>(null)
    const hasName = Boolean(settings?.displayName)
    const ready = identity?.state === 'ready' && hasName
    const root = folder?.test.ok ? folder.path : null

    useEffect(() => {
        void api.getIdentity().then((r) => (r.ok ? setIdentity(r.data) : setError(r.error.message)))
    }, [api])

    const refresh = useCallback(() => {
        if (!root || mode === 'join') return
        void api.listCandidates(root).then((r) => {
            if (!r.ok) return setError(r.error.message)
            setCandidates((current) => {
                const byId = new Map(current.map((c) => [c.participantId, c]))
                for (const c of r.data) byId.set(c.participantId, c)
                return [...byId.values()]
            })
        })
    }, [api, root, mode])

    // after the folder is chosen: the own key goes into it, and the list of keys is read
    useEffect(() => {
        if (!root || !ready) return
        void api.publishOwnKey(root).then((r) => {
            if (!r.ok) setError(r.error.message)
            else refresh()
        })
    }, [api, root, ready, refresh])

    // join: look for the invitation until it is there
    useEffect(() => {
        if (mode !== 'join' || !root || !ready) return
        let stopped = false
        const look = (): void => {
            void api.findInvitation(root).then((r) => {
                if (stopped) return
                if (r.ok) setInvitation(r.data)
                else setError(r.error.message)
            })
        }
        look()
        const timer = setInterval(look, POLL_MS)
        return () => {
            stopped = true
            clearInterval(timer)
        }
    }, [api, mode, root, ready])

    // after creation: show who has joined
    useEffect(() => {
        if (!roster) return
        const timer = setInterval(() => {
            void api.getRoster().then((r) => r.ok && r.data && setRoster(r.data))
        }, POLL_MS)
        return () => clearInterval(timer)
    }, [api, roster])

    const chooseFolder = (): void => {
        setError(null)
        void api.pickSharedFolder().then((r) => {
            if (!r.ok) return setError(r.error.message)
            if (r.data) setFolder(r.data)
        })
    }

    const add = (c: CandidateView): void => {
        setCandidates((current) => [
            ...current.filter((x) => x.participantId !== c.participantId),
            c
        ])
        setAccepted((s) => new Set(s).add(c.participantId))
        setDiscarded((s) => {
            const n = new Set(s)
            n.delete(c.participantId)
            return n
        })
    }

    const addPasted = (): void => {
        setError(null)
        void api.parseKey(pasted).then((r) => {
            if (!r.ok) return setError(r.error.message)
            add(r.data)
            setPasted('')
        })
    }

    const fromFile = (): void => {
        setError(null)
        void api.pickKeyFile().then((r) => {
            if (!r.ok) return setError(r.error.message)
            if (r.data) add(r.data)
        })
    }

    const toggle = (id: string, accept: boolean): void => {
        setAccepted((s) => {
            const n = new Set(s)
            if (accept) n.add(id)
            else n.delete(id)
            return n
        })
        setDiscarded((s) => {
            const n = new Set(s)
            if (accept) n.delete(id)
            else n.add(id)
            return n
        })
    }

    const create = (): void => {
        if (!root) return
        const keys = candidates.filter((c) => accepted.has(c.participantId)).map((c) => c.text)
        setBusy(true)
        setError(null)
        void api
            .createShared(root, keys, mode === 'convert' ? 'convert' : 'new')
            .then(async (r) => {
                if (!r.ok) return setError(r.error.message)
                if (!r.data) return // the save dialog was cancelled
                const roster = await api.getRoster()
                if (roster.ok && roster.data) setRoster(roster.data)
                else onClose()
            })
            .finally(() => setBusy(false))
    }

    const join = (): void => {
        if (!root || invitation?.state !== 'ready') return
        setBusy(true)
        setError(null)
        void api
            .importInvitation(root, invitation.invitationId)
            .then((r) => {
                if (!r.ok) setError(r.error.message)
                else if (r.data) onClose()
            })
            .finally(() => setBusy(false))
    }

    const title =
        mode === 'new'
            ? ru.shared.newTitle
            : mode === 'convert'
              ? ru.shared.convertTitle
              : ru.shared.joinTitle

    if (roster)
        return (
            <Modal labelledBy="wizard-title" onEscape={onClose}>
                <div className="dialog settings wizard" data-testid="shared-roster">
                    <h2 id="wizard-title">{ru.shared.rosterTitle}</h2>
                    <RosterList roster={roster} />
                    <div className="buttons">
                        <button
                            type="button"
                            className="primary"
                            data-testid="wizard-close"
                            onClick={onClose}
                        >
                            {ru.shared.close}
                        </button>
                    </div>
                </div>
            </Modal>
        )

    return (
        <Modal labelledBy="wizard-title" onEscape={onClose}>
            <div className="dialog settings wizard" data-testid="shared-wizard" data-mode={mode}>
                <h2 id="wizard-title">{title}</h2>
                <p className="hint">{ru.shared.intro}</p>
                {settings && !settings.startWithWindowsSettled && (
                    <p className="hint" data-testid="wizard-autostart">
                        {ru.shared.autoStartNote}
                    </p>
                )}

                <section>
                    <h3>{ru.shared.keyStep}</h3>
                    {identity?.state === 'unavailable' && (
                        <p className="error-text">{ru.shared.keysUnavailable}</p>
                    )}
                    {identity?.state === 'ready' && (
                        <p className="fingerprint-row">
                            <span>{ru.identity.fingerprintLabel}: </span>
                            <code className="fingerprint" data-testid="wizard-own-fingerprint">
                                {identity.fingerprint}
                            </code>
                        </p>
                    )}
                    {!hasName && (
                        <p className="error-text" data-testid="wizard-name-first">
                            {ru.shared.nameFirst}
                        </p>
                    )}
                    <p className="hint">{ru.shared.keyHint}</p>
                </section>

                <section>
                    <h3>{ru.shared.folderStep}</h3>
                    <p className="hint">{ru.shared.folderHint}</p>
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
                            onClick={chooseFolder}
                        >
                            {ru.shared.chooseFolder}
                        </button>
                    </div>
                    {folder && (
                        <p
                            className={folder.test.ok ? 'ok' : 'error-text'}
                            data-testid="wizard-folder-test"
                            data-ok={folder.test.ok ? 'true' : 'false'}
                        >
                            {folder.test.ok
                                ? ru.shared.folderOk
                                : ru.shared.folderFailed(
                                      stepName[folder.test.step] ?? folder.test.step
                                  )}
                        </p>
                    )}
                </section>

                {mode !== 'join' && root && (
                    <section data-testid="wizard-members">
                        <h3>{ru.shared.membersStep}</h3>
                        <p className="hint">{ru.shared.membersHint}</p>
                        {candidates.length === 0 && (
                            <p className="hint">{ru.shared.noCandidates}</p>
                        )}
                        <ul className="candidates">
                            {candidates.map((c) => (
                                <li
                                    key={c.participantId}
                                    data-testid="candidate"
                                    data-name={c.displayName}
                                >
                                    <span className="candidate-name">{c.displayName}</span>
                                    <code className="fingerprint">{c.fingerprint}</code>
                                    <span className="candidate-actions">
                                        <label className="check">
                                            <input
                                                type="checkbox"
                                                data-testid="candidate-accept"
                                                checked={accepted.has(c.participantId)}
                                                onChange={(e) =>
                                                    toggle(c.participantId, e.target.checked)
                                                }
                                            />
                                            <span>
                                                {discarded.has(c.participantId)
                                                    ? ru.shared.discarded
                                                    : ru.shared.accept}
                                            </span>
                                        </label>
                                    </span>
                                </li>
                            ))}
                        </ul>
                        <div className="buttons">
                            <button type="button" data-testid="wizard-refresh" onClick={refresh}>
                                {ru.shared.refresh}
                            </button>
                            <button type="button" data-testid="wizard-key-file" onClick={fromFile}>
                                {ru.shared.fromFile}
                            </button>
                        </div>
                        <label>
                            {ru.shared.pasteLabel}
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
                                {ru.shared.addPasted}
                            </button>
                        </div>
                    </section>
                )}

                {mode === 'join' && root && (
                    <section
                        data-testid="wizard-invitation"
                        data-state={invitation?.state ?? 'waiting'}
                    >
                        {(!invitation || invitation.state === 'waiting') && (
                            <p className="hint">{ru.shared.joinWaiting}</p>
                        )}
                        {invitation?.state === 'incomplete' && (
                            <p className="hint">
                                {ru.shared.joinIncomplete(invitation.received, invitation.total)}
                                <progress max={invitation.total} value={invitation.received} />
                            </p>
                        )}
                        {invitation?.state === 'already' && (
                            <p className="hint">{ru.shared.joinAlready}</p>
                        )}
                        {invitation?.state === 'ready' && (
                            <>
                                <h3 data-testid="invitation-from">
                                    {ru.shared.joinReady(invitation.inviterName)}
                                </h3>
                                <p>«{invitation.title}»</p>
                                <p className="fingerprint-row">
                                    <span>{ru.identity.fingerprintLabel}: </span>
                                    <code className="fingerprint" data-testid="inviter-fingerprint">
                                        {invitation.inviterFingerprint}
                                    </code>
                                </p>
                                <p className="hint">{ru.shared.joinCheck}</p>
                            </>
                        )}
                    </section>
                )}

                {error && (
                    <p className="error-text" role="alert" data-testid="wizard-error">
                        {error}
                    </p>
                )}
                <div className="buttons">
                    <button type="button" data-testid="wizard-cancel" onClick={onClose}>
                        {ru.shared.cancel}
                    </button>
                    {mode === 'join' ? (
                        <button
                            type="button"
                            className="primary"
                            data-testid="wizard-join"
                            disabled={busy || invitation?.state !== 'ready'}
                            onClick={join}
                        >
                            {ru.shared.joinAccept}
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="primary"
                            data-testid="wizard-create"
                            disabled={busy || !root || !ready || accepted.size === 0}
                            onClick={create}
                        >
                            {mode === 'convert' ? ru.shared.convert : ru.shared.create}
                        </button>
                    )}
                </div>
            </div>
        </Modal>
    )
}

const stateLabel = {
    self: ru.shared.stateSelf,
    invited: ru.shared.stateInvited,
    joined: ru.shared.stateJoined,
    member: ru.shared.stateMember
} as const

export function RosterList({ roster }: { roster: RosterView }): React.JSX.Element {
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
                    <span className="roster-state">{stateLabel[m.state]}</span>
                </li>
            ))}
        </ul>
    )
}

/** The members of the open synchronized discussion (header button "Участники"). */
export function RosterDialog({ onClose }: { onClose(): void }): React.JSX.Element {
    const api = window.branchchat
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
                <h2 id="roster-title">{ru.shared.rosterTitle}</h2>
                {roster && <RosterList roster={roster} />}
                <div className="buttons">
                    <button type="button" className="primary" onClick={onClose}>
                        {ru.shared.close}
                    </button>
                </div>
            </div>
        </Modal>
    )
}
