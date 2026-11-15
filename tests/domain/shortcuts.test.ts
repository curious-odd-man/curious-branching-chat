import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ru } from '@shared/i18n/ru'
import {
    clampTextSize,
    nextTextSize,
    SHORTCUT_GROUPS,
    SHORTCUTS,
    withKeys
} from '@shared/shortcuts'
import { zoomKey } from '../../src/main/windows/zoom'

const source = (path: string): string =>
    readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

describe('shortcut table (FR-311, FR-312)', () => {
    it('every shortcut has a group and a text, and no key is used twice in a group', () => {
        for (const s of SHORTCUTS) {
            expect(SHORTCUT_GROUPS).toContain(s.group)
            expect(ru.shortcuts.actions[s.id]).toBeTruthy()
        }
        for (const group of SHORTCUT_GROUPS) {
            const keys = SHORTCUTS.filter((s) => s.group === group).flatMap((s) => s.keys)
            expect(new Set(keys).size).toBe(keys.length)
        }
        expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length)
    })

    it('the menu and the editor take their keys only from the table', () => {
        // a literal accelerator or key binding would not be in the shortcut list
        expect(source('src/main/application/menu.ts')).not.toMatch(/accelerator:\s*['"`]/)
        expect(source('src/renderer/components/editor/extensions.ts')).not.toMatch(/['"`]Mod-/)
        // and every table entry with an accelerator is used by the menu
        const menu = source('src/main/application/menu.ts')
        for (const s of SHORTCUTS.filter((x) => x.accelerator))
            expect(menu).toContain(`acceleratorOf('${s.id}')`)
    })

    it('button texts get the keys from the table', () => {
        expect(withKeys(ru.editor.bold, 'bold')).toBe('Жирный (Ctrl+B)')
        expect(source('src/shared/i18n/ru.ts')).not.toMatch(/\(Ctrl\+[A-Z]\)/)
    })
})

describe('text size (FR-301)', () => {
    it('stays between 80 and 200 % in steps of 10', () => {
        expect(nextTextSize(100, 'in')).toBe(110)
        expect(nextTextSize(200, 'in')).toBe(200)
        expect(nextTextSize(80, 'out')).toBe(80)
        expect(nextTextSize(150, 'reset')).toBe(100)
        expect(clampTextSize(133)).toBe(130)
        expect(clampTextSize(Number.NaN)).toBe(100)
        expect(clampTextSize(5000)).toBe(200)
    })

    it('Ctrl with plus, equals, minus, zero, and the keypad keys', () => {
        const key = (k: string, code = '', extra: object = {}) =>
            zoomKey({
                type: 'keyDown',
                control: true,
                meta: false,
                alt: false,
                key: k,
                code,
                ...extra
            })
        expect(key('+')).toBe('in')
        expect(key('=')).toBe('in')
        expect(key('', 'NumpadAdd')).toBe('in')
        expect(key('-')).toBe('out')
        expect(key('', 'NumpadSubtract')).toBe('out')
        expect(key('0')).toBe('reset')
        expect(key('+', '', { control: false })).toBeNull()
        expect(key('+', '', { alt: true })).toBeNull() // AltGr on some keyboards
        expect(key('+', '', { type: 'keyUp' })).toBeNull()
        expect(key('b')).toBeNull()
    })
})
