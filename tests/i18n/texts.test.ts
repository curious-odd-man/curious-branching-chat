import { afterEach, describe, expect, it } from 'vitest'
import { en } from '../../src/shared/i18n/en'
import { ru } from '../../src/shared/i18n/ru'
import { describeError, locale, setLanguage, texts } from '../../src/shared/i18n'

/** The shape of a texts object: the same keys, and a function where the other has a function (NFR-205). */
function shape(value: unknown): unknown {
    if (typeof value === 'function') return `function/${value.length}`
    if (Array.isArray(value)) return `array/${value.length}`
    if (typeof value === 'object' && value !== null)
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map((k) => [k, shape((value as Record<string, unknown>)[k])])
        )
    return typeof value
}

function strings(value: unknown, out: string[] = []): string[] {
    if (typeof value === 'string') out.push(value)
    else if (typeof value === 'object' && value !== null)
        for (const v of Object.values(value)) strings(v, out)
    return out
}

describe('texts in Russian and English (FR-291, NFR-205)', () => {
    afterEach(() => setLanguage('ru'))

    it('have the same keys and functions', () => {
        expect(shape(en)).toEqual(shape(ru))
    })

    it('the English texts have no Cyrillic, except the language setting and the search hint about ё', () => {
        const cyrillic = strings(en).filter((s) => /[А-Яа-яЁё]/.test(s))
        expect(cyrillic).toHaveLength(3)
        expect(cyrillic).toEqual(
            expect.arrayContaining([
                'Русский',
                'Язык / Language',
                texts().search.hint.replace(/.*/, en.search.hint)
            ])
        )
    })

    it('texts(), locale(), and errors follow the chosen language', () => {
        expect(texts().menu.file).toBe('Файл')
        expect(locale()).toBe('ru-RU')
        setLanguage('en')
        expect(texts().menu.file).toBe('File')
        expect(locale()).toBe('en-GB')
        expect(describeError('NOT_FOUND')).toBe('File not found.')
        expect(describeError('NO_SUCH_CODE')).toBe('An unexpected error occurred.')
        expect(texts().launcher.lastMessage('today', 1)).toBe('1 message, the last one today')
        expect(texts().attachments.size(1536 * 1024)).toBe('1.5 MB')
    })
})
