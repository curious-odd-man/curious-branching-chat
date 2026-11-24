import { useState } from 'react'
import { texts } from '@shared/i18n'
import type { DocumentView } from '@shared/types/ipc'
import { useApi } from '../../api'
import { formatTimestamp } from '../../i18n/format'
import { Modal } from '../Modal'

/** Problems of a synchronized discussion (FR-172, D-35): only in this line and the tray menu, no notifications. */
export function SyncStatusLine({
    status
}: {
    status: DocumentView['syncStatus']
}): React.JSX.Element | null {
    const api = useApi()
    const [busy, setBusy] = useState(false)
    // D-43: the member whose waiting files the person wants to delete (asks first)
    const [dropping, setDropping] = useState<{ participantId: string; displayName: string } | null>(
        null
    )
    if (!status) return null
    const lines: string[] = []
    if (status.folder === 'missing') lines.push(texts().syncStatus.missing(status.folderPath))
    if (status.folder === 'no-permission') lines.push(texts().syncStatus.noPermission)
    if (status.needsUpdate) lines.push(texts().syncStatus.needsUpdate)
    if (status.quarantined > 0) lines.push(texts().syncStatus.quarantined(status.quarantined))
    if (status.notAccepted.length > 0)
        lines.push(texts().syncStatus.notAccepted(status.notAccepted.join(', ')))
    if (lines.length === 0 && status.keyRequests.length === 0 && status.waitingFor.length === 0)
        return null
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
            {status.waitingFor.map((w) => (
                <div
                    key={w.participantId}
                    className="key-request"
                    data-testid="waiting-member"
                    data-name={w.displayName}
                >
                    <p>
                        {texts().syncStatus.waiting(
                            w.displayName,
                            formatTimestamp(w.since),
                            w.files
                        )}
                    </p>
                    <div className="buttons">
                        <button
                            type="button"
                            data-testid="drop-files"
                            disabled={busy}
                            onClick={() => setDropping(w)}
                        >
                            {texts().syncStatus.dropFiles(w.displayName)}
                        </button>
                    </div>
                </div>
            ))}
            {dropping && (
                <Modal labelledBy="drop-title" onEscape={() => setDropping(null)}>
                    <div className="dialog" data-testid="drop-dialog">
                        <h2 id="drop-title">
                            {texts().syncStatus.dropTitle(dropping.displayName)}
                        </h2>
                        <p>{texts().syncStatus.dropText(dropping.displayName)}</p>
                        <div className="buttons">
                            <button
                                type="button"
                                data-testid="drop-cancel"
                                autoFocus
                                onClick={() => setDropping(null)}
                            >
                                {texts().syncStatus.dropCancel}
                            </button>
                            <button
                                type="button"
                                className="primary danger"
                                data-testid="drop-confirm"
                                disabled={busy}
                                onClick={() => {
                                    const id = dropping.participantId
                                    setBusy(true)
                                    void api.dropFilesFor(id).finally(() => {
                                        setBusy(false)
                                        setDropping(null)
                                    })
                                }}
                            >
                                {texts().syncStatus.dropConfirm}
                            </button>
                        </div>
                    </div>
                </Modal>
            )}
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
