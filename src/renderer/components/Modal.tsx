import { useEffect, useRef } from 'react'

interface Props {
    /** ID of the element that names the dialog. */
    labelledBy: string
    /** Called on Escape. Omit if the dialog has its own handling. */
    onEscape?: () => void
    /** Give focus back to the previous element on close. Turn off when the caller moves focus itself (the link dialog). */
    restoreFocus?: boolean
    children: React.ReactNode
}

const FOCUSABLE =
    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

/**
 * The overlay of a modal dialog with keyboard handling (NFR-003): Tab and Shift+Tab stay inside the dialog, Escape
 * closes it, and focus returns to where it was when the dialog closes.
 */
export function Modal({
    labelledBy,
    onEscape,
    restoreFocus = true,
    children
}: Props): React.JSX.Element {
    const ref = useRef<HTMLDivElement>(null)

    // Captured during the first render, before any child (autoFocus) moves focus into the dialog.
    const previousRef = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null)

    useEffect(() => {
        const previous = previousRef.current
        return () => {
            // After the dialog is gone, give focus back (for example to the message field).
            // Only if focus was lost with the dialog: when the caller already moved focus (for example back into the
            // editor), moving it again would reset the editor's selection.
            const lost = !document.activeElement || document.activeElement === document.body
            if (
                restoreFocus &&
                lost &&
                previous &&
                previous !== document.body &&
                document.contains(previous)
            )
                previous.focus()
        }
    }, [])

    const onKeyDown = (event: React.KeyboardEvent): void => {
        if (event.key === 'Escape' && onEscape) {
            event.stopPropagation()
            onEscape()
            return
        }
        if (event.key !== 'Tab' || !ref.current) return
        const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
            (el) => el.offsetParent !== null
        )
        if (items.length === 0) return
        const first = items[0]!
        const last = items[items.length - 1]!
        const active = document.activeElement
        if (event.shiftKey && (active === first || !ref.current.contains(active))) {
            event.preventDefault()
            last.focus()
        } else if (!event.shiftKey && (active === last || !ref.current.contains(active))) {
            event.preventDefault()
            first.focus()
        }
    }

    return (
        <div
            ref={ref}
            className="overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            onKeyDown={onKeyDown}
        >
            {children}
        </div>
    )
}
