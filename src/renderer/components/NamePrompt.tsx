import { useState } from 'react'
import { Modal } from './Modal'
import { ru } from '@shared/i18n/ru'

interface Props {
  onSubmit(name: string): void
  onCancel(): void
}

/** Asks for the participant name (FR-019). Shown before the first message or new discussion if no name is saved. */
export function NamePrompt({ onSubmit, onCancel }: Props): React.JSX.Element {
  const [name, setName] = useState('')
  const valid = name.trim().length > 0
  return (
    <Modal labelledBy="name-title">
      <div className="dialog">
        <h2 id="name-title">{ru.nameDialog.title}</h2>
        <p>{ru.nameDialog.explanation}</p>
        <label>
          {ru.nameDialog.label}
          <input
            data-testid="name-input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && valid) onSubmit(name)
              if (e.key === 'Escape') onCancel()
            }}
          />
        </label>
        <div className="buttons">
          <button type="button" onClick={onCancel}>
            {ru.nameDialog.cancel}
          </button>
          <button
            type="button"
            className="primary"
            data-testid="name-confirm"
            disabled={!valid}
            onClick={() => onSubmit(name)}
          >
            {ru.nameDialog.confirm}
          </button>
        </div>
      </div>
    </Modal>
  )
}
