import { useState } from 'react'
import { mainThread } from '@shared/domain'
import { ru } from '@shared/i18n/ru'
import type { DocumentView } from '@shared/types/ipc'
import { Composer } from './Composer'
import { MessageList } from './MessageList'

interface Props {
  view: DocumentView
  onSend(text: string, clear: () => void): void
  onRetrySave(): void
}

export function DiscussionScreen({ view, onSend, onRetrySave }: Props): React.JSX.Element {
  const [dismissed, setDismissed] = useState<string[]>([])
  const thread = mainThread(view.discussion)
  const status = view.saveError ? null : view.saving ? ru.discussion.saving : ru.discussion.saved

  return (
    <div className="discussion">
      <header className="discussion-header">
        <h1 title={view.filePath}>{view.fileName}</h1>
        {status && (
          <span className="status" data-testid="status">
            {status}
          </span>
        )}
      </header>

      {view.saveError && (
        <div className="banner error" role="alert" data-testid="save-error">
          <span>{ru.discussion.saveFailed(view.saveError)}</span>
          <button type="button" data-testid="retry-save" onClick={onRetrySave}>
            {ru.discussion.retry}
          </button>
        </div>
      )}
      {view.notices
        .filter((n) => !dismissed.includes(n))
        .map((notice) => (
          <div className="banner notice" role="status" data-testid="notice" key={notice}>
            <span>{notice}</span>
            <button type="button" onClick={() => setDismissed([...dismissed, notice])}>
              {ru.discussion.dismiss}
            </button>
          </div>
        ))}

      <MessageList messages={thread.messages} localParticipantId={view.localParticipantId} />
      <Composer onSend={onSend} />
    </div>
  )
}
