import { randomUUID } from 'node:crypto'
import { constants, promises as fs } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { watch as chokidarWatch } from 'chokidar'
import {
    SHARED_FILE_NAME,
    canonicalJson,
    conversationMarkerSchema,
    SYNC_PROTOCOL_VERSION
} from '@shared/sync'

/**
 * The shared folder (D-18, sync-protocol.md section 3). The only transport in v1: any sync product that shows a
 * folder as a normal path. Every operation stays inside the shared root; no temporary file is ever created there
 * (D-39, section 3.4): files are written in a local staging folder and moved in when complete.
 */

export const MARKER_FILE = 'branchchat-sync.json'

/** A folder of the layout: an inbox, the keys folder, or the folder-test folder. */
export type SharedFolder =
    { kind: 'inbox'; participantId: string } | { kind: 'keys' } | { kind: 'test' }

export interface SharedEntry {
    folder: SharedFolder
    /** File name as it is in the folder (may be a conflict copy such as "<id> (1).bcmsg"). */
    name: string
    /** The ID part of the name. */
    id: string
    extension: 'bcmsg' | 'bcpart' | 'bcrcpt' | 'bcinv' | 'bckey'
    size: number
    mtimeMs: number
}

/** File operations, replaceable in tests (e.g. to simulate a move across drives or a failing delete). */
export interface FileOps {
    rename(from: string, to: string): Promise<void>
    copyFile(from: string, to: string): Promise<void>
}

const defaultOps: FileOps = {
    rename: (a, b) => fs.rename(a, b),
    copyFile: (a, b) => fs.copyFile(a, b)
}

const PARTICIPANT_ID = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/

export class TransportError extends Error {
    constructor(
        readonly code:
            'OUTSIDE_ROOT' | 'BAD_NAME' | 'NOT_A_FILE' | 'TOO_LARGE' | 'ROOT_MISSING' | 'LINK',
        message: string
    ) {
        super(message)
        this.name = 'TransportError'
    }
}

export type FolderTestResult =
    { ok: true } | { ok: false; step: 'root' | 'write' | 'read' | 'delete'; code: string }

export class FolderTransport {
    readonly root: string

