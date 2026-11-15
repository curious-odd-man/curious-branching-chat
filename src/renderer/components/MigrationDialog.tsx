import { useState } from 'react'
import { describeError, ru } from '@shared/i18n/ru'
import type { MigrationCandidate, MigrationResult } from '@shared/types/ipc'
import { Modal } from './Modal'

interface Props {
    candidates: MigrationCandidate[]
    onClose(): void
}

/** FR-206: the first start of release 2.2 offers the files of release 1.x for the library, all selected. */
export function MigrationDialog({ candidates, onClose }: Props): React.JSX.Element {
    const api = window.branchchat
    const [chosen, setChosen] = useState<Set<string>>(
        () => new Set(candidates.filter((c) => c.exists).map((c) => c.path))
    )
    const [busy, setBusy] = useState(false)
    const [results, setResults] = useState<MigrationResult[] | null>(null)
    const [error, setError] = useState<string | null>(null)

    const toggle = (path: string, on: boolean): void =>
        setChosen((s) => {
            const n = new Set(s)
            if (on) n.add(path)
            else n.delete(path)
            return n
        })
    const run = (): void => {
        setBusy(true)
        setError(null)
        void api
            .runMigration(candidates.filter((c) => chosen.has(c.path)).map((c) => c.path))
            .then((r) => (r.ok ? setResults(r.data) : setError(r.error.message)))
            .finally(() => setBusy(false))
    }
    const skip = (): void => {
        void api.skipMigration().then(() => onClose())
    }

    return (
        <Modal labelledBy="migration-title">
            <div className="dialog wide" data-testid="migration-dialog">
                <h2 id="migration-title">{ru.migration.title}</h2>
                {results === null ? (
                    <>
                        <p>{ru.migration.text}</p>
                        <ul className="migration-list">
                            {candidates.map((c) => (
                                <li
                                    key={c.path}
                                    data-testid="migration-item"
                                    data-exists={c.exists}
                                >
                                    <label title={c.path}>
                                        <input
                                            type="checkbox"
                                            disabled={!c.exists || busy}
                                            checked={chosen.has(c.path)}
                                            onChange={(e) => toggle(c.path, e.target.checked)}
                                        />
                                        <span className="recent-name">
                                            {c.name}
                                            {c.synced && (
                                                <span className="recent-shared">
                                                    {' '}
                                                    · {ru.launcher.shared}
                                                </span>
                                            )}
                                        </span>
                                        <span className="recent-dir">
                                            {c.exists
                                                ? c.path
                                                : `${c.path} — ${ru.migration.missing}`}
                                        </span>
                                    </label>
                                </li>
                            ))}
                        </ul>
                        <p className="hint">{ru.migration.backupHint}</p>
                        {error && <p className="error-text">{error}</p>}
                        <div className="buttons">
                            <button
                                type="button"
                                data-testid="migration-skip"
                                disabled={busy}
                                onClick={skip}
                            >
                                {ru.migration.skip}
                            </button>
                            <button
                                type="button"
                                className="primary"
                                data-testid="migration-run"
                                disabled={busy || chosen.size === 0}
                                onClick={run}
                            >
                                {busy ? ru.migration.running : ru.migration.run}
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <ul className="migration-list">
                            {results.map((r) => (
                                <li
                                    key={r.path}
                                    data-testid="migration-result"
                                    data-status={r.status}
                                >
                                    <span className="recent-name">{r.name}</span>
                                    <span className="recent-dir">
                                        {r.status === 'failed'
                                            ? `${ru.migration.failed}: ${describeError(r.errorCode)}`
                                            : r.status === 'merged'
                                              ? ru.migration.merged
                                              : ru.migration.imported}
                                    </span>
                                </li>
                            ))}
                        </ul>
                        <p className="hint">{ru.migration.originalsKept}</p>
                        <div className="buttons">
                            <button
                                type="button"
                                className="primary"
                                data-testid="migration-done"
                                autoFocus
                                onClick={onClose}
                            >
                                {ru.migration.done}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </Modal>
    )
}
