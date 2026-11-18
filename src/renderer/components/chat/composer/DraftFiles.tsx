import { ATTACHMENT_ICONS, attachmentKind } from '@shared/domain'
import { texts } from '@shared/i18n'
import type { Attachment } from '@shared/validation'

/** FR-261: the files of the draft, each with a button to remove it. */
export function DraftFiles({
    files,
    onRemove
}: {
    files: readonly Attachment[]
    onRemove(index: number): void
}): React.JSX.Element | null {
    if (files.length === 0) return null
    return (
        <ul className="draft-files" data-testid="draft-files" aria-label={texts().attachments.list}>
            {files.map((f, i) => (
                <li key={`${i}:${f.sha256}`} data-testid="draft-file" data-name={f.name}>
                    <span aria-hidden="true">{ATTACHMENT_ICONS[attachmentKind(f)]}</span>
                    <span className="attachment-name">{f.name}</span>
                    <span className="attachment-size">{texts().attachments.size(f.size)}</span>
                    <button
                        type="button"
                        className="draft-file-remove"
                        data-testid="draft-file-remove"
                        aria-label={texts().attachments.remove(f.name)}
                        title={texts().attachments.remove(f.name)}
                        onClick={() => onRemove(i)}
                    >
                        ×
                    </button>
                </li>
            ))}
        </ul>
    )
}
