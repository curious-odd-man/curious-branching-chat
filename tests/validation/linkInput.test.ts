import { describe, expect, it } from 'vitest'
import { normalizeLinkInput } from '@shared/validation'

describe('normalizeLinkInput', () => {
    it.each([
        ['example.com', 'https://example.com'],
        ['  example.com/страница?a=1 ', 'https://example.com/страница?a=1'],
        ['http://example.com', 'http://example.com'],
        ['https://example.com/x', 'https://example.com/x'],
        ['anna@example.com', 'mailto:anna@example.com'],
        ['mailto:anna@example.com', 'mailto:anna@example.com'],
        ['localhost:3000/app', 'https://localhost:3000/app']
    ])('%s -> %s', (input, expected) => {
        expect(normalizeLinkInput(input)).toBe(expected)
    })

    it.each([
        '',
        '   ',
        'javascript:alert(1)',
        'JAVASCRIPT:alert(1)',
        'file:///C:/Windows',
        'ftp://example.com',
        'data:text/html,x',
        'two words',
        'vbscript:x'
    ])('rejects %j', (input) => {
        expect(normalizeLinkInput(input)).toBeNull()
    })
})
