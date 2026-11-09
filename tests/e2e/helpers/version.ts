import { readFileSync } from 'node:fs'

/** The version of the application under test, read from package.json so tests keep working when it is bumped. */
export const CURRENT_VERSION: string = (
    JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }
).version
const major = Number(CURRENT_VERSION.split('.')[0])
/** A release that is newer than the application under test. */
export const NEWER_VERSION = `${major + 1}.0.0`
/** A release that is older than the application under test. */
export const OLDER_VERSION = '0.0.1'
