import { texts } from '@shared/i18n'
import { useApi } from '../../api'
import type { SectionProps } from './types'

/** FR-293: the language; it applies after a restart. */
export function LanguageSection({
    settings,
    run,
    onSettingsChanged
}: Omit<SectionProps, 'setError'>): React.JSX.Element {
    const api = useApi()
    return (
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
                                void run(() => api.setLanguage(lang), onSettingsChanged)
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
    )
}
