import { useEffect, useRef, useState } from 'react'
import { ru } from '@shared/i18n/ru'

interface Props {
    testId: string
    label: string
    glyph: React.ReactNode
    colors: readonly string[]
    onPick(color: string | null): void
}

export function ColorMenu({ testId, label, glyph, colors, onPick }: Props): React.JSX.Element {
    const [open, setOpen] = useState(false)
    const root = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!open) return
        const close = (event: MouseEvent): void => {
            if (!root.current?.contains(event.target as Node)) setOpen(false)
        }
        const onKey = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('mousedown', close)
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('mousedown', close)
            document.removeEventListener('keydown', onKey)
        }
    }, [open])

    const pick = (color: string | null): void => {
        setOpen(false)
        onPick(color)
    }

    return (
        <div className="color-menu" ref={root}>
            <button
                type="button"
                title={label}
                aria-label={label}
                aria-haspopup="menu"
                aria-expanded={open}
                data-testid={testId}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setOpen(!open)}
            >
                {glyph}
            </button>
            {open && (
                <div className="color-popup" role="menu">
                    {colors.map((color) => (
                        <button
                            key={color}
                            type="button"
                            role="menuitem"
                            className="swatch"
                            style={{ backgroundColor: color }}
                            title={ru.editor.colorNames[color] ?? color}
                            aria-label={ru.editor.colorNames[color] ?? color}
                            data-testid={`${testId}-${color.slice(1)}`}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => pick(color)}
                        />
                    ))}
                    <button
                        type="button"
                        role="menuitem"
                        className="no-color"
                        data-testid={`${testId}-none`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pick(null)}
                    >
                        {ru.editor.noColor}
                    </button>
                </div>
            )}
        </div>
    )
}
