import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

const HASH = /^[0-9a-f]{64}$/

/**
 * ADR-003 (Q-05): images (later also attachments) as files named by their SHA-256, in `blobs\<2 hex>\<sha256>`. A
 * file never changes. It is written to a temporary name, checked, then renamed; the database row comes after the file,
 * so a crash leaves at most an unused file, never a row without its file.
 */
export class BlobStore {
    constructor(readonly dir: string) {}

    pathOf(sha256: string): string {
        if (!HASH.test(sha256)) throw new Error('not a SHA-256 hash')
        return join(this.dir, sha256.slice(0, 2), sha256)
    }

    async has(sha256: string): Promise<boolean> {
        return fs
            .access(this.pathOf(sha256))
            .then(() => true)
            .catch(() => false)
    }

    /** Stores the bytes; refuses data that does not match the hash. Does nothing if the file exists. */
    async put(sha256: string, data: Uint8Array): Promise<void> {
        if (createHash('sha256').update(data).digest('hex') !== sha256)
            throw new Error('the data does not match its hash')
        const target = this.pathOf(sha256)
        if (await this.has(sha256)) return
        await fs.mkdir(join(this.dir, sha256.slice(0, 2)), { recursive: true })
        const tmp = `${target}.${randomUUID()}.tmp`
        try {
            const handle = await fs.open(tmp, 'w')
            try {
                await handle.writeFile(data)
                await handle.sync()
            } finally {
                await handle.close()
            }
            await renameWithRetry(tmp, target)
        } catch (err) {
            await fs.rm(tmp, { force: true }).catch(() => undefined)
            // another write of the same content won the race: that is fine
            if (await this.has(sha256)) return
            throw err
        }
    }

    /** The bytes, checked against the hash; null if the file is missing or damaged (show a placeholder). */
    async read(sha256: string): Promise<Buffer | null> {
        const data = await fs.readFile(this.pathOf(sha256)).catch(() => null)
        if (!data) return null
        return createHash('sha256').update(data).digest('hex') === sha256 ? data : null
    }

    /** Every stored hash, with the age of its file (for the cleanup of unused files, ADR-003 Q-07). */
    async list(): Promise<Array<{ sha256: string; modifiedMs: number }>> {
        const out: Array<{ sha256: string; modifiedMs: number }> = []
        for (const sub of await fs.readdir(this.dir).catch(() => [] as string[])) {
            if (!/^[0-9a-f]{2}$/.test(sub)) continue
            for (const name of await fs.readdir(join(this.dir, sub)).catch(() => [] as string[])) {
                if (!HASH.test(name)) continue
                const stat = await fs.stat(join(this.dir, sub, name)).catch(() => null)
                if (stat) out.push({ sha256: name, modifiedMs: stat.mtimeMs })
            }
        }
        return out
    }

    async remove(sha256: string): Promise<void> {
        await fs.rm(this.pathOf(sha256), { force: true })
    }
}

/** Windows: antivirus or the indexer can hold a new file for a moment. */
async function renameWithRetry(from: string, to: string): Promise<void> {
    const delays = [0, 50, 100, 200, 400, 800]
    let last: unknown
    for (const delay of delays) {
        if (delay > 0) await new Promise((r) => setTimeout(r, delay))
        try {
            await fs.rename(from, to)
            return
        } catch (err) {
            last = err
            const code = (err as NodeJS.ErrnoException).code
            if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') throw err
        }
    }
    throw last
}
