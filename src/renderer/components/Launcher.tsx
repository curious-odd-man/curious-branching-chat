import { ru } from '@shared/i18n/ru'
import type { DiscussionListItem } from '@shared/types/ipc'
import { formatTimestamp } from '../i18n/format'

interface Props {
    version: string
    discussions: readonly DiscussionListItem[]
    onNew(): void
    onImport(): void
    onOpenDiscussion(id: string): void
}

/** Shown in a window that has no discussion yet: the discussions of the library, newest use first (ADR-003). */
export function Launcher({
    version,
    discussions,
    onNew,
    onImport,
    onOpenDiscussion
}: Props): React.JSX.Element {
    return (
        <main className="launcher">
            <h1>{ru.app.name}</h1>
            <p>{ru.app.tagline}</p>
            <div className="buttons">
                <button
                    type="button"
                    className="primary"
                    data-testid="launcher-new"
                    onClick={onNew}
                >
                    {ru.launcher.newDiscussion}
                </button>
                <button type="button" data-testid="launcher-open" onClick={onImport}>
                    {ru.launcher.openDiscussion}
                </button>
            </div>
            <p className="hint">{ru.launcher.dropHint}</p>
            {discussions.length > 0 && (
                <section
                    className="recent"
                    data-testid="discussion-list"
                    aria-labelledby="recent-heading"
                >
                    <div className="recent-head">
                        <h2 id="recent-heading">{ru.launcher.recentHeading}</h2>
                    </div>
                    <ul>
                        {discussions.map((d) => (
                            <li key={d.id} className="recent-item" data-testid="discussion-item">
                                <button
                                    type="button"
                                    className="recent-open"
                                    data-testid="discussion-open"
                                    onClick={() => onOpenDiscussion(d.id)}
                                >
                                    <span className="recent-name">
                                        {d.title}
                                        {d.synced && (
                                            <span className="recent-shared">
                                                {' '}
                                                · {ru.launcher.shared}
                                            </span>
                                        )}
                                    </span>
                                    <span className="recent-dir">
                                        {d.lastMessageAt
                                            ? ru.launcher.lastMessage(
                                                  formatTimestamp(d.lastMessageAt),
                                                  d.messageCount
                                              )
                                            : ru.launcher.noMessages}
                                    </span>
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
