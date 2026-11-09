import { createWriteStream, promises as fs } from 'node:fs'
import yazl from 'yazl'
import type { ZodType } from 'zod'
import {
    CURRENT_SCHEMA_VERSION,
    FORMAT_NAME,
    checkDiscussionIntegrity,
    discussionSchema,
    manifestSchema,
    readStateSchema,
    type DocumentContents,
    type AssetInfo
} from '@shared/validation'
import { verifyImageAsset, type PreparedImage } from './assets'
import { DocumentError } from './errors'
import { migrateToCurrent, type RawDocument } from './migrations'
import { writeFileAtomically } from './atomicWrite'
import { collect, openEntry, readEntryBuffer, scanZip } from './zip'

export const MANIFEST_ENTRY = 'manifest.json'
export const DISCUSSION_ENTRY = 'discussion.json'
export const READSTATE_ENTRY = 'readstate.json'
const MANAGED_ENTRIES = new Set([MANIFEST_ENTRY, DISCUSSION_ENTRY, READSTATE_ENTRY])

export interface LoadedDocument {
    contents: DocumentContents
    /** Every file entry present in the ZIP. */
    entryNames: string[]
    /** Assets listed in the discussion whose data is missing from the file (shown as placeholders, FR-075). */
    missingAssetIds: string[]
}

function parseJson(buffer: Buffer, entry: string): unknown {
    try {
        return JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, ''))
    } catch (err) {
        throw new DocumentError('INVALID_JSON', `${entry} is not valid JSON.`, [
            (err as Error).message
        ])
    }
}

function parseWith<T>(schema: ZodType<T>, value: unknown, entry: string): T {
    const result = schema.safeParse(value)
    if (result.success) return result.data
    throw new DocumentError(
        'INVALID_SCHEMA',
        `${entry} does not match the BranchChat format.`,
        result.error.issues.slice(0, 8).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    )
}

/** Opens and fully validates a discussion file. Never modifies it. */
export async function readDocument(path: string): Promise<LoadedDocument> {
    const buffers = new Map<string, Buffer>()
    const entryNames: string[] = []
    const seen = new Set<string>()

    await scanZip(path, async (entry, zip) => {
        const name = entry.fileName
        if (name.endsWith('/')) return
        if (seen.has(name))
            throw new DocumentError('DUPLICATE_ENTRY', `The file contains "${name}" twice.`)
        seen.add(name)
        entryNames.push(name)
        if (MANAGED_ENTRIES.has(name)) buffers.set(name, await collect(await openEntry(zip, entry)))
    })

    const manifestBuf = buffers.get(MANIFEST_ENTRY)
    const discussionBuf = buffers.get(DISCUSSION_ENTRY)
    if (!manifestBuf) throw new DocumentError('MISSING_ENTRY', 'manifest.json is missing.')
    if (!discussionBuf) throw new DocumentError('MISSING_ENTRY', 'discussion.json is missing.')

    const rawManifest = parseJson(manifestBuf, MANIFEST_ENTRY)
    if (typeof rawManifest !== 'object' || rawManifest === null || Array.isArray(rawManifest))
        throw new DocumentError(
            'INVALID_SCHEMA',
            'manifest.json does not match the BranchChat format.'
        )
    const manifestObj = rawManifest as Record<string, unknown>
    if (manifestObj.format !== FORMAT_NAME)
        throw new DocumentError('INVALID_SCHEMA', 'This file is not a BranchChat discussion.')
    const version = manifestObj.schemaVersion
    if (typeof version === 'number' && version > CURRENT_SCHEMA_VERSION)
        throw new DocumentError(
            'UNSUPPORTED_VERSION',
            'This discussion was created by a newer version of BranchChat. Please update the application.',
            [`file schema version ${version}, supported ${CURRENT_SCHEMA_VERSION}`]
        )
    const fromVersion = parseWith(manifestSchema, manifestObj, MANIFEST_ENTRY).schemaVersion

    const readStateBuf = buffers.get(READSTATE_ENTRY)
    const migrated: RawDocument = migrateToCurrent(
        {
            manifest: manifestObj,
            discussion: parseJson(discussionBuf, DISCUSSION_ENTRY),
            readState: readStateBuf ? parseJson(readStateBuf, READSTATE_ENTRY) : {}
        },
        fromVersion
    )

    const manifest = parseWith(manifestSchema, migrated.manifest, MANIFEST_ENTRY)
    const discussion = parseWith(discussionSchema, migrated.discussion, DISCUSSION_ENTRY)
    const readState = parseWith(readStateSchema, migrated.readState, READSTATE_ENTRY)

    const problems = checkDiscussionIntegrity(discussion)
    if (problems.length > 0)
        throw new DocumentError(
            'INVALID_STRUCTURE',
            'The discussion data is inconsistent.',
            problems.slice(0, 8)
        )

    const missingAssetIds = discussion.assets.filter((a) => !seen.has(a.path)).map((a) => a.assetId)
    return { contents: { manifest, discussion, readState }, entryNames, missingAssetIds }
}

