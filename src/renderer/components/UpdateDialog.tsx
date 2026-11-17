import { Modal } from './Modal'
import { describeError, texts } from '@shared/i18n'
import type { UpdateView } from '@shared/types/ipc'
import { formatBytes, formatDate } from '../i18n/format'

interface Props {
    view: UpdateView
}

/**
 * The update dialog (FR-098, FR-099): version, release date, notes and download size; download, then restart to
 * install. Release notes come from the internet and are shown as plain text only.
 */
export function UpdateDialog({ view }: Props): React.JSX.Element {
    const api = window.branchchat
    const { phase, info } = view

    const close = (): void => void api.dismissUpdateDialog()
    const busy = phase === 'checking' || phase === 'downloading'

    return (
        <Modal labelledBy="update-title" onEscape={close}>
            <div className="dialog update" data-testid="update-dialog" data-phase={phase}>
                <h2 id="update-title">
                    {info ? texts().update.available(info.version) : texts().update.title}
                </h2>

                {phase === 'checking' && (
                    <p data-testid="update-checking">{texts().update.checking}</p>
                )}

                {phase === 'up-to-date' && (
                    <p data-testid="update-up-to-date">
                        {texts().update.upToDate(view.currentVersion)}
                    </p>
                )}

                {phase === 'error' && (
                    <p className="error-text" role="alert" data-testid="update-error">
                        {describeError(view.errorCode ?? 'UNKNOWN')}
                    </p>
                )}

                {info && (
                    <>
                        <p>{texts().update.current(view.currentVersion)}</p>
                        <dl className="facts">
                            {info.releaseDate && (
                                <>
                                    <dt>{texts().update.releaseDate}</dt>
                                    <dd data-testid="update-date">
                                        {formatDate(info.releaseDate)}
                                    </dd>
                                </>
                            )}
                            {info.sizeBytes !== null && (
                                <>
                                    <dt>{texts().update.size}</dt>
                                    <dd data-testid="update-size">{formatBytes(info.sizeBytes)}</dd>
                                </>
                            )}
                        </dl>
                        <h3>{texts().update.notes}</h3>
                        <pre className="notes" data-testid="update-notes">
                            {info.notes ?? texts().update.noNotes}
                        </pre>
                    </>
                )}

                {phase === 'downloading' && (
                    <div>
                        <p>{texts().update.downloading}</p>
                        <progress
                            max={100}
                            value={view.percent}
                            data-testid="update-progress"
                            aria-label={texts().update.downloading}
                        />
                    </div>
                )}

                {phase === 'ready' && (
                    <div data-testid="update-ready">
                        <p>{texts().update.ready}</p>
                        <p className="hint">{texts().update.readyHint}</p>
                    </div>
                )}

                <div className="buttons">
                    {info?.hasReleasePage && (
                        <button
                            type="button"
                            data-testid="update-open-page"
                            onClick={() => void api.openReleasePage()}
                        >
                            {texts().update.openPage}
                        </button>
                    )}
                    {phase === 'available' && (
                        <>
                            <button type="button" data-testid="update-later" onClick={close}>
                                {texts().update.later}
                            </button>
                            <button
                                type="button"
                                className="primary"
                                data-testid="update-download"
                                autoFocus
                                onClick={() => void api.downloadUpdate()}
                            >
                                {texts().update.download}
                            </button>
                        </>
                    )}
                    {phase === 'ready' && (
                        <>
                            <button type="button" data-testid="update-later" onClick={close}>
                                {texts().update.later}
                            </button>
                            <button
                                type="button"
                                className="primary"
                                data-testid="update-install"
                                autoFocus
                                onClick={() => void api.installUpdate()}
                            >
                                {texts().update.installNow}
                            </button>
                        </>
                    )}
                    {phase === 'error' && (
                        <>
                            {info && (
                                <button
                                    type="button"
                                    data-testid="update-retry"
                                    onClick={() => void api.downloadUpdate()}
                                >
                                    {texts().update.retry}
                                </button>
                            )}
                            {!info && view.errorCode === 'UPDATE_CHECK_FAILED' && (
                                <button
                                    type="button"
                                    data-testid="update-retry"
                                    onClick={() => void api.checkForUpdates()}
                                >
                                    {texts().update.retry}
                                </button>
                            )}
                        </>
                    )}
                    {(phase === 'error' || phase === 'up-to-date' || busy) && (
                        <button
                            type="button"
                            className={phase === 'error' || phase === 'up-to-date' ? 'primary' : ''}
                            data-testid="update-close"
                            onClick={close}
                        >
                            {texts().update.close}
                        </button>
                    )}
                </div>
            </div>
        </Modal>
    )
}
