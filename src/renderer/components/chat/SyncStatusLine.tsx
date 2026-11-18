import { useState } from 'react'
import { texts } from '@shared/i18n'
import type { DocumentView } from '@shared/types/ipc'
import { useApi } from '../../api'

/** Problems of a synchronized discussion (FR-172, D-35): only in this line and the tray menu, no notifications. */
export function SyncStatusLine({
    status
}: {
    status: DocumentView['syncStatus']
}): React.JSX.Element | null {
    const api = useApi()
    const [busy, setBusy] = useState(false)
    if (!status) return null
    const lines: string[] = []
    if (status.folder === 'missing') lines.push(texts().syncStatus.missing(status.folderPath))
    if (status.folder === 'no-permission') lines.push(texts().syncStatus.noPermission)
    if (status.needsUpdate) lines.push(texts().syncStatus.needsUpdate)
    if (status.quarantined > 0) lines.push(texts().syncStatus.quarantined(status.quarantined))
    if (status.notAccepted.length > 0)
        lines.push(texts().syncStatus.notAccepted(status.notAccepted.join(', ')))
    if (lines.length === 0 && status.keyRequests.length === 0) return null
    // D-32: the decision about new keys of a member; no Windows notification for it (D-35)
    const decide = (participantId: string, accept: boolean): void => {
        setBusy(true)
        void api.decideKeys(participantId, accept).finally(() => setBusy(false))
    }
    return (
        <div
            className="sync-status"
            role="status"
            data-testid="sync-status"
            data-folder={status.folder}
        >
            {lines.map((l) => (
                <p key={l}>{l}</p>
            ))}
            {status.keyRequests.map((r) => (
                <div
                    key={r.participantId}
                    className="key-request"
                    data-testid="key-request"
                    data-state={r.state}
                    data-name={r.displayName}
                >
                    <p>
                        {r.state === 'pending'
                            ? texts().syncStatus.keysChanged(r.displayName)
                            : texts().syncStatus.keysRejected(r.displayName)}
                    </p>
                    <p className="fingerprint-row">
                        <span>{texts().identity.fingerprintLabel}: </span>
                        <code className="fingerprint" data-testid="key-request-fingerprint">
                            {r.fingerprint}
                        </code>
                    </p>
                    <div className="buttons">
                        {r.state === 'pending' && (
                            <button
                                type="button"
                                data-testid="key-reject"
                                disabled={busy}
                                onClick={() => decide(r.participantId, false)}
                            >
                                {texts().syncStatus.keysReject}
                            </button>
                        )}
                        <button
                            type="button"
                            className="primary"
                            data-testid="key-accept"
                            disabled={busy}
                            onClick={() => decide(r.participantId, true)}
                        >
                            {r.state === 'pending'
                                ? texts().syncStatus.keysAccept
                                : texts().syncStatus.keysAcceptLater}
                        </button>
                    </div>
                </div>
            ))}
        </div>
    )
}
