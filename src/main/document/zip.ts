import yauzl from 'yauzl'
import type { Readable } from 'node:stream'
import { DocumentError } from './errors'

const OPTIONS: yauzl.Options = {
    lazyEntries: true,
    // Reject names with "..", absolute paths, drive letters and backslashes (zip-slip, NFR-014).
    strictFileNames: true,
    decodeStrings: true,
    // Reject entries whose real size differs from the declared size, without imposing any size limit.
    validateEntrySizes: true
}

export function mapZipError(err: unknown): DocumentError {
    if (err instanceof DocumentError) return err
    const e = err as NodeJS.ErrnoException
    const message = e?.message ?? String(err)
    if (e?.code === 'ENOENT') return new DocumentError('NOT_FOUND', 'The file could not be found.')
    if (e?.code === 'EACCES' || e?.code === 'EPERM')
        return new DocumentError('ACCESS_DENIED', 'The file cannot be accessed.')
    if (/invalid relative path|absolute path|invalid characters in fileName/i.test(message))
        return new DocumentError('UNSAFE_ENTRY', 'The file contains an unsafe entry name.', [
            message
        ])
    if (/too (many|few) bytes|size mismatch|uncompressed size|compressed size/i.test(message))
        return new DocumentError(
            'INVALID_STRUCTURE',
            'The file is damaged: an entry has the wrong size.',
            [message]
        )
    return new DocumentError('NOT_AN_ARCHIVE', 'The file is not a valid BranchChat discussion.', [
        message
    ])
}

export type EntryAction = void | 'stop'

/**
 * Walks the entries of a ZIP one at a time. The file is opened for the duration of the scan only,
 * so it is never held open between operations.
 */
export function scanZip(
    path: string,
    handler: (entry: yauzl.Entry, zip: yauzl.ZipFile) => EntryAction | Promise<EntryAction>
): Promise<void> {
    return new Promise((resolve, reject) => {
        yauzl.open(path, OPTIONS, (openErr, zip) => {
            if (openErr || !zip) {
                reject(mapZipError(openErr))
                return
            }
            let settled = false
            const fail = (e: unknown): void => {
                if (settled) return
                settled = true
                zip.close()
                reject(mapZipError(e))
            }
            zip.on('error', fail)
            zip.on('end', () => {
                if (!settled) {
                    settled = true
                    resolve()
                }
            })
            zip.on('entry', (entry: yauzl.Entry) => {
                Promise.resolve(handler(entry, zip)).then((action) => {
                    if (settled) return
                    if (action === 'stop') {
                        settled = true
                        zip.close()
                        resolve()
                    } else {
                        zip.readEntry()
                    }
                }, fail)
            })
            zip.readEntry()
        })
    })
}

export function openEntry(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
    return new Promise((resolve, reject) => {
        zip.openReadStream(entry, (err, stream) => (err || !stream ? reject(err) : resolve(stream)))
    })
}

export async function collect(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    return Buffer.concat(chunks)
}

/** Reads one entry fully; resolves to null if the entry does not exist. */
export async function readEntryBuffer(path: string, name: string): Promise<Buffer | null> {
    let result: Buffer | null = null
    await scanZip(path, async (entry, zip) => {
        if (entry.fileName !== name) return
        result = await collect(await openEntry(zip, entry))
        return 'stop'
    })
    return result
}
