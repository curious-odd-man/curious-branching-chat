import { useState } from 'react'

interface Props {
    testId: string
    label: string
    min: number
    max?: number
    /** The value in the settings; undefined until the settings are loaded. */
    value: number | undefined
    /** Shown while the settings are not loaded. */
    fallback: number
    onApply(value: number): void
}

/**
 * A whole number that is typed as text and applied when the field loses focus or Enter is pressed. A value that is not
 * a whole number in the range puts the old value back.
 */
export function NumberField({
    testId,
    label,
    min,
    max,
    value,
    fallback,
    onApply
}: Props): React.JSX.Element {
    const [text, setText] = useState(String(value ?? fallback))
    const apply = (): void => {
        const next = Number(text)
        const valid =
            text.trim() !== '' &&
            Number.isInteger(next) &&
            next >= min &&
            (max === undefined || next <= max)
        if (!valid) {
            setText(String(value ?? fallback))
            return
        }
        if (next !== value) onApply(next)
    }
    return (
        <label>
            {label}
            <input
                type="number"
                min={min}
                max={max}
                step={1}
                data-testid={testId}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onBlur={apply}
                onKeyDown={(e) => e.key === 'Enter' && apply()}
            />
        </label>
    )
}
