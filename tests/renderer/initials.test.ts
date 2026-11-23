import { describe, expect, it } from 'vitest'
import { colorOf, initialsOf } from '../../src/renderer/components/sidebar/initials'

describe('icons of the collapsed list (2026-11-23)', () => {
    it('takes the first letter of the first two words', () => {
        expect(initialsOf('Бюджет на ноябрь')).toBe('БН')
        expect(initialsOf('аренда')).toBe('А')
        expect(initialsOf('«Новый» проект — 2027')).toBe('НП')
        expect(initialsOf('2027 plan')).toBe('2P')
        expect(initialsOf('🎉 Party time')).toBe('PT')
        expect(initialsOf('   ')).toBe('?')
        expect(initialsOf('🎉')).toBe('🎉')
    })

    it('gives the same color for the same title', () => {
        expect(colorOf('Бюджет')).toBe(colorOf('Бюджет'))
        expect(colorOf('Бюджет')).toMatch(/^hsl\(\d+ 55% 36%\)$/)
    })
})
