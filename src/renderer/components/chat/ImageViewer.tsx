import { useEffect } from 'react'
import { texts } from '@shared/i18n'

interface Props {
    url: string
    alt: string
    onClose(): void
}

/** The larger view of an image (FR-069). Closes with Escape, the button, or a click outside the picture. */
export function ImageViewer({ url, alt, onClose }: Props): React.JSX.Element {
    useEffect(() => {
        const onKey = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') onClose()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [onClose])

    return (
        // eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/no-noninteractive-element-interactions -- a click outside the picture closes; keys: Escape and the close button
        <div
            className="overlay viewer"
            role="dialog"
            aria-modal="true"
            aria-label={texts().images.viewerTitle}
            data-testid="image-viewer"
            onClick={onClose}
        >
            <button
                type="button"
                className="viewer-close"
                data-testid="viewer-close"
                aria-label={texts().images.close}
                onClick={onClose}
            >
                ✕
            </button>
            {/* eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/no-noninteractive-element-interactions -- only stops the click that closes */}
            <img
                className="viewer-image"
                src={url}
                alt={alt}
                data-testid="viewer-image"
                onClick={(event) => event.stopPropagation()}
            />
        </div>
    )
}
