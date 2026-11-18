import { useEffect, useState } from 'react'
import { texts } from '@shared/i18n'
import type { IdentityView } from '@shared/types/ipc'
import { useApi } from '../../api'
import { NumberField } from './NumberField'
import type { SectionProps } from './types'

/** The encryption key: fingerprint, copy and save of the public key (FR-155 to FR-157), and the file size limit. */
export function IdentitySection({
    settings,
    run,
    onSettingsChanged
}: SectionProps): React.JSX.Element {
    const api = useApi()
    const [identity, setIdentity] = useState<IdentityView | null>(null)
    const [message, setMessage] = useState<string | null>(null)
    const hasName = Boolean(settings?.displayName)

    useEffect(() => {
        void run(() => api.getIdentity(), setIdentity)
    }, [api, run])

    const copy = (): void => {
        setMessage(null)
        void run(
            () => api.copyKeyBundle(),
            () => setMessage(texts().identity.copied)
        )
    }
    const save = (): void => {
        setMessage(null)
        void run(
            () => api.saveKeyBundle(),
            (saved) => {
                if (saved) setMessage(texts().identity.saved)
            }
        )
    }

    return (
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
                        {message && (
                            <span className="ok" data-testid="identity-message">
                                {message}
                            </span>
                        )}
                        <button
                            type="button"
                            data-testid="identity-copy"
                            disabled={!hasName}
                            onClick={copy}
                        >
                            {texts().identity.copy}
                        </button>
                        <button
                            type="button"
                            data-testid="identity-save"
                            disabled={!hasName}
                            onClick={save}
                        >
                            {texts().identity.save}
                        </button>
                    </div>
                </>
            )}
            <NumberField
                testId="settings-size-limit"
                label={texts().identity.sizeLimitLabel}
                min={5}
                max={1000}
                value={settings?.fileSizeLimitMb}
                fallback={30}
                onApply={(mb) => void run(() => api.setFileSizeLimit(mb), onSettingsChanged)}
            />
            <p className="hint">{texts().identity.sizeLimitHint}</p>
        </section>
    )
}