    constructor(
        root: string,
        /** Local folder for files that are being written (never inside the shared root). */
        readonly staging: string,
        private readonly ops: FileOps = defaultOps
    ) {
        this.root = resolve(root)
        const rel = relative(this.root, resolve(staging))
        if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)))
            throw new TransportError(
                'OUTSIDE_ROOT',
                'the staging folder must not be inside the shared folder'
            )
    }

    folderPath(folder: SharedFolder): string {
        switch (folder.kind) {
            case 'inbox':
                if (
                    !PARTICIPANT_ID.test(folder.participantId) ||
                    folder.participantId.includes('..')
                )
                    throw new TransportError('BAD_NAME', 'invalid participant folder')
                return this.inside(join('inbox', folder.participantId))
            case 'keys':
                return this.inside('keys')
            case 'test':
                return this.inside('.test')
        }
    }

    /** Resolves a path below the root and refuses anything that leaves it. */
    private inside(rel: string): string {
        const full = resolve(this.root, rel)
        const back = relative(this.root, full)
        if (
            back === '' ||
            back.startsWith('..') ||
            isAbsolute(back) ||
            back.split(sep).includes('..')
        )
            throw new TransportError('OUTSIDE_ROOT', 'path leaves the shared folder')
        return full
    }

    private filePath(folder: SharedFolder, name: string): string {
        const testName = folder.kind === 'test' && /^[0-9a-f-]{36}\.bctest$/.test(name)
        if (!testName && !SHARED_FILE_NAME.test(name))
            throw new TransportError('BAD_NAME', 'not a protocol file name')
        return join(this.folderPath(folder), name)
    }

    /** Refuses a folder or file that is a link (it could point outside the shared root). */
    private async noLink(path: string): Promise<void> {
        const st = await fs.lstat(path)
        if (st.isSymbolicLink()) throw new TransportError('LINK', 'links are not followed')
    }

    async rootExists(): Promise<boolean> {
        try {
            return (await fs.stat(this.root)).isDirectory()
        } catch {
            return false
        }
    }

    /** Creates the marker (if missing) and the own inbox and key folders. */
    async ensureLayout(conversationId: string, ownId: string): Promise<void> {
        if (!(await this.rootExists()))
            throw new TransportError('ROOT_MISSING', 'shared folder is missing')
        await fs.mkdir(this.folderPath({ kind: 'inbox', participantId: ownId }), {
            recursive: true
        })
        await fs.mkdir(this.folderPath({ kind: 'keys' }), { recursive: true })
        const marker = join(this.root, MARKER_FILE)
        try {
            await fs.access(marker)
        } catch {
            const text = canonicalJson({
                format: 'branchchat-sync',
                protocolVersion: SYNC_PROTOCOL_VERSION,
                conversationId
            })
            await this.publishTo(marker, new TextEncoder().encode(text))
        }
    }

    /** The conversation marker, or null if it is missing or not valid. */
    async readMarker(): Promise<{ conversationId: string; protocolVersion: number } | null> {
        try {
            const marker = join(this.root, MARKER_FILE)
            await this.noLink(marker)
            const parsed = conversationMarkerSchema.safeParse(
                JSON.parse(await fs.readFile(marker, 'utf8'))
            )
            return parsed.success ? parsed.data : null
        } catch {
            return null
        }
    }

    /** Protocol files in a folder. Other names (temporary files, foreign files) are ignored (section 3). */
    async list(folder: SharedFolder): Promise<SharedEntry[]> {
        const dir = this.folderPath(folder)
        let names: string[]
        try {
            await this.noLink(dir)
            names = await fs.readdir(dir)
        } catch (err) {
            if (err instanceof TransportError) throw err
            return []
        }
        const out: SharedEntry[] = []
        for (const name of names) {
            const m = SHARED_FILE_NAME.exec(name)
            if (!m) continue
            try {
                const st = await fs.lstat(join(dir, name))
                if (!st.isFile()) continue
                out.push({
                    folder,
                    name,
                    id: m[1]!,
                    extension: m[2] as SharedEntry['extension'],
                    size: st.size,
                    mtimeMs: st.mtimeMs
                })
            } catch {
                // deleted or still being written by the sync product: the next scan sees it
            }
        }
        return out
    }

    /** Reads a file; refuses a file larger than `maxBytes` before reading it (section 9.5). */
    async read(folder: SharedFolder, name: string, maxBytes: number): Promise<Uint8Array> {
        const path = this.filePath(folder, name)
        const st = await fs.lstat(path)
        if (st.isSymbolicLink()) throw new TransportError('LINK', 'links are not followed')
        if (!st.isFile()) throw new TransportError('NOT_A_FILE', 'not a file')
        if (st.size > maxBytes)
            throw new TransportError('TOO_LARGE', 'file is larger than the limit')
        const handle = await fs.open(path, constants.O_RDONLY)
        try {
            const buf = Buffer.alloc(Math.min(st.size, maxBytes) + 1)
            let total = 0
            for (;;) {
                const { bytesRead } = await handle.read(buf, total, buf.length - total, total)
                if (bytesRead === 0) break
                total += bytesRead
                if (total > maxBytes)
                    throw new TransportError('TOO_LARGE', 'file grew larger than the limit')
            }
            return new Uint8Array(buf.subarray(0, total))
        } finally {
            await handle.close()
        }
    }

    /**
     * Writes a file under its final name (section 3.4): write and fsync in the staging folder, then move it in.
     * On the same volume the move is a rename; across volumes it is copy, fsync, delete.
     */
    async publish(folder: SharedFolder, name: string, data: Uint8Array): Promise<void> {
        const dir = this.folderPath(folder)
        await fs.mkdir(dir, { recursive: true })
        await this.noLink(dir)
        await this.publishTo(this.filePath(folder, name), data)
    }

    private async publishTo(target: string, data: Uint8Array): Promise<void> {
        await fs.mkdir(this.staging, { recursive: true })
        const staged = join(this.staging, `${randomUUID()}.staging`)
        const handle = await fs.open(staged, 'w')
        try {
            await handle.writeFile(data)
            await handle.sync()
        } finally {
            await handle.close()
        }
        try {
            try {
                await this.ops.rename(staged, target)
                return
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
            }
            // another drive: copy to the final name (a reader may see it grow, section 9.6), flush, then delete
            await this.ops.copyFile(staged, target)
            const copy = await fs.open(target, 'r+')
            try {
                await copy.sync()
            } finally {
                await copy.close()
            }
        } finally {
            await fs.rm(staged, { force: true })
        }
    }

    /** Deletes a file. "failed" means the sync product or the permissions refused (D-19 fallback). */
    async delete(folder: SharedFolder, name: string): Promise<'deleted' | 'missing' | 'failed'> {
        const path = this.filePath(folder, name)
        try {
            await this.noLink(path)
            await fs.unlink(path)
            return 'deleted'
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
            return 'failed'
        }
    }

    /** Removes files left in the staging folder by an interrupted write (section 3.4, step 5). */
    async cleanStaging(): Promise<void> {
        await fs.rm(this.staging, { recursive: true, force: true })
        await fs.mkdir(this.staging, { recursive: true })
    }

    /** Write, read, and delete a test file through the staging folder (design 12.3, step 5). */
    async folderTest(): Promise<FolderTestResult> {
        if (!(await this.rootExists())) return { ok: false, step: 'root', code: 'ROOT_MISSING' }
        const name = `${randomUUID()}.bctest`
        const data = new TextEncoder().encode(`branchchat folder test ${name}`)
        const folder: SharedFolder = { kind: 'test' }
        try {
            await this.publish(folder, name, data)
        } catch (err) {
            return {
                ok: false,
                step: 'write',
                code: (err as NodeJS.ErrnoException).code ?? 'WRITE_FAILED'
            }
        }
        try {
            const back = await fs.readFile(this.filePath(folder, name))
            if (!Buffer.from(back).equals(Buffer.from(data)))
                return { ok: false, step: 'read', code: 'MISMATCH' }
        } catch (err) {
            return {
                ok: false,
                step: 'read',
                code: (err as NodeJS.ErrnoException).code ?? 'READ_FAILED'
            }
        }
        const deleted = await this.delete(folder, name)
        if (deleted !== 'deleted') return { ok: false, step: 'delete', code: 'DELETE_FAILED' }
        return { ok: true }
    }

    /**
     * Fast notice of changes in the own inbox (an optimization only; scans are the source of truth, design 17).
     * Returns a function that stops watching.
     */
    watchInbox(
        ownId: string,
        onChange: () => void,
        onError: (err: unknown) => void
    ): () => Promise<void> {
        const watcher = chokidarWatch(this.folderPath({ kind: 'inbox', participantId: ownId }), {
            ignoreInitial: true,
            depth: 0,
            followSymlinks: false,
            awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 }
        })
        watcher.on('add', onChange)
        watcher.on('change', onChange)
        watcher.on('error', onError)
        return () => watcher.close()
    }
}

/** True if `path` is the shared root or inside it (FR-160: the local file must not be there). */
export function isInside(root: string, path: string): boolean {
    const rel = relative(resolve(root), resolve(path))
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}
