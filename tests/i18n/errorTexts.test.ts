import { afterEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { DOMAIN_ERROR_CODES, DomainError } from '@shared/domain'
import { describeError, setLanguage } from '@shared/i18n'
import { en } from '@shared/i18n/en'
import { ru } from '@shared/i18n/ru'
import { APP_ERROR_CODES, AppError } from '../../src/main/application/errors'
import { DOCUMENT_ERROR_CODES } from '../../src/main/document/errors'
import { toError } from '../../src/main/ipc/handlers'
import { LIBRARY_ERROR_CODES, LibraryError } from '../../src/main/library/schema'

const ALL_CODES = [
    ...DOMAIN_ERROR_CODES,
    ...APP_ERROR_CODES,
    ...DOCUMENT_ERROR_CODES,
    ...LIBRARY_ERROR_CODES,
    'UNKNOWN'
]

describe('error texts (NFR-205)', () => {
    afterEach(() => setLanguage('ru'))

    it('every error code has a text in Russian and in English', () => {
        const missing = (texts: Record<string, string>) =>
            [...new Set(ALL_CODES)].filter((c) => !texts[c])
        expect(missing(ru.errors)).toEqual([])
        expect(missing(en.errors)).toEqual([])
    })

    it('the window gets the text of the code, never the internal message', () => {
        const domain = toError(new DomainError('EMPTY_QUOTE', 'internal text'))
        expect(domain).toEqual({ code: 'EMPTY_QUOTE', message: ru.errors['EMPTY_QUOTE'] })
        expect(toError(new AppError('NO_MEMBERS', 'internal')).message).toBe(
            ru.errors['NO_MEMBERS']
        )
        expect(toError(new LibraryError('CONFLICT', 'internal')).message).toBe(
            ru.errors['CONFLICT']
        )
        expect(toError(new ZodError([]))).toEqual({
            code: 'INVALID_REQUEST',
            message: ru.errors['INVALID_REQUEST']
        })
        setLanguage('en')
        expect(toError(new DomainError('THREAD_CLOSED', 'x')).message).toBe(
            describeError('THREAD_CLOSED')
        )
        expect(toError(new DomainError('THREAD_CLOSED', 'x')).message).toBe(
            en.errors['THREAD_CLOSED']
        )
    })

    it('an error without a code is logged and shown as unknown', () => {
        const logged: string[] = []
        const r = toError(
            new TypeError('x is undefined'),
            (m, e) => logged.push(`${m}: ${(e as Error).message}`),
            'document:append-message'
        )
        expect(r).toEqual({ code: 'UNKNOWN', message: ru.errors['UNKNOWN'] })
        expect(logged).toEqual(['unexpected error in document:append-message: x is undefined'])
    })
})
