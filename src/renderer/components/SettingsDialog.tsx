import { useCallback, useEffect, useState } from 'react'
import { ru } from '@shared/i18n/ru'
import type { AssociationInfo, SettingsView } from '@shared/types/ipc'

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

/** File > Settings…: the person's name (FR-138) and the .branchchat file association (FR-089, FR-138). */
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
  // The value being applied, shown right away while the change is written.
  const [requested, setRequested] = useState<boolean | null>(null)

  useEffect(() => {
    void api.getAssociation().then((r) => r.ok && setAssociation(r.data))
  }, [api])

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
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
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
              disabled={name.trim().length === 0 || name.trim() === settings?.displayName}
              onClick={saveName}
            >
              {ru.settings.saveName}
            </button>
          </div>
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
            <p className="hint" data-testid="settings-association-state" data-state={state}>
              {stateText[state]}
            </p>
          )}
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
    </div>
  )
}
