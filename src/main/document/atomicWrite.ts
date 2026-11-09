import { promises as fs } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { DocumentError } from './errors'

export interface AtomicWriteOptions {
    /** Injectable for tests. */
    rename?: (from: string, to: string) => Promise<void>
    sleep?: (ms: number) => Promise<void>
    /** Delays between rename attempts; Windows antivirus/sync tools can briefly lock files. */
    retryDelaysMs?: number[]
}

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES'])

/**
 * Writes a file safely: `producer` writes a temporary file next to the target, which then replaces the target.
 * If anything fails, the original file is left untouched and the temporary file is removed (FR-013).
 */
export async function writeFileAtomically(
    targetPath: string,
    producer: (tempPath: string) => Promise<void>,
    options: AtomicWriteOptions = {}
): Promise<void> {
    const rename = options.rename ?? fs.rename
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
    const delays = options.retryDelaysMs ?? [25, 50, 100, 200, 400, 800]
    const tempPath = join(
        dirname(targetPath),
        `${basename(targetPath)}.${randomBytes(6).toString('hex')}.tmp`
    )

    try {
        await producer(tempPath)
        const handle = await fs.open(tempPath, 'r+')
        try {
            await handle.sync()
        } finally {
            await handle.close()
        }
        for (let attempt = 0; ; attempt++) {
            try {
                await rename(tempPath, targetPath)
                return
            } catch (err) {
                const code = (err as NodeJS.ErrnoException).code
                const delay = delays[attempt]
                if (code === undefined || !RETRYABLE.has(code) || delay === undefined) throw err
                await sleep(delay)
            }
        }
    } catch (err) {
        await fs.rm(tempPath, { force: true }).catch(() => undefined)
        if (err instanceof DocumentError) throw err
        const code = (err as NodeJS.ErrnoException).code
        throw new DocumentError(
            code === 'EACCES' || code === 'EPERM' ? 'ACCESS_DENIED' : 'WRITE_FAILED',
            `Could not save the discussion: ${(err as Error).message}`
        )
    }
}
