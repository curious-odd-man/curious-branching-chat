import { texts } from '@shared/i18n'
import type { DiscussionListItem } from '@shared/types/ipc'
import { useApi, useIpcAction } from '../api'
import { Modal } from './Modal'

/** "Удалить…": the person confirms; a shared discussion is left (the other members keep it). */
export function DeleteDialog({
    discussion,
    onClose
}: {
    discussion: DiscussionListItem
    onClose(): void
}): React.JSX.Element {
    const api = useApi()
    const { error, busy, run } = useIpcAction()
    return (
        <Modal labelledBy="delete-title" onEscape={onClose}>
            <div className="dialog" data-testid="delete-dialog">
                <h2 id="delete-title">{texts().deleteDiscussion.title(discussion.title)}</h2>
                <p>
                    {discussion.synced
                        ? texts().deleteDiscussion.shared
                        : texts().deleteDiscussion.local}
                </p>
                {error && (
                    <p className="error-text" role="alert" data-testid="delete-error">
                        {error}
                    </p>
                )}
                <div className="buttons">
                    <button type="button" data-testid="delete-cancel" autoFocus onClick={onClose}>
                        {texts().deleteDiscussion.cancel}
                    </button>
                    <button
                        type="button"
                        className="primary danger"
                        data-testid="delete-confirm"
                        disabled={busy}
                        onClick={() => void run(() => api.deleteDiscussion(discussion.id), onClose)}
                    >
                        {texts().deleteDiscussion.confirm}
                    </button>
                </div>
            </div>
        </Modal>
    )
}
