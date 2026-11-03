import {ru} from '@shared/i18n/ru'

interface Props {
  version: string
  onNew(): void
  onOpen(): void
}

/** Shown in a window that has no discussion yet. */
export function Launcher({ version, onNew, onOpen }: Props): React.JSX.Element {
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
      {version && <small>{ru.app.version(version)}</small>}
    </main>
  )
}
