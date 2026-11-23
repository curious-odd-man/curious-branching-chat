import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEV_PROFILE_FOLDER, devUserData } from '../../src/main/dev/devUserData'

describe('profile of a development run (2026-11-23)', () => {
    const appData = join('C:', 'Users', 'u', 'AppData', 'Roaming')

    it('is its own folder next to the profile of the installed app, never "BranchChat" itself', () => {
        const dir = devUserData({}, appData)
        expect(dir).toBe(join(appData, 'BranchChat-dev'))
        expect(DEV_PROFILE_FOLDER.toLowerCase()).not.toBe('branchchat')
    })

    it('BRANCHCHAT_USER_DATA gives another folder; an empty value is ignored', () => {
        expect(devUserData({ BRANCHCHAT_USER_DATA: 'D:\\bc-test' }, appData)).toBe('D:\\bc-test')
        expect(devUserData({ BRANCHCHAT_USER_DATA: '  ' }, appData)).toBe(
            join(appData, 'BranchChat-dev')
        )
    })
})
