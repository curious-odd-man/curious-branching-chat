import { Modal } from './Modal'
import { describeError, ru } from '@shared/i18n/ru'
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
        <h2 id="update-title">{info ? ru.update.available(info.version) : ru.update.title}</h2>

        {phase === 'checking' && <p data-testid="update-checking">{ru.update.checking}</p>}

        {phase === 'up-to-date' && (
          <p data-testid="update-up-to-date">{ru.update.upToDate(view.currentVersion)}</p>
        )}

        {phase === 'error' && (
          <p className="error-text" role="alert" data-testid="update-error">
            {describeError(view.errorCode ?? 'UNKNOWN')}
          </p>
        )}

        {info && (
          <>
            <p>{ru.update.current(view.currentVersion)}</p>
            <dl className="facts">
              {info.releaseDate && (
                <>
                  <dt>{ru.update.releaseDate}</dt>
                  <dd data-testid="update-date">{formatDate(info.releaseDate)}</dd>
                </>
              )}
              {info.sizeBytes !== null && (
                <>
                  <dt>{ru.update.size}</dt>
                  <dd data-testid="update-size">{formatBytes(info.sizeBytes)}</dd>
                </>
              )}
            </dl>
            <h3>{ru.update.notes}</h3>
            <pre className="notes" data-testid="update-notes">
              {info.notes ?? ru.update.noNotes}
            </pre>
          </>
        )}

        {phase === 'downloading' && (
          <div>
            <p>{ru.update.downloading}</p>
            <progress
              max={100}
              value={view.percent}
              data-testid="update-progress"
              aria-label={ru.update.downloading}
            />
          </div>
        )}

        {phase === 'ready' && (
          <div data-testid="update-ready">
            <p>{ru.update.ready}</p>
            <p className="hint">{ru.update.readyHint}</p>
          </div>
        )}

        <div className="buttons">
          {info?.hasReleasePage && (
            <button
              type="button"
              data-testid="update-open-page"
              onClick={() => void api.openReleasePage()}
            >
              {ru.update.openPage}
            </button>
          )}
          {phase === 'available' && (
            <>
              <button type="button" data-testid="update-later" onClick={close}>
                {ru.update.later}
              </button>
              <button
                type="button"
                className="primary"
                data-testid="update-download"
                autoFocus
                onClick={() => void api.downloadUpdate()}
              >
                {ru.update.download}
              </button>
            </>
          )}
          {phase === 'ready' && (
            <>
              <button type="button" data-testid="update-later" onClick={close}>
                {ru.update.later}
              </button>
              <button
                type="button"
                className="primary"
                data-testid="update-install"
                autoFocus
                onClick={() => void api.installUpdate()}
              >
                {ru.update.installNow}
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
                  {ru.update.retry}
                </button>
              )}
              {!info && view.errorCode === 'UPDATE_CHECK_FAILED' && (
                <button
                  type="button"
                  data-testid="update-retry"
                  onClick={() => void api.checkForUpdates()}
                >
                  {ru.update.retry}
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
              {ru.update.close}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
