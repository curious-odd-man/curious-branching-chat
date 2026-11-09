import { useEffect } from 'react'
import { ru } from '@shared/i18n/ru'

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
        <div
            className="overlay viewer"
            role="dialog"
            aria-modal="true"
            aria-label={ru.images.viewerTitle}
            data-testid="image-viewer"
            onClick={onClose}
        >
            <button
                type="button"
                className="viewer-close"
                data-testid="viewer-close"
                aria-label={ru.images.close}
                onClick={onClose}
            >
                ✕
            </button>
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
