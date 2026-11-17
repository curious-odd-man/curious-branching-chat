import { Modal } from './Modal'
import { texts } from '@shared/i18n'

interface Props {
    onConfirm(): void
    onCancel(): void
}

/** Shown once per computer before the first change to the person's read state (FR-125). */
export function ReadNotice({ onConfirm, onCancel }: Props): React.JSX.Element {
    return (
        <Modal labelledBy="read-notice-title" onEscape={onCancel}>
            <div className="dialog" data-testid="read-notice">
                <h2 id="read-notice-title">{texts().readNotice.title}</h2>
                <p>{texts().readNotice.text}</p>
                <div className="buttons">
                    <button type="button" data-testid="read-notice-cancel" onClick={onCancel}>
                        {texts().readNotice.cancel}
                    </button>
                    <button
                        type="button"
                        className="primary"
                        data-testid="read-notice-confirm"
                        autoFocus
                        onClick={onConfirm}
                    >
                        {texts().readNotice.confirm}
                    </button>
                </div>
            </div>
        </Modal>
    )
}
