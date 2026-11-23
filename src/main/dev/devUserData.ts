import { app } from 'electron'
import { join } from 'node:path'

/** The folder name of the development profile, next to the profile of the installed app. */
export const DEV_PROFILE_FOLDER = 'BranchChat-dev'

/**
 * The profile folder of a development run: `BRANCHCHAT_USER_DATA` if it is set, else `BranchChat-dev` in the
 * application data folder (on Windows `%APPDATA%\\BranchChat-dev`).
 */
export function devUserData(
    env: NodeJS.ProcessEnv = process.env,
    appData = app.getPath('appData')
): string {
    const own = env['BRANCHCHAT_USER_DATA']?.trim()
    return own ? own : join(appData, DEV_PROFILE_FOLDER)
}