/** Reads and verifies an embedded image. Returns null if the entry is missing (use a placeholder). */
export async function readImageAsset(path: string, asset: AssetInfo): Promise<Buffer | null> {
    const data = await readEntryBuffer(path, asset.path)
    if (!data) return null
    verifyImageAsset(data, asset)
    return data
}

export interface WriteOptions {
    /** Images to add to the file. Existing entries with the same path are replaced. */
    newAssets?: PreparedImage[]
    /** Ignore whatever is currently at the target path (used when creating a new file). */
    discardExisting?: boolean
}

function validateBeforeWrite(contents: DocumentContents): void {
    parseWith(manifestSchema, contents.manifest, MANIFEST_ENTRY)
    parseWith(discussionSchema, contents.discussion, DISCUSSION_ENTRY)
    parseWith(readStateSchema, contents.readState, READSTATE_ENTRY)
    const problems = checkDiscussionIntegrity(contents.discussion)
    if (problems.length > 0)
        throw new DocumentError(
            'INVALID_STRUCTURE',
            'Refusing to save inconsistent discussion data.',
            problems.slice(0, 8)
        )
    if (contents.manifest.schemaVersion !== CURRENT_SCHEMA_VERSION)
        throw new DocumentError(
            'UNSUPPORTED_VERSION',
            'Refusing to save a document with another schema version.'
        )
}

async function exists(path: string): Promise<boolean> {
    try {
        await fs.access(path)
        return true
    } catch {
        return false
    }
}

/**
 * Saves a discussion (FR-007, FR-013). Writes a temporary file next to the target and atomically replaces it.
 * Entries this application does not manage (images, unknown future entries) are copied through unchanged;
 * images are stored without compression, so nothing is recompressed when only the JSON changes.
 */
export async function writeDocument(
    targetPath: string,
    contents: DocumentContents,
    options: WriteOptions = {}
): Promise<void> {
    validateBeforeWrite(contents)
    const newAssets = [...new Map((options.newAssets ?? []).map((a) => [a.path, a])).values()]
    const copyExisting = !options.discardExisting && (await exists(targetPath))

    await writeFileAtomically(targetPath, async (tempPath) => {
        const zip = new yazl.ZipFile()
        const out = createWriteStream(tempPath)
        const finished = new Promise<void>((resolve, reject) => {
            out.on('close', resolve)
            out.on('error', reject)
            zip.outputStream.on('error', reject)
            ;(zip as unknown as NodeJS.EventEmitter).on('error', reject)
        })
        finished.catch(() => undefined)
        zip.outputStream.pipe(out)

        const mtime = new Date()
        const json = (value: unknown): Buffer => Buffer.from(JSON.stringify(value), 'utf8')
        zip.addBuffer(json(contents.manifest), MANIFEST_ENTRY, { mtime, compress: true })
        zip.addBuffer(json(contents.discussion), DISCUSSION_ENTRY, { mtime, compress: true })
        zip.addBuffer(json(contents.readState), READSTATE_ENTRY, { mtime, compress: true })
        for (const asset of newAssets)
            zip.addBuffer(asset.data, asset.path, { mtime, compress: false })

        if (copyExisting) {
            const skip = new Set<string>([...MANAGED_ENTRIES, ...newAssets.map((a) => a.path)])
            await scanZip(targetPath, async (entry, zf) => {
                const name = entry.fileName
                if (name.endsWith('/') || skip.has(name)) return
                skip.add(name)
                const stream = await openEntry(zf, entry)
                zip.addReadStream(stream, name, {
                    mtime: entry.getLastModDate(),
                    compress: !name.startsWith('assets/'),
                    size: entry.uncompressedSize
                })
            })
        }
        zip.end()
        await finished
    })
}

export { DocumentError }
