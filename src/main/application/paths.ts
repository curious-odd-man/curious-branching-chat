import {resolve, win32} from 'node:path'

/**
 * A key that identifies a file for "is this already open?" checks. Windows paths are case-insensitive and may use
 * either slash, so they are compared lower-cased with normalized separators.
 */
export function pathKey(path: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return win32.resolve(path).toLowerCase()
  return resolve(path)
}
