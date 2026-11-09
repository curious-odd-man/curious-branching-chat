import { Modal } from './Modal'
import { ru } from '@shared/i18n/ru'

interface Props {
    onConfirm(): void
    onCancel(): void
}

/** Shown once per computer before the first change to the person's read state (FR-125). */
export function ReadNotice({ onConfirm, onCancel }: Props): React.JSX.Element {
    return (
        <Modal labelledBy="read-notice-title" onEscape={onCancel}>
            <div className="dialog" data-testid="read-notice">
                <h2 id="read-notice-title">{ru.readNotice.title}</h2>
                <p>{ru.readNotice.text}</p>
                <div className="buttons">
                    <button type="button" data-testid="read-notice-cancel" onClick={onCancel}>
                        {ru.readNotice.cancel}
                    </button>
                    <button
                        type="button"
                        className="primary"
                        data-testid="read-notice-confirm"
                        autoFocus
                        onClick={onConfirm}
                    >
                        {ru.readNotice.confirm}
                    </button>
                </div>
            </div>
        </Modal>
    )
}
