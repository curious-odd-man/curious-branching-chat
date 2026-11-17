import { useCallback, useEffect, useState } from 'react'
import { Modal } from './Modal'
import { texts } from '@shared/i18n'
import { TEXT_SIZE_DEFAULT, TEXT_SIZE_MAX, TEXT_SIZE_MIN, TEXT_SIZE_STEP } from '@shared/shortcuts'
import type { AssociationInfo, BackgroundFlag, IdentityView, SettingsView } from '@shared/types/ipc'
import { formatTimestamp } from '../i18n/format'

interface Props {
    settings: SettingsView | undefined
    onNameSaved(settings: SettingsView): void
    onSettingsChanged(settings: SettingsView): void
    onClose(): void
    /** "Восстановить из резервной копии…" (FR-207). */
    onRestore(): void
}

const stateText = (state: 'on' | 'off' | 'other-app' | 'unsupported'): string =>
    ({
        on: texts().association.stateOn,
        off: texts().association.stateOff,
        'other-app': texts().association.stateOther,
        unsupported: texts().association.stateUnsupported
    })[state]

/**
 * File > Settings…: the person's name (FR-138), the .branchchat file association (FR-089, FR-138), and the
 * encryption key fingerprint with copy and save of the public key (FR-155 to FR-157).
 */
