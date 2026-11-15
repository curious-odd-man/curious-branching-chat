import { DISCUSSION_EXTENSION } from '@shared/types/constants'

export { DISCUSSION_EXTENSION }

/**
 * Extracts discussion file paths from a process command line (first launch, or the `second-instance` event).
 * Windows passes the double-clicked file as a plain argument. Flags (--something) and the executable are ignored.
 * Validation that the file exists and is readable happens when it is opened (FR-118).
 */
export function extractDiscussionPaths(argv: readonly string[]): string[] {
    const paths: string[] = []
    for (const raw of argv) {
        const arg = raw.trim().replace(/^"(.*)"$/, '$1')
        if (arg.startsWith('--') || arg.length === 0) continue
        if (arg.toLowerCase().endsWith(DISCUSSION_EXTENSION) && !paths.includes(arg))
            paths.push(arg)
    }
    return paths
}

/** Jump list entries start the app with `--discussion=<id>` (a discussion of the library). */
export const DISCUSSION_ARG = '--discussion='

export function extractDiscussionIds(argv: readonly string[]): string[] {
    const ids: string[] = []
    for (const raw of argv) {
        const arg = raw.trim().replace(/^"(.*)"$/, '$1')
        if (!arg.startsWith(DISCUSSION_ARG)) continue
        const id = arg.slice(DISCUSSION_ARG.length)
        if (/^[A-Za-z0-9-]{1,200}$/.test(id) && !ids.includes(id)) ids.push(id)
    }
    return ids
}
