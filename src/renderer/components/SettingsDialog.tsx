import { useCallback, useEffect, useState } from 'react'
import { Modal } from './Modal'
import { ru } from '@shared/i18n/ru'
import type { AssociationInfo, IdentityView, SettingsView } from '@shared/types/ipc'

interface Props {
    settings: SettingsView | undefined
    onNameSaved(settings: SettingsView): void
    onSettingsChanged(settings: SettingsView): void
    onClose(): void
}

const stateText = {
    on: ru.association.stateOn,
    off: ru.association.stateOff,
    'other-app': ru.association.stateOther,
    unsupported: ru.association.stateUnsupported
} as const

/**
 * File > Settings…: the person's name (FR-138), the .branchchat file association (FR-089, FR-138), and the
 * encryption key fingerprint with copy and save of the public key (FR-155 to FR-157).
 */
export function SettingsDialog({
    settings,
    onNameSaved,
    onSettingsChanged,
    onClose
}: Props): React.JSX.Element {
    const api = window.branchchat
    const [name, setName] = useState(settings?.displayName ?? '')
    const [nameMessage, setNameMessage] = useState<string | null>(null)
    const [association, setAssociation] = useState<AssociationInfo | null>(null)
    const [error, setError] = useState<string | null>(null)
    // Shown right away while the change is written (a controlled checkbox would flip back until the answer arrives).
    const [openLast, setOpenLast] = useState(settings?.openLastFileOnStartup ?? true)
    // The recent files limit is typed as text and applied when the field loses focus or Enter is pressed.
    const [limitText, setLimitText] = useState(String(settings?.recentFilesLimit ?? 10))
    // The value being applied, shown right away while the change is written.
    const [requested, setRequested] = useState<boolean | null>(null)
    const [identity, setIdentity] = useState<IdentityView | null>(null)
    const [keyMessage, setKeyMessage] = useState<string | null>(null)

    useEffect(() => {
        void api.getAssociation().then((r) => r.ok && setAssociation(r.data))
        void api.getIdentity().then((r) => {
            if (r.ok) setIdentity(r.data)
            else setError(r.error.message)
        })
    }, [api])

    const copyKey = (): void => {
        setKeyMessage(null)
        void api.copyKeyBundle().then((r) => {
            if (r.ok) setKeyMessage(ru.identity.copied)
            else setError(r.error.message)
        })
    }

    const saveKey = (): void => {
        setKeyMessage(null)
        void api.saveKeyBundle().then((r) => {
            if (r.ok) {
                if (r.data) setKeyMessage(ru.identity.saved)
            } else setError(r.error.message)
        })
    }

    const hasName = Boolean(settings?.displayName)

    const saveName = useCallback(() => {
        if (name.trim().length === 0) return
        void api.setDisplayName(name).then((r) => {
            if (r.ok) {
                onNameSaved(r.data)
                setName(r.data.displayName ?? '')
                setNameMessage(ru.settings.nameSaved)
                setError(null)
            } else setError(r.error.message)
        })
    }, [api, name, onNameSaved])

    const applyLimit = (): void => {
        const value = Number(limitText)
        if (limitText.trim() === '' || !Number.isInteger(value) || value < 0) {
            setLimitText(String(settings?.recentFilesLimit ?? 10)) // not a whole number: keep the old value
            return
        }
        if (value === settings?.recentFilesLimit) return
        void api.setRecentFilesLimit(value).then((r) => {
            if (r.ok) onSettingsChanged(r.data)
            else setError(r.error.message)
        })
    }

    const toggle = (enabled: boolean): void => {
        setRequested(enabled)
        setError(null)
        void api
            .setAssociation(enabled)
            .then((r) => {
                if (r.ok) setAssociation(r.data)
                else {
                    setError(r.error.message)
                    void api.getAssociation().then((s) => s.ok && setAssociation(s.data))
                }
            })
            .finally(() => setRequested(null))
    }

    const state = association?.state
    const canToggle = state === 'on' || state === 'off'

    return (
        <Modal labelledBy="settings-title" onEscape={onClose}>
            <div className="dialog settings" data-testid="settings-dialog">
                <h2 id="settings-title">{ru.settings.title}</h2>

                <section>
                    <label>
                        {ru.settings.nameLabel}
                        <input
                            data-testid="settings-name"
                            value={name}
                            onChange={(e) => {
                                setName(e.target.value)
                                setNameMessage(null)
                            }}
                            onKeyDown={(e) => e.key === 'Enter' && saveName()}
                        />
                    </label>
                    <p className="hint">{ru.settings.nameHint}</p>
                    <div className="buttons">
                        {nameMessage && (
                            <span className="ok" data-testid="settings-name-saved">
                                {nameMessage}
                            </span>
                        )}
                        <button
                            type="button"
                            data-testid="settings-name-save"
                            disabled={
                                name.trim().length === 0 || name.trim() === settings?.displayName
                            }
                            onClick={saveName}
                        >
                            {ru.settings.saveName}
                        </button>
                    </div>
                </section>

                <section data-testid="settings-identity">
                    <h3>{ru.identity.heading}</h3>
                    {identity === null && <p className="hint">{ru.identity.loading}</p>}
                    {identity?.state === 'unavailable' && (
                        <p className="error-text" data-testid="identity-unavailable">
                            {ru.identity.unavailable}
                        </p>
                    )}
                    {identity?.state === 'ready' && (
                        <>
                            <p className="hint">{ru.identity.explanation}</p>
                            <p className="fingerprint-row">
                                <span>{ru.identity.fingerprintLabel}: </span>
                                <code className="fingerprint" data-testid="identity-fingerprint">
                                    {identity.fingerprint}
                                </code>
                            </p>
                            <p className="hint">{ru.identity.fingerprintHint}</p>
                            {identity.replaced && (
                                <p className="hint" data-testid="identity-replaced">
                                    {identity.replaced === 'unreadable'
                                        ? ru.identity.replacedUnreadable
                                        : ru.identity.replacedOther}
                                </p>
                            )}
                            {!hasName && (
                                <p className="hint" data-testid="identity-name-first">
                                    {ru.identity.nameFirst}
                                </p>
                            )}
                            <div className="buttons">
                                {keyMessage && (
                                    <span className="ok" data-testid="identity-message">
                                        {keyMessage}
                                    </span>
                                )}
                                <button
                                    type="button"
                                    data-testid="identity-copy"
                                    disabled={!hasName}
                                    onClick={copyKey}
                                >
                                    {ru.identity.copy}
                                </button>
                                <button
                                    type="button"
                                    data-testid="identity-save"
                                    disabled={!hasName}
                                    onClick={saveKey}
                                >
                                    {ru.identity.save}
                                </button>
                            </div>
                        </>
                    )}
                </section>

                <section>
                    <h3>{ru.association.heading}</h3>
                    <label className="check">
                        <input
                            type="checkbox"
                            data-testid="settings-association"
                            checked={requested ?? state === 'on'}
                            disabled={!canToggle || requested !== null}
                            onChange={(e) => toggle(e.target.checked)}
                        />
                        <span>{ru.association.checkbox}</span>
                    </label>
                    <p className="hint">{ru.association.explanation}</p>
                    {state && (
                        <p
                            className="hint"
                            data-testid="settings-association-state"
                            data-state={state}
                        >
                            {stateText[state]}
                        </p>
                    )}
                </section>

                <section>
                    <h3>{ru.settings.startupHeading}</h3>
                    <label className="check">
                        <input
                            type="checkbox"
                            data-testid="settings-open-last"
                            checked={openLast}
                            onChange={(e) => {
                                const enabled = e.target.checked
                                setOpenLast(enabled)
                                void api.setOpenLastFileOnStartup(enabled).then((r) => {
                                    if (r.ok) onSettingsChanged(r.data)
                                    else {
                                        setOpenLast(!enabled)
                                        setError(r.error.message)
                                    }
                                })
                            }}
                        />
                        <span>{ru.settings.openLastFile}</span>
                    </label>
                    <p className="hint">{ru.settings.openLastFileHint}</p>
                    <label>
                        {ru.settings.recentLimitLabel}
                        <input
                            type="number"
                            min={0}
                            step={1}
                            data-testid="settings-recent-limit"
                            value={limitText}
                            onChange={(e) => setLimitText(e.target.value)}
                            onBlur={applyLimit}
                            onKeyDown={(e) => e.key === 'Enter' && applyLimit()}
                        />
                    </label>
                    <p className="hint">{ru.settings.recentLimitHint}</p>
                </section>

                <section>
                    <h3>{ru.updateSettings.heading}</h3>
                    <label className="check">
                        <input
                            type="checkbox"
                            data-testid="settings-auto-update"
                            checked={settings?.autoUpdateCheck ?? true}
                            onChange={(e) =>
                                void api.setAutoUpdateCheck(e.target.checked).then((r) => {
                                    if (r.ok) onSettingsChanged(r.data)
                                    else setError(r.error.message)
                                })
                            }
                        />
                        <span>{ru.updateSettings.autoCheck}</span>
                    </label>
                    <p className="hint">{ru.updateSettings.hint}</p>
                    <div className="buttons">
                        <button
                            type="button"
                            data-testid="settings-check-updates"
                            onClick={() => {
                                void api.checkForUpdates()
                                onClose()
                            }}
                        >
                            {ru.updateSettings.checkNow}
                        </button>
                    </div>
                </section>

                {error && (
                    <p className="error-text" role="alert" data-testid="settings-error">
                        {error}
                    </p>
                )}
                <div className="buttons">
                    <button
                        type="button"
                        className="primary"
                        data-testid="settings-close"
                        autoFocus
                        onClick={onClose}
                    >
                        {ru.settings.close}
                    </button>
                </div>
            </div>
        </Modal>
    )
}
