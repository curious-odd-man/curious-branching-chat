import { useEffect, useState } from 'react'
import { ru } from '@shared/i18n/ru'

interface Props {
  /** Called with the text; call `clear` once it was sent. */
  onSend(text: string, clear: () => void): void
}

export function Composer({ onSend }: Props): React.JSX.Element {
  const [text, setText] = useState('')
  const hasDraft = text.trim().length > 0

  // The main process needs to know about an unsent draft to warn when the window is closed (FR-008).
  useEffect(() => {
    void window.branchchat.setDraftState(hasDraft)
    return () => void window.branchchat.setDraftState(false)
  }, [hasDraft])

  const send = (): void => {
    if (hasDraft) onSend(text, () => setText(''))
  }

  return (
    <footer className="composer">
      <textarea
        data-testid="composer"
        value={text}
        placeholder={ru.composer.placeholder}
        rows={3}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault()
            send()
          }
        }}
      />
      <div className="composer-actions">
        <small>{ru.composer.hint}</small>
        <button
          type="button"
          className="primary"
          data-testid="send"
          disabled={!hasDraft}
          onClick={send}
        >
          {ru.composer.send}
        </button>
      </div>
    </footer>
  )
}