export function SettingsDialog({
    settings,
    onNameSaved,
    onSettingsChanged,
    onClose,
    onRestore
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
    const [lastBackup, setLastBackup] = useState<string | null>(null)
    const [backupMessage, setBackupMessage] = useState<string | null>(null)
    const [backingUp, setBackingUp] = useState(false)

    useEffect(() => {
        void api.getBackups().then((r) => r.ok && setLastBackup(r.data.lastBackupAt))
        void api.getAssociation().then((r) => r.ok && setAssociation(r.data))
        void api.getIdentity().then((r) => {
            if (r.ok) setIdentity(r.data)
            else setError(r.error.message)
        })
    }, [api])

    const backupNow = (): void => {
        setBackingUp(true)
        setBackupMessage(null)
        void api
            .backupNow()
            .then((r) => {
                if (!r.ok) return setError(r.error.message)
                setLastBackup(r.data.createdAt)
                setBackupMessage(
                    r.data.folderError
                        ? texts().backup.folderFailed(r.data.folderError)
                        : texts().backup.done(formatTimestamp(r.data.createdAt))
                )
            })
            .finally(() => setBackingUp(false))
    }

    const copyKey = (): void => {
        setKeyMessage(null)
        void api.copyKeyBundle().then((r) => {
            if (r.ok) setKeyMessage(texts().identity.copied)
            else setError(r.error.message)
        })
    }

    const saveKey = (): void => {
        setKeyMessage(null)
        void api.saveKeyBundle().then((r) => {
            if (r.ok) {
                if (r.data) setKeyMessage(texts().identity.saved)
            } else setError(r.error.message)
        })
    }

    const hasName = Boolean(settings?.displayName)

    /** FR-301, FR-302: the same size for every window. */
    const setTextSize = (percent: number): void => {
        void api.setTextSize(percent).then((r) => {
            if (r.ok) onSettingsChanged(r.data)
            else setError(r.error.message)
        })
    }

    /** Notifications and start with Windows (release 1.4): the box changes at once; an error puts it back. */
    const [flags, setFlags] = useState<Partial<Record<BackgroundFlag, boolean>>>({})
    const flag = (name: BackgroundFlag, label: string, hint: string): React.JSX.Element => (
        <>
            <label className="check">
                <input
                    type="checkbox"
                    data-testid={`settings-${name}`}
                    checked={flags[name] ?? settings?.[name] ?? false}
                    disabled={!settings}
                    onChange={(e) => {
                        const enabled = e.target.checked
                        setFlags((f) => ({ ...f, [name]: enabled }))
                        void api.setBackgroundFlag(name, enabled).then((r) => {
                            if (r.ok) onSettingsChanged(r.data)
                            else {
                                setFlags((f) => ({ ...f, [name]: !enabled }))
                                setError(r.error.message)
                            }
                        })
                    }}
                />
                <span>{label}</span>
            </label>
            <p className="hint">{hint}</p>
        </>
    )

    const [sizeText, setSizeText] = useState(String(settings?.fileSizeLimitMb ?? 30))
    const applySize = (): void => {
        const value = Number(sizeText)
        if (!Number.isInteger(value) || value < 5 || value > 1000) {
            setSizeText(String(settings?.fileSizeLimitMb ?? 30)) // outside 5..1000: keep the old value
            return
        }
        if (value === settings?.fileSizeLimitMb) return
        void api.setFileSizeLimit(value).then((r) => {
            if (r.ok) onSettingsChanged(r.data)
            else setError(r.error.message)
        })
    }

    // FR-265: "Наибольший размер вложения"
    const [attachText, setAttachText] = useState(String(settings?.attachmentLimitMb ?? 100))
    const applyAttach = (): void => {
        const value = Number(attachText)
        if (!Number.isInteger(value) || value < 1 || value > 1000) {
            setAttachText(String(settings?.attachmentLimitMb ?? 100))
            return
        }
        if (value === settings?.attachmentLimitMb) return
        void api.setAttachmentLimit(value).then((r) => {
            if (r.ok) onSettingsChanged(r.data)
            else setError(r.error.message)
        })
    }

    const saveName = useCallback(() => {
        if (name.trim().length === 0) return
        void api.setDisplayName(name).then((r) => {
            if (r.ok) {
                onNameSaved(r.data)
                setName(r.data.displayName ?? '')
                setNameMessage(texts().settings.nameSaved)
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
                <h2 id="settings-title">{texts().settings.title}</h2>

                <section>
                    <label>
                        {texts().settings.nameLabel}
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
                    <p className="hint">{texts().settings.nameHint}</p>
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
                            {texts().settings.saveName}
                        </button>
                    </div>
                </section>

                <section data-testid="settings-identity">
                    <h3>{texts().identity.heading}</h3>
                    {identity === null && <p className="hint">{texts().identity.loading}</p>}
                    {identity?.state === 'unavailable' && (
                        <p className="error-text" data-testid="identity-unavailable">
                            {texts().identity.unavailable}
                        </p>
                    )}
                    {identity?.state === 'ready' && (
                        <>
                            <p className="hint">{texts().identity.explanation}</p>
                            <p className="fingerprint-row">
                                <span>{texts().identity.fingerprintLabel}: </span>
                                <code className="fingerprint" data-testid="identity-fingerprint">
                                    {identity.fingerprint}
                                </code>
                            </p>
                            <p className="hint">{texts().identity.fingerprintHint}</p>
                            {identity.replaced && (
                                <p className="hint" data-testid="identity-replaced">
                                    {identity.replaced === 'unreadable'
                                        ? texts().identity.replacedUnreadable
                                        : texts().identity.replacedOther}
                                </p>
                            )}
                            {!hasName && (
                                <p className="hint" data-testid="identity-name-first">
                                    {texts().identity.nameFirst}
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
                                    {texts().identity.copy}
                                </button>
                                <button
                                    type="button"
                                    data-testid="identity-save"
                                    disabled={!hasName}
                                    onClick={saveKey}
                                >
                                    {texts().identity.save}
                                </button>
                            </div>
                        </>
                    )}
                    <label>
                        {texts().identity.sizeLimitLabel}
                        <input
                            type="number"
                            min={5}
                            max={1000}
                            step={1}
                            data-testid="settings-size-limit"
                            value={sizeText}
                            onChange={(e) => setSizeText(e.target.value)}
                            onBlur={applySize}
                            onKeyDown={(e) => e.key === 'Enter' && applySize()}
                        />
                    </label>
                    <p className="hint">{texts().identity.sizeLimitHint}</p>
                </section>

                <section>
                    <h3>{texts().attachments.heading}</h3>
                    <label>
                        {texts().attachments.limitLabel}
                        <input
                            type="number"
                            min={1}
                            max={1000}
                            step={1}
                            data-testid="settings-attachment-limit"
                            value={attachText}
                            onChange={(e) => setAttachText(e.target.value)}
                            onBlur={applyAttach}
                            onKeyDown={(e) => e.key === 'Enter' && applyAttach()}
                        />
                    </label>
                    <p className="hint">{texts().attachments.limitHint}</p>
                </section>

                <section>
                    <h3>{texts().association.heading}</h3>
                    <label className="check">
                        <input
                            type="checkbox"
                            data-testid="settings-association"
                            checked={requested ?? state === 'on'}
                            disabled={!canToggle || requested !== null}
                            onChange={(e) => toggle(e.target.checked)}
                        />
                        <span>{texts().association.checkbox}</span>
                    </label>
                    <p className="hint">{texts().association.explanation}</p>
                    {state && (
                        <p
                            className="hint"
                            data-testid="settings-association-state"
                            data-state={state}
                        >
                            {stateText(state)}
                        </p>
                    )}
                </section>

                <section data-testid="settings-background">
                    <h3>{texts().settings.backgroundHeading}</h3>
                    {flag(
                        'notifyNewMessages',
                        texts().settings.notifyNew,
                        texts().settings.notifyNewHint
                    )}
                    {flag(
                        'notifyShowText',
                        texts().settings.notifyText,
                        texts().settings.notifyTextHint
                    )}
                    {flag(
                        'startWithWindows',
                        texts().settings.startWithWindows,
                        texts().settings.startWithWindowsHint
                    )}
                </section>

                <section data-testid="settings-language">
                    <h3>{texts().settings.languageHeading}</h3>
                    <div
                        className="radio-row"
                        role="radiogroup"
                        aria-label={texts().settings.languageHeading}
                    >
                        {(['ru', 'en'] as const).map((lang) => (
                            <label className="check" key={lang}>
                                <input
                                    type="radio"
                                    name="language"
                                    data-testid={`settings-language-${lang}`}
                                    checked={(settings?.language ?? 'ru') === lang}
                                    onChange={() =>
                                        void api.setLanguage(lang).then((r) => {
                                            if (r.ok) onSettingsChanged(r.data)
                                            else setError(r.error.message)
                                        })
                                    }
                                />
                                <span lang={lang}>
                                    {lang === 'ru'
                                        ? texts().settings.languageRu
                                        : texts().settings.languageEn}
                                </span>
                            </label>
                        ))}
                    </div>
                    <p className="hint">{texts().settings.languageHint}</p>
                    {settings && settings.language !== api.language && (
                        <button
                            type="button"
                            className="primary"
                            data-testid="settings-restart"
                            onClick={() => void api.relaunch()}
                        >
                            {texts().settings.restartNow}
                        </button>
                    )}
                </section>

                <section data-testid="settings-text-size">
                    <h3>{texts().settings.textSizeHeading}</h3>
                    <div className="text-size">
                        <button
                            type="button"
                            data-testid="text-size-smaller"
                            aria-label={texts().menu.zoomOut}
                            disabled={!settings || settings.textSize <= TEXT_SIZE_MIN}
                            onClick={() =>
                                setTextSize((settings?.textSize ?? 100) - TEXT_SIZE_STEP)
                            }
                        >
                            −
                        </button>
                        <output data-testid="text-size-value">{settings?.textSize ?? 100} %</output>
                        <button
                            type="button"
                            data-testid="text-size-larger"
                            aria-label={texts().menu.zoomIn}
                            disabled={!settings || settings.textSize >= TEXT_SIZE_MAX}
                            onClick={() =>
                                setTextSize((settings?.textSize ?? 100) + TEXT_SIZE_STEP)
                            }
                        >
                            +
                        </button>
                        <button
                            type="button"
                            data-testid="text-size-reset"
                            disabled={!settings || settings.textSize === TEXT_SIZE_DEFAULT}
                            onClick={() => setTextSize(TEXT_SIZE_DEFAULT)}
                        >
                            {texts().settings.textSizeReset}
                        </button>
                    </div>
                    <p className="hint">{texts().settings.textSizeHint}</p>
                </section>

                <section>
                    <h3>{texts().settings.startupHeading}</h3>
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
                        <span>{texts().settings.openLastFile}</span>
                    </label>
                    <p className="hint">{texts().settings.openLastFileHint}</p>
                    <label>
                        {texts().settings.recentLimitLabel}
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
                    <p className="hint">{texts().settings.recentLimitHint}</p>
                </section>

                <section data-testid="settings-backup">
                    <h3>{texts().backup.heading}</h3>
                    <p className="hint">{texts().backup.explanation}</p>
                    <p className="hint" data-testid="backup-not-encrypted">
                        {texts().backup.notEncrypted}
                    </p>
                    <p data-testid="backup-last">
                        {lastBackup
                            ? texts().backup.last(formatTimestamp(lastBackup))
                            : texts().backup.never}
                    </p>
                    <p>
                        {texts().backup.folder}{' '}
                        <code className="path" data-testid="backup-folder">
                            {settings?.backupFolder ?? texts().backup.noFolder}
                        </code>
                    </p>
                    <div className="buttons">
                        <button
                            type="button"
                            data-testid="backup-pick-folder"
                            onClick={() =>
                                void api.pickBackupFolder().then((r) => {
                                    if (!r.ok) setError(r.error.message)
                                    else if (r.data) onSettingsChanged(r.data)
                                })
                            }
                        >
                            {texts().backup.pickFolder}
                        </button>
                        {settings?.backupFolder && (
                            <button
                                type="button"
                                data-testid="backup-clear-folder"
                                onClick={() =>
                                    void api.clearBackupFolder().then((r) => {
                                        if (r.ok) onSettingsChanged(r.data)
                                        else setError(r.error.message)
                                    })
                                }
                            >
                                {texts().backup.clearFolder}
                            </button>
                        )}
                    </div>
                    <div className="buttons">
                        <button
                            type="button"
                            data-testid="backup-now"
                            disabled={backingUp}
                            onClick={backupNow}
                        >
                            {backingUp ? texts().backup.running : texts().backup.now}
                        </button>
                        <button type="button" data-testid="backup-restore" onClick={onRestore}>
                            {texts().backup.restore}
                        </button>
                    </div>
                    {backupMessage && (
                        <p className="ok" data-testid="backup-message">
                            {backupMessage}
                        </p>
                    )}
                </section>

                <section>
                    <h3>{texts().updateSettings.heading}</h3>
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
                        <span>{texts().updateSettings.autoCheck}</span>
                    </label>
                    <p className="hint">{texts().updateSettings.hint}</p>
                    <div className="buttons">
                        <button
                            type="button"
                            data-testid="settings-check-updates"
                            onClick={() => {
                                void api.checkForUpdates()
                                onClose()
                            }}
                        >
                            {texts().updateSettings.checkNow}
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
                        {texts().settings.close}
                    </button>
                </div>
            </div>
        </Modal>
    )
}
