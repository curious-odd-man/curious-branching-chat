import { en } from './en'
import { ru } from './ru'

/**
 * Text lookup (FR-291, NFR-205). All interface texts are in `ru.ts` and `en.ts`; code takes them from `texts()`, never
 * from one language directly. The language is chosen once when the process starts (FR-293: a change applies after a
 * restart): the main process reads it from the settings, a window gets it from the preload script.
 */

/** A string literal type becomes `string`, so `en.ts` must have the same keys and signatures, not the same words. */
type Widen<T> = T extends string
    ? string
    : T extends (...args: infer A) => infer R
      ? (...args: A) => Widen<R>
      : T extends readonly (infer U)[]
        ? readonly Widen<U>[]
        : T extends object
          ? { readonly [K in keyof T]: Widen<T[K]> }
          : T

export type Texts = Widen<typeof ru>

export const LANGUAGES = ['ru', 'en'] as const
export type Language = (typeof LANGUAGES)[number]

let current: Language = 'ru'

export function isLanguage(value: unknown): value is Language {
    return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value)
}

/** Called once at start (main process: from the settings; window: from the preload script). */
export function setLanguage(language: Language): void {
    current = language
}

export function language(): Language {
    return current
}

/** The texts of the chosen language. */
export function texts(): Texts {
    return current === 'en' ? en : ru
}

/** FR-291: date, time, and number formats follow the language. */
export function locale(): string {
    return current === 'en' ? 'en-GB' : 'ru-RU'
}

/** Sorts names in the order of the chosen language. */
export function compareText(a: string, b: string): number {
    return a.localeCompare(b, current)
}

export function describeError(code: string | undefined): string {
    const errors = texts().errors
    return errors[code ?? 'UNKNOWN'] ?? errors['UNKNOWN']!
}
