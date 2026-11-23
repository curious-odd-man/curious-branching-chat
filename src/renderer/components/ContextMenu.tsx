import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export type MenuEntry =
    { id: string; label: string; onSelect(): void; danger?: boolean } | { separator: string }

interface Props {
    /** The place of the menu in the window (a right-click, or under a button). */
    x: number
    y: number
    label: string
    entries: readonly MenuEntry[]
    onClose(): void
}

const isItem = (e: MenuEntry): e is Extract<MenuEntry, { id: string }> => 'id' in e

/**
 * A context menu of the page (WAI-ARIA menu): arrow keys, Home and End move, Enter chooses, Escape, Tab or a click
 * outside close it. The focus goes back to where it was.
 */
export function ContextMenu({ x, y, label, entries, onClose }: Props): React.JSX.Element {
    const ref = useRef<HTMLUListElement>(null)
    const [place, setPlace] = useState({ left: x, top: y })
    const back = useRef<Element | null>(document.activeElement)
    const closeRef = useRef(onClose)
    closeRef.current = onClose

    // inside the window: the menu opens to the left or upward near the right or the lower edge
    useLayoutEffect(() => {
        const menu = ref.current
        if (!menu) return
        const r = menu.getBoundingClientRect()
        setPlace({
            left: Math.max(0, Math.min(x, window.innerWidth - r.width - 4)),
            top: Math.max(0, Math.min(y, window.innerHeight - r.height - 4))
        })
        menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    }, [x, y])

    useEffect(() => {
        const outside = (e: PointerEvent): void => {
            if (!ref.current?.contains(e.target as Node)) closeRef.current()
        }
        const away = (): void => closeRef.current()
        document.addEventListener('pointerdown', outside, true)
        window.addEventListener('blur', away)
        window.addEventListener('resize', away)
        const previous = back.current
        return () => {
            document.removeEventListener('pointerdown', outside, true)
            window.removeEventListener('blur', away)
            window.removeEventListener('resize', away)
            // not when the chosen action moved the focus (a dialog that opened)
            const now = document.activeElement
            const lost = now === null || now === document.body
            if (lost && previous instanceof HTMLElement && previous.isConnected) previous.focus()
        }
    }, [])

    const onKeyDown = (e: React.KeyboardEvent): void => {
        const items = [
            ...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
        ]
        const at = items.indexOf(document.activeElement as HTMLButtonElement)
        const go = (i: number): void => {
            e.preventDefault()
            items[(i + items.length) % items.length]?.focus()
        }
        if (e.key === 'ArrowDown') go(at + 1)
        else if (e.key === 'ArrowUp') go(at - 1)
        else if (e.key === 'Home') go(0)
        else if (e.key === 'End') go(items.length - 1)
        else if (e.key === 'Escape' || e.key === 'Tab') {
            e.preventDefault()
            onClose()
        }
    }

    return (
        <ul
            ref={ref}
            className="context-menu"
            role="menu"
            aria-label={label}
            data-testid="context-menu"
            style={{ left: place.left, top: place.top }}
            onKeyDown={onKeyDown}
            onContextMenu={(e) => e.preventDefault()}
        >
            {entries.map((entry) =>
                isItem(entry) ? (
                    <li key={entry.id} role="none">
                        <button
                            type="button"
                            role="menuitem"
                            className={entry.danger ? 'danger' : undefined}
                            data-testid={`menu-${entry.id}`}
                            onClick={() => {
                                onClose()
                                entry.onSelect()
                            }}
                        >
                            {entry.label}
                        </button>
                    </li>
                ) : (
                    <li key={entry.separator} role="separator" className="context-menu-separator" />
                )
            )}
        </ul>
    )
}
