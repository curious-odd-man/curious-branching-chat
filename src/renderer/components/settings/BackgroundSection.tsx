import { useState } from 'react'
import { texts } from '@shared/i18n'
import type { BackgroundFlag } from '@shared/types/ipc'
import { useApi } from '../../api'
import type { SectionProps } from './types'

/** Notifications and start with Windows: the box changes at once; an error puts it back. */
export function BackgroundSection({
    settings,
    run,
    onSettingsChanged
}: Omit<SectionProps, 'setError'>): React.JSX.Element {
    const api = useApi()
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
                        void run(
                            () => api.setBackgroundFlag(name, enabled),
                            onSettingsChanged,
                            () => setFlags((f) => ({ ...f, [name]: !enabled }))
                        )
                    }}
                />
                <span>{label}</span>
            </label>
            <p className="hint">{hint}</p>
        </>
    )
    return (
        <section data-testid="settings-background">
            <h3>{texts().settings.backgroundHeading}</h3>
            {flag('notifyNewMessages', texts().settings.notifyNew, texts().settings.notifyNewHint)}
            {flag('notifyShowText', texts().settings.notifyText, texts().settings.notifyTextHint)}
            {flag(
                'startWithWindows',
                texts().settings.startWithWindows,
                texts().settings.startWithWindowsHint
            )}
        </section>
    )
}
