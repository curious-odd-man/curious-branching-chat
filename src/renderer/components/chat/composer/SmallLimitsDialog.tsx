import { texts } from '@shared/i18n'
import type { SmallLimit } from '@shared/types/ipc'
import { Modal } from '../../Modal'
import { groupLimits } from './content'

/** FR-268: some members will not get a file of the message, because their limit is smaller. */
export function SmallLimitsDialog({
    limits,
    onSend,
    onCancel
}: {
    limits: readonly SmallLimit[]
    onSend(): void
    onCancel(): void
}): React.JSX.Element {
    return (
        <Modal labelledBy="small-limits-title" onEscape={onCancel}>
            <div
                className="dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="small-limits-title"
                data-testid="small-limits"
            >
                <h2 id="small-limits-title">{texts().attachments.smallLimitsTitle}</h2>
                {groupLimits(limits).map((g) => (
                    <p key={g.mb}>
                        {g.names.length === 1
                            ? texts().attachments.smallLimitsOne(g.names[0]!, g.mb)
                            : texts().attachments.smallLimits(
                                  texts().attachments.joinNames(g.names),
                                  g.mb
                              )}
                    </p>
                ))}
                <p className="hint">{texts().attachments.smallLimitsHint}</p>
                <div className="dialog-actions">
                    <button
                        type="button"
                        className="primary"
                        data-testid="send-anyway"
                        autoFocus
                        onClick={onSend}
                    >
                        {texts().attachments.sendAnyway}
                    </button>
                    <button type="button" onClick={onCancel}>
                        {texts().attachments.cancel}
                    </button>
                </div>
            </div>
        </Modal>
    )
}
