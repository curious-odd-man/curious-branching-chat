import { useEffect, useState } from 'react'
import { texts } from '@shared/i18n'
import { useApi, useIpcAction } from '../../api'
import { formatTimestamp } from '../../i18n/format'
import type { SectionProps } from './types'

/** Backups (FR-207): the last one, the second folder, "back up now", and restore. */
export function BackupSection({
    settings,
    run,
    setError,
    onSettingsChanged,
    onRestore
}: SectionProps & { onRestore(): void }): React.JSX.Element {
    const api = useApi()
    const [last, setLast] = useState<string | null>(null)
    const [message, setMessage] = useState<string | null>(null)
    // its own busy state, with the errors in the line of the dialog
    const backup = useIpcAction({ report: setError })

    useEffect(() => {
        void api.getBackups().then((r) => r.ok && setLast(r.data.lastBackupAt))
    }, [api])

    const backupNow = (): void => {
        setMessage(null)
        void backup.run(
            () => api.backupNow(),
            (data) => {
                setLast(data.createdAt)
                setMessage(
                    data.folderError
                        ? texts().backup.folderFailed(data.folderError)
                        : texts().backup.done(formatTimestamp(data.createdAt))
                )
            }
        )
    }

    return (
        <section data-testid="settings-backup">
            <h3>{texts().backup.heading}</h3>
            <p className="hint">{texts().backup.explanation}</p>
            <p className="hint" data-testid="backup-not-encrypted">
                {texts().backup.notEncrypted}
            </p>
            <p data-testid="backup-last">
                {last ? texts().backup.last(formatTimestamp(last)) : texts().backup.never}
            </p>
            <p>
                {texts().backup.folder}{' '}
                <code className="path" data-testid="backup-folder">
                    {settings?.backupFolder ?? texts().backup.noFolder}
                </code>
            </p>
            <div className="buttons">
                <button
                    type="button"
                    data-testid="backup-pick-folder"
                    onClick={() =>
                        void run(
                            () => api.pickBackupFolder(),
                            (data) => {
                                if (data) onSettingsChanged(data)
                            }
                        )
                    }
                >
                    {texts().backup.pickFolder}
                </button>
                {settings?.backupFolder && (
                    <button
                        type="button"
                        data-testid="backup-clear-folder"
                        onClick={() => void run(() => api.clearBackupFolder(), onSettingsChanged)}
                    >
                        {texts().backup.clearFolder}
                    </button>
                )}
            </div>
            <div className="buttons">
                <button
                    type="button"
                    data-testid="backup-now"
                    disabled={backup.busy}
                    onClick={backupNow}
                >
                    {backup.busy ? texts().backup.running : texts().backup.now}
                </button>
                <button type="button" data-testid="backup-restore" onClick={onRestore}>
                    {texts().backup.restore}
                </button>
            </div>
            {message && (
                <p className="ok" data-testid="backup-message">
                    {message}
                </p>
            )}
        </section>
    )
}
