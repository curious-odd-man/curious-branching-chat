import { useState } from 'react'
import { normalizeLinkInput } from '@shared/validation'
import { Modal } from '../Modal'
import { texts } from '@shared/i18n'

interface Props {
    initialLabel: string
    initialHref: string
    onApply(label: string, href: string): void
    /** Present only when the cursor is in an existing link. */
    onRemove?: () => void
    onCancel(): void
}

/** Link with a label and an address (FR-071). Only http, https and mailto addresses are accepted. */
export function LinkDialog({
    initialLabel,
    initialHref,
    onApply,
    onRemove,
    onCancel
}: Props): React.JSX.Element {
    const [label, setLabel] = useState(initialLabel)
    const [url, setUrl] = useState(initialHref)
    const [invalid, setInvalid] = useState(false)

    const submit = (): void => {
        const href = normalizeLinkInput(url)
        if (!href) return setInvalid(true)
        onApply(label, href)
    }
    const onKeyDown = (event: React.KeyboardEvent): void => {
        if (event.key === 'Enter') {
            event.preventDefault()
            submit()
        }
        if (event.key === 'Escape') onCancel()
    }

    return (
        <Modal labelledBy="link-title" restoreFocus={false}>
            <div className="dialog">
                <h2 id="link-title">{texts().linkDialog.title}</h2>
                <label>
                    {texts().linkDialog.label}
                    <input
                        data-testid="link-label"
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        onKeyDown={onKeyDown}
                    />
                </label>
                <label>
                    {texts().linkDialog.url}
                    <input
                        data-testid="link-url"
                        autoFocus
                        value={url}
                        onChange={(e) => {
                            setUrl(e.target.value)
                            setInvalid(false)
                        }}
                        onKeyDown={onKeyDown}
                    />
                </label>
                {invalid && (
                    <p className="field-error" role="alert" data-testid="link-error">
                        {texts().linkDialog.invalidUrl}
                    </p>
                )}
                <div className="buttons">
                    {onRemove && (
                        <button type="button" data-testid="link-remove" onClick={onRemove}>
                            {texts().linkDialog.remove}
                        </button>
                    )}
                    <button type="button" onClick={onCancel}>
                        {texts().linkDialog.cancel}
                    </button>
                    <button
                        type="button"
                        className="primary"
                        data-testid="link-apply"
                        onClick={submit}
                    >
                        {texts().linkDialog.apply}
                    </button>
                </div>
            </div>
        </Modal>
    )
}
