import { useMemo } from 'react'
import { discussionStats } from '@shared/domain'
import { texts } from '@shared/i18n'
import type { DocumentView } from '@shared/types/ipc'

/** The stats of the whole discussion, under its title: messages by branch status, read state, delivery, size. */
export function StatsLine({ view }: { view: DocumentView }): React.JSX.Element {
    const s = useMemo(
        () =>
            discussionStats({
                discussion: view.discussion,
                readState: view.readState,
                localParticipantId: view.localParticipantId,
                copies: view.copies,
                loadingCount: view.loading.length
            }),
        [view.discussion, view.readState, view.localParticipantId, view.copies, view.loading]
    )
    const t = texts().stats
    const size = texts().attachments.size
    return (
        <p className="discussion-stats" data-testid="discussion-stats" aria-label={t.label}>
            <span data-testid="stats-messages">
                {t.messages(s.messages)} ({t.open(s.inOpenBranches)}, {t.closed(s.inClosedBranches)}
                )
            </span>
            <span data-testid="stats-read">
                {t.read(s.read)}, {t.unread(s.unread)}
            </span>
            {view.synced && (
                <span data-testid="stats-delivery">
                    {t.delivered(s.delivered)}, {t.waiting(s.waiting)}
                    {s.loading > 0 && `, ${t.loading(s.loading)}`}
                </span>
            )}
            <span data-testid="stats-text">{t.text(size(s.textBytes))}</span>
            <span data-testid="stats-files">{t.files(size(s.fileBytes))}</span>
        </p>
    )
}
