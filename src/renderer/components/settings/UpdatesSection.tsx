import { texts } from '@shared/i18n'
import { useApi } from '../../api'
import type { SectionProps } from './types'

/** Automatic update checks (FR-097) and "check now". */
export function UpdatesSection({
    settings,
    run,
    onSettingsChanged,
    onClose
}: Omit<SectionProps, 'setError'> & { onClose(): void }): React.JSX.Element {
    const api = useApi()
    return (
        <section>
            <h3>{texts().updateSettings.heading}</h3>
            <label className="check">
                <input
                    type="checkbox"
                    data-testid="settings-auto-update"
                    checked={settings?.autoUpdateCheck ?? true}
                    onChange={(e) => {
                        const enabled = e.target.checked
                        void run(() => api.setAutoUpdateCheck(enabled), onSettingsChanged)
                    }}
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
    )
}
