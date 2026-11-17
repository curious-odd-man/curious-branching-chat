import { useEffect, useState } from 'react'
import { texts } from '@shared/i18n'
import type { BackupView } from '@shared/types/ipc'
import { formatBytes, formatTimestamp } from '../i18n/format'
import { Modal } from './Modal'

interface Props {
    onClose(): void
}

/** FR-207: "Восстановить из резервной копии…": the backups of both places, newest first. */
export function RestoreDialog({ onClose }: Props): React.JSX.Element {
    const api = window.branchchat
    const [list, setList] = useState<BackupView[] | null>(null)
    const [chosen, setChosen] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        void api.getBackups().then((r) => {
            if (!r.ok) return setError(r.error.message)
            setList(r.data.backups)
            setChosen(r.data.backups[0]?.path ?? null)
        })
    }, [api])

    const restore = (): void => {
        if (!chosen) return
        setBusy(true)
        setError(null)
        void api.restoreBackup(chosen).then((r) => {
            setBusy(false)
            if (!r.ok) setError(r.error.message)
            // on success the application restarts
        })
    }

    return (
        <Modal labelledBy="restore-title">
            <div className="dialog wide" data-testid="restore-dialog">
                <h2 id="restore-title">{texts().backup.restoreTitle}</h2>
                <p>{texts().backup.restoreHint}</p>
                {list && list.length === 0 && <p className="hint">{texts().backup.restoreNone}</p>}
                {list && list.length > 0 && (
                    <ul className="migration-list">
                        {list.map((b) => (
                            <li key={b.path} data-testid="restore-item">
                                <label title={b.path}>
                                    <input
                                        type="radio"
                                        name="backup"
                                        checked={chosen === b.path}
                                        disabled={busy}
                                        onChange={() => setChosen(b.path)}
                                    />
                                    <span className="recent-name">
                                        {formatTimestamp(b.createdAt)}
                                        <span className="recent-shared">
                                            {' '}
                                            · {texts().backup.reasons[b.reason] ?? b.reason} ·{' '}
                                            {b.place === 'app'
                                                ? texts().backup.placeApp
                                                : texts().backup.placeFolder}
                                        </span>
                                    </span>
                                    <span className="recent-dir">
                                        {texts().backup.counts(b.discussions, b.messages)},{' '}
                                        {formatBytes(b.size)}
                                    </span>
                                </label>
                            </li>
                        ))}
                    </ul>
                )}
                {error && (
                    <p className="error-text" role="alert">
                        {error}
                    </p>
                )}
                <div className="buttons">
                    <button type="button" onClick={onClose} disabled={busy}>
                        {texts().backup.restoreCancel}
                    </button>
                    <button
                        type="button"
                        className="primary"
                        data-testid="restore-confirm"
                        disabled={busy || !chosen}
                        onClick={restore}
                    >
                        {texts().backup.restoreConfirm}
                    </button>
                </div>
            </div>
        </Modal>
    )
}
