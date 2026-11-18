import { useState } from 'react'
import { texts } from '@shared/i18n'
import type { UpdateView } from '@shared/types/ipc'
import { useApi } from '../api'

/** The error of the last action of the window. */
export function ErrorBanner({
    error,
    onClose
}: {
    error: string | null
    onClose(): void
}): React.JSX.Element | null {
    if (!error) return null
    return (
        <div className="banner error" role="alert" data-testid="app-error">
            <span>{error}</span>
            <button type="button" onClick={onClose}>
                ×
            </button>
        </div>
    )
}

/** FR-098: a new version is available or ready; the person can hide the banner for that version. */
export function UpdateBanner({
    update
}: {
    update: UpdateView | undefined
}): React.JSX.Element | null {
    const api = useApi()
    const [hidden, setHidden] = useState<string | null>(null)
    if (
        !update ||
        update.dialogOpen ||
        (update.phase !== 'available' && update.phase !== 'ready') ||
        !update.info ||
        hidden === update.info.version
    )
        return null
    const version = update.info.version
    return (
        <div className="banner info" role="status" data-testid="update-banner">
            <span>{texts().update.banner(version)}</span>
            <button
                type="button"
                data-testid="update-banner-details"
                onClick={() => void api.showUpdateDialog()}
            >
                {texts().update.bannerDetails}
            </button>
            <button
                type="button"
                aria-label={texts().update.bannerDismiss}
                onClick={() => setHidden(version)}
            >
                ×
            </button>
        </div>
    )
}
