import { useState } from 'react'
import { texts } from '@shared/i18n'
import { useApi } from '../../api'
import { NumberField } from './NumberField'
import type { SectionProps } from './types'

/** At start: open the last file, and the length of the recent files list. */
export function StartupSection({
    settings,
    run,
    onSettingsChanged
}: Omit<SectionProps, 'setError'>): React.JSX.Element {
    const api = useApi()
    // Shown right away while the change is written (a controlled checkbox would flip back until the answer arrives).
    const [openLast, setOpenLast] = useState(settings?.openLastFileOnStartup ?? true)
    return (
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
                        void run(
                            () => api.setOpenLastFileOnStartup(enabled),
                            onSettingsChanged,
                            () => setOpenLast(!enabled)
                        )
                    }}
                />
                <span>{texts().settings.openLastFile}</span>
            </label>
            <p className="hint">{texts().settings.openLastFileHint}</p>
            <NumberField
                testId="settings-recent-limit"
                label={texts().settings.recentLimitLabel}
                min={0}
                value={settings?.recentFilesLimit}
                fallback={10}
                onApply={(n) => void run(() => api.setRecentFilesLimit(n), onSettingsChanged)}
            />
            <p className="hint">{texts().settings.recentLimitHint}</p>
        </section>
    )
}
