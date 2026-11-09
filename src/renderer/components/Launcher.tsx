import { ru } from '@shared/i18n/ru'
import type { RecentFileView } from '@shared/types/ipc'

interface Props {
  version: string
  recent: readonly RecentFileView[]
  onNew(): void
  onOpen(): void
  onOpenRecent(path: string): void
  onRemoveRecent(path: string): void
  onClearRecent(): void
}

/** Shown in a window that has no discussion yet. */
export function Launcher({
  version,
  recent,
  onNew,
  onOpen,
  onOpenRecent,
  onRemoveRecent,
  onClearRecent
}: Props): React.JSX.Element {
  return (
    <main className="launcher">
      <h1>{ru.app.name}</h1>
      <p>{ru.app.tagline}</p>
      <div className="buttons">
        <button type="button" className="primary" data-testid="launcher-new" onClick={onNew}>
          {ru.launcher.newDiscussion}
        </button>
        <button type="button" data-testid="launcher-open" onClick={onOpen}>
          {ru.launcher.openDiscussion}
        </button>
      </div>
      <p className="hint">{ru.launcher.dropHint}</p>
      {recent.length > 0 && (
        <section className="recent" data-testid="recent-files" aria-labelledby="recent-heading">
          <div className="recent-head">
            <h2 id="recent-heading">{ru.launcher.recentHeading}</h2>
            <button type="button" data-testid="recent-clear" onClick={onClearRecent}>
              {ru.launcher.recentClear}
            </button>
          </div>
          <ul>
            {recent.map((file) => (
              <li
                key={file.path}
                className={file.exists ? 'recent-item' : 'recent-item missing'}
                data-testid="recent-item"
                data-exists={file.exists}
              >
                {/* A missing file stays clickable: opening it shows the usual "file not found" message. */}
                <button
                  type="button"
                  className="recent-open"
                  data-testid="recent-open"
                  title={file.path}
                  onClick={() => onOpenRecent(file.path)}
                >
                  <span className="recent-name">{file.name}</span>
                  <span className="recent-dir">
                    {file.exists
                      ? file.directory
                      : `${file.directory} — ${ru.launcher.recentMissing}`}
                  </span>
                </button>
                <button
                  type="button"
                  className="recent-remove"
                  data-testid="recent-remove"
                  aria-label={ru.launcher.recentRemove(file.name)}
                  title={ru.launcher.recentRemove(file.name)}
                  onClick={() => onRemoveRecent(file.path)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {version && <small>{ru.app.version(version)}</small>}
    </main>
  )
}
