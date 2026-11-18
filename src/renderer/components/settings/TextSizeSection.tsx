import { texts } from '@shared/i18n'
import { TEXT_SIZE_DEFAULT, TEXT_SIZE_MAX, TEXT_SIZE_MIN, TEXT_SIZE_STEP } from '@shared/shortcuts'
import { useApi } from '../../api'
import type { SectionProps } from './types'

/** FR-301, FR-302: the same text size for every window. */
export function TextSizeSection({
    settings,
    run,
    onSettingsChanged
}: Omit<SectionProps, 'setError'>): React.JSX.Element {
    const api = useApi()
    const size = settings?.textSize ?? TEXT_SIZE_DEFAULT
    const setTextSize = (percent: number): void =>
        void run(() => api.setTextSize(percent), onSettingsChanged)
    return (
        <section data-testid="settings-text-size">
            <h3>{texts().settings.textSizeHeading}</h3>
            <div className="text-size">
                <button
                    type="button"
                    data-testid="text-size-smaller"
                    aria-label={texts().menu.zoomOut}
                    disabled={!settings || settings.textSize <= TEXT_SIZE_MIN}
                    onClick={() => setTextSize(size - TEXT_SIZE_STEP)}
                >
                    −
                </button>
                <output data-testid="text-size-value">{size} %</output>
                <button
                    type="button"
                    data-testid="text-size-larger"
                    aria-label={texts().menu.zoomIn}
                    disabled={!settings || settings.textSize >= TEXT_SIZE_MAX}
                    onClick={() => setTextSize(size + TEXT_SIZE_STEP)}
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
    )
}
