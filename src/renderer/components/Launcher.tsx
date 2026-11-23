import { texts } from '@shared/i18n'

interface Props {
    version: string
    onNew(): void
    onNewShared(): void
    onJoin(): void
    onImport(): void
}

/**
 * The start screen, shown only while the library has no discussions: create a discussion here, create a shared one,
 * join a shared one by invitation, or import a `.branchchat` file.
 */
export function Launcher({
    version,
    onNew,
    onNewShared,
    onJoin,
    onImport
}: Props): React.JSX.Element {
    return (
        <main className="launcher" data-testid="launcher">
            <h1>{texts().app.name}</h1>
            <p>{texts().app.tagline}</p>
            <p className="hint">{texts().launcher.empty}</p>
            <div className="buttons launcher-actions">
                <button
                    type="button"
                    className="primary"
                    data-testid="launcher-new"
                    onClick={onNew}
                >
                    {texts().launcher.newDiscussion}
                </button>
                <button type="button" data-testid="launcher-new-shared" onClick={onNewShared}>
                    {texts().launcher.newShared}
                </button>
                <button type="button" data-testid="launcher-join" onClick={onJoin}>
                    {texts().launcher.joinShared}
                </button>
                <button type="button" data-testid="launcher-open" onClick={onImport}>
                    {texts().launcher.openDiscussion}
                </button>
            </div>
            <p className="hint">{texts().launcher.dropHint}</p>
            {version && <small>{texts().app.version(version)}</small>}
        </main>
    )
}
