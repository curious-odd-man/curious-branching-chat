import { describe, expect, it } from 'vitest'
import {
    ASKED_KEY,
    ASKED_VALUE,
    AssociationBlockedError,
    EXT_KEY,
    FileAssociation,
    PROG_ID,
    PROG_ID_KEY,
    parseRegQuery,
    USER_CHOICE_KEY
} from '../../src/main/windows/fileAssociation'
import { InMemoryRegistry } from '../../src/main/windows/inMemoryRegistry'

const EXE = 'C:\\Users\\Аня\\AppData\\Local\\Programs\\BranchChat\\BranchChat.exe'
const ICON = 'C:\\Users\\Аня\\AppData\\Local\\Programs\\BranchChat\\resources\\document.ico'

/** Registration of another program that owns the type: the extension names it and it has an open command. */
const OTHER_APP_COMMAND = 'HKCU\\Software\\Classes\\Other.App\\shell\\open\\command'
const otherApp = {
    [EXT_KEY]: { '': 'Other.App' },
    [OTHER_APP_COMMAND]: { '': '"C:\\Other\\other.exe" "%1"' }
}

function make(seed: Record<string, Record<string, string>> = {}) {
    const registry = new InMemoryRegistry(seed)
    return { registry, assoc: new FileAssociation(registry, EXE, ICON) }
}

describe('FileAssociation', () => {
    it('is off on a clean profile', async () => {
        expect(await make().assoc.state()).toBe('off')
    })

    it('enable writes the type, the icon and the open command for the current user only', async () => {
        const { registry, assoc } = make()
        await assoc.enable()
        expect(await assoc.state()).toBe('on')
        const dump = registry.dump()
        expect(dump[EXT_KEY]).toEqual({ '': PROG_ID })
        expect(dump[PROG_ID_KEY]).toEqual({ '': 'Обсуждение BranchChat' })
        expect(dump[`${PROG_ID_KEY}\\DefaultIcon`]).toEqual({ '': `${ICON},0` })
        expect(dump[`${PROG_ID_KEY}\\shell\\open\\command`]).toEqual({ '': `"${EXE}" "%1"` })
        for (const key of Object.keys(dump)) expect(key.startsWith('HKCU\\')).toBe(true)
    })

    it('enable is repeatable', async () => {
        const { assoc } = make()
        await assoc.enable()
        await assoc.enable()
        expect(await assoc.state()).toBe('on')
    })

    it('disable removes everything it registered', async () => {
        const { registry, assoc } = make()
        await assoc.enable()
        await assoc.disable()
        expect(await assoc.state()).toBe('off')
        expect(registry.dump()).toEqual({})
    })

    it('never takes over a type held by another program (FR-090)', async () => {
        const { registry, assoc } = make(otherApp)
        expect(await assoc.state()).toBe('other-app')
        await expect(assoc.enable()).rejects.toBeInstanceOf(AssociationBlockedError)
        expect(registry.dump()).toEqual(otherApp)
    })

    it('a leftover plain-text value that names no program holds nothing (can be enabled and replaced)', async () => {
        // seen in practice: the default value of .branchchat was the description "Обсуждение BranchChat"
        const { registry, assoc } = make({
            [EXT_KEY]: { '': 'Обсуждение BranchChat' },
            [`${EXT_KEY}\\OpenWithProgids`]: {}
        })
        expect(await assoc.state()).toBe('off')
        await assoc.enable()
        expect(await assoc.state()).toBe('on')
        expect(registry.dump()[EXT_KEY]).toEqual({ '': PROG_ID })
    })

    it('a program registered for the machine (HKLM) also holds the type', async () => {
        const { assoc } = make({
            [EXT_KEY]: { '': 'Machine.App' },
            'HKLM\\Software\\Classes\\Machine.App\\shell\\open\\command': { '': 'machine.exe "%1"' }
        })
        expect(await assoc.state()).toBe('other-app')
    })

    it('treats a program chosen in Windows (UserChoice) as another app', async () => {
        const { assoc } = make({ [USER_CHOICE_KEY]: { ProgId: 'Applications\\notepad.exe' } })
        expect(await assoc.state()).toBe('other-app')
        await expect(assoc.enable()).rejects.toBeInstanceOf(AssociationBlockedError)
    })

    it('a UserChoice for BranchChat itself is fine', async () => {
        const { assoc } = make({
            [EXT_KEY]: { '': PROG_ID },
            [USER_CHOICE_KEY]: { ProgId: PROG_ID }
        })
        expect(await assoc.state()).toBe('on')
    })

    it("disable leaves another program's registration alone", async () => {
        const { registry, assoc } = make(otherApp)
        await assoc.disable()
        expect(registry.dump()[EXT_KEY]).toEqual({ '': 'Other.App' })
    })

    it('registry keys are case-insensitive, like Windows', async () => {
        const { assoc } = make({ [EXT_KEY.toUpperCase()]: { '': PROG_ID } })
        expect(await assoc.state()).toBe('on')
    })

    it('remembers that the question was asked', async () => {
        const { registry, assoc } = make()
        expect(await assoc.wasAsked()).toBe(false)
        await assoc.markAsked()
        expect(await assoc.wasAsked()).toBe(true)
        expect(registry.dump()[ASKED_KEY]).toEqual({ [ASKED_VALUE.toLowerCase()]: '1' })
    })
})

describe('parseRegQuery', () => {
    it('reads default and named string values', () => {
        expect(
            parseRegQuery(
                '\r\nHKEY_CURRENT_USER\\Software\\Classes\\.branchchat\r\n    (Default)    REG_SZ    BranchChat.Discussion\r\n\r\n'
            )
        ).toBe('BranchChat.Discussion')
        expect(parseRegQuery('    ProgId    REG_SZ    Applications\\notepad.exe\r\n')).toBe(
            'Applications\\notepad.exe'
        )
        expect(parseRegQuery('    (Default)    REG_SZ    "C:\\a b\\x.exe" "%1"\r\n')).toBe(
            '"C:\\a b\\x.exe" "%1"'
        )
    })
    it('returns null when no string value is present', () => {
        expect(parseRegQuery('    (Default)    REG_SZ    (value not set)\r\n')).toBeNull()
        expect(parseRegQuery('    Flags    REG_DWORD    0x1\r\n')).toBeNull()
        expect(parseRegQuery('')).toBeNull()
    })
})
