import { promises as fs } from 'node:fs'
import { basename, dirname, extname } from 'node:path'
import type { RecentFileView } from '@shared/types/ipc'
import type { RecentEntry } from '../local-state/recentFiles'

/** Turns stored entries into what the windows show, checking which files still exist. */
export async function describeRecent(
  entries: readonly RecentEntry[],
  exists: (path: string) => Promise<boolean> = defaultExists
): Promise<RecentFileView[]> {
  return Promise.all(
    entries.map(async (e) => ({
      path: e.path,
      name: basename(e.path, extname(e.path)),
      directory: dirname(e.path),
      exists: await exists(e.path)
    }))
  )
}

async function defaultExists(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isFile()
  } catch {
    return false
  }
}
