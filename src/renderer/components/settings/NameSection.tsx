import { useState } from 'react'
import { texts } from '@shared/i18n'
import { useApi } from '../../api'
import type { SectionProps } from './types'

/** The person's name (FR-138). */
export function NameSection({
    settings,
    run,
    setError,
    onNameSaved
}: Omit<SectionProps, 'onSettingsChanged'> & {
    onNameSaved: SectionProps['onSettingsChanged']
}): React.JSX.Element {
    const api = useApi()
    const [name, setName] = useState(settings?.displayName ?? '')
    const [message, setMessage] = useState<string | null>(null)

    const save = (): void => {
        if (name.trim().length === 0) return
        void run(
            () => api.setDisplayName(name),
            (data) => {
                onNameSaved(data)
                setName(data.displayName ?? '')
                setMessage(texts().settings.nameSaved)
                setError(null)
            }
        )
    }

    return (
        <section>
            <label>
                {texts().settings.nameLabel}
                <input
                    data-testid="settings-name"
                    value={name}
                    onChange={(e) => {
                        setName(e.target.value)
                        setMessage(null)
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && save()}
                />
            </label>
            <p className="hint">{texts().settings.nameHint}</p>
            <div className="buttons">
                {message && (
                    <span className="ok" data-testid="settings-name-saved">
                        {message}
                    </span>
                )}
                <button
                    type="button"
                    data-testid="settings-name-save"
                    disabled={name.trim().length === 0 || name.trim() === settings?.displayName}
                    onClick={save}
                >
                    {texts().settings.saveName}
                </button>
            </div>
        </section>
    )
}
