import { useState } from 'react'
import { Modal } from './Modal'
import { ru } from '@shared/i18n/ru'

interface Props {
    onSubmit(title: string): void
    onCancel(): void
}

/** "Новое обсуждение": asks for the name of the discussion (FR-202). */
export function TitlePrompt({ onSubmit, onCancel }: Props): React.JSX.Element {
    const [title, setTitle] = useState<string>(ru.newDiscussion.defaultTitle)
    const valid = title.trim().length > 0
    return (
        <Modal labelledBy="new-title">
            <div className="dialog">
                <h2 id="new-title">{ru.newDiscussion.title}</h2>
                <label>
                    {ru.newDiscussion.label}
                    <input
                        data-testid="new-title-input"
                        autoFocus
                        maxLength={500}
                        value={title}
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => setTitle(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && valid) onSubmit(title.trim())
                            if (e.key === 'Escape') onCancel()
                        }}
                    />
                </label>
                <div className="buttons">
                    <button type="button" onClick={onCancel}>
                        {ru.newDiscussion.cancel}
                    </button>
                    <button
                        type="button"
                        className="primary"
                        data-testid="new-title-confirm"
                        disabled={!valid}
                        onClick={() => onSubmit(title.trim())}
                    >
                        {ru.newDiscussion.confirm}
                    </button>
                </div>
            </div>
        </Modal>
    )
}
