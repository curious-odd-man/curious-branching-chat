import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { BackupView } from '@shared/types/ipc'
import { localDayKey } from '@shared/domain'
import { BLOB_DIR, LIBRARY_FILE, type Library } from './library'
import { schemaVersionOf } from './schema'
import { blobHashesOf, toRollbackJournal } from './db'

/** Backups kept in each place (FR-207). */
export const BACKUPS_KEPT = 7
export const APP_BACKUP_DIR = 'backups'
/** The sub-folder in the folder that the person chose. */
export const FOLDER_BACKUP_DIR = 'BranchChat backups'
const RESTORE_FILE = 'restore.json'
const INFO_FILE = 'info.json'
const NAME = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(-\d+)?$/

export type BackupReason = 'daily' | 'manual' | 'migration' | 'restore'

interface BackupInfoFile {
    createdAt: string
    reason: BackupReason
    appVersion: string
    schemaVersion: number
    discussions: number
    messages: number
    /** The database file plus the images of the library at that time, in bytes. */
    size: number
}

export interface BackupDeps {
    /** %APPDATA%\BranchChat */
    appDir: string
    /** The folder the person chose in Settings, or null. */
    folder: () => string | null
    appVersion: string
    now?: () => Date
    log?: (message: string) => void
}

/**
 * FR-207: backups of the library (ADR-003, Q-02). A backup is a folder with a consistent copy of the database (SQLite
 * backup API, also while the app writes) and `info.json`; the image files are in a pool next to the backups and are
 * copied only once, because they never change. Each place keeps the last 7 backups. No encryption (FR-209); the private
 * keys are not in the library, so they are not in a backup.
 */
export class BackupService {
    private running: Promise<unknown> = Promise.resolve()

    constructor(
        private readonly lib: Library,
        private readonly deps: BackupDeps
    ) {}

    private now(): Date {
        return this.deps.now?.() ?? new Date()
    }

    /** The places: the app folder always, the folder of the person if set. */
    places(): Array<{ place: 'app' | 'folder'; root: string }> {
        const out: Array<{ place: 'app' | 'folder'; root: string }> = [
            { place: 'app', root: join(this.deps.appDir, APP_BACKUP_DIR) }
        ]
        const folder = this.deps.folder()
        if (folder) out.push({ place: 'folder', root: join(folder, FOLDER_BACKUP_DIR) })
        return out
    }

    /**
     * Makes a backup in every place. The app place must succeed (else this rejects); a failure in the folder of the
     * person is returned in `folderError` (for example a cloud folder that is not available).
     */
    make(reason: BackupReason): Promise<{ backups: BackupView[]; folderError: string | null }> {
        const next = this.running.then(
            () => this.doMake(reason),
            () => this.doMake(reason)
        )
        this.running = next.catch(() => undefined)
        return next
    }

    private async doMake(
        reason: BackupReason
    ): Promise<{ backups: BackupView[]; folderError: string | null }> {
        const [app, ...others] = this.places()
        const name = backupName(this.now())
        const first = await this.writeBackup(app!.root, name, reason, null)
        const backups: BackupView[] = [first]
        let folderError: string | null = null
        for (const other of others) {
            try {
                backups.push(
                    await this.writeBackup(
                        other.root,
                        name,
                        reason,
                        join(first.path, LIBRARY_FILE),
                        'folder'
                    )
                )
            } catch (err) {
                folderError = (err as Error).message
                this.deps.log?.(`backup into ${other.root} failed: ${folderError}`)
            }
        }
        this.lib.repo.setMeta('last_backup_day', localDayKey(this.now().toISOString()))
        this.lib.repo.setMeta('last_backup_at', this.now().toISOString())
        this.deps.log?.(`backup made (${reason}): ${name}`)
        return { backups, folderError }
    }

    private async writeBackup(
        root: string,
        name: string,
        reason: BackupReason,
        copyFrom: string | null,
        place: 'app' | 'folder' = 'app'
    ): Promise<BackupView> {
        await fs.mkdir(join(root, BLOB_DIR), { recursive: true })
        const temp = join(root, `.tmp-${randomUUID()}`)
        await fs.mkdir(temp)
        try {
            const dbFile = join(temp, LIBRARY_FILE)
            if (copyFrom) await fs.copyFile(copyFrom, dbFile)
            else {
                await this.lib.db.backupTo(dbFile)
                toRollbackJournal(dbFile)
            }
            // images: only the ones the pool does not have yet
            let imageBytes = 0
            for (const { sha256 } of await this.lib.blobs.list()) {
                const target = join(root, BLOB_DIR, sha256.slice(0, 2), sha256)
                const stat = await fs.stat(target).catch(() => null)
                const source = this.lib.blobs.pathOf(sha256)
                if (!stat) {
                    await fs.mkdir(join(root, BLOB_DIR, sha256.slice(0, 2)), { recursive: true })
                    const part = `${target}.${randomUUID()}.tmp`
                    await fs.copyFile(source, part)
                    await fs.rename(part, target)
                }
                imageBytes += (await fs.stat(target)).size
            }
            const counts = this.lib.db
                .prepare(
                    'SELECT (SELECT count(*) FROM discussion) AS d, (SELECT count(*) FROM message) AS m'
                )
                .get()!
            const info: BackupInfoFile = {
                createdAt: this.now().toISOString(),
                reason,
                appVersion: this.deps.appVersion,
                schemaVersion: schemaVersionOf(this.lib.db),
                discussions: Number(counts.d),
                messages: Number(counts.m),
                size: (await fs.stat(dbFile)).size + imageBytes
            }
            await fs.writeFile(join(temp, INFO_FILE), JSON.stringify(info, null, 2))
            let final = join(root, name)
            for (let n = 2; await exists(final); n++) final = join(root, `${name}-${n}`)
            await fs.rename(temp, final)
            await this.rotate(root)
            return { ...viewOf(final, info), place }
        } catch (err) {
            await fs.rm(temp, { recursive: true, force: true }).catch(() => undefined)
            throw err
        }
    }

    /** Keeps the newest 7 backups and the images they use; removes what a crashed backup left. */
    private async rotate(root: string): Promise<void> {
        const names = (await fs.readdir(root)).sort().reverse()
        for (const n of names)
            if (n.startsWith('.tmp-'))
                await fs.rm(join(root, n), { recursive: true, force: true }).catch(() => undefined)
        const backups = names.filter((n) => NAME.test(n))
        for (const old of backups.slice(BACKUPS_KEPT))
            await fs.rm(join(root, old), { recursive: true, force: true })
        const used = new Set<string>()
        for (const keep of backups.slice(0, BACKUPS_KEPT))
            for (const h of blobHashesOf(join(root, keep, LIBRARY_FILE))) used.add(h)
        const pool = join(root, BLOB_DIR)
        for (const sub of await fs.readdir(pool).catch(() => [] as string[]))
            for (const file of await fs.readdir(join(pool, sub)).catch(() => [] as string[]))
                if (!used.has(file) || file.endsWith('.tmp'))
                    await fs.rm(join(pool, sub, file), { force: true })
    }

    /** Every backup of both places, newest first. */
    async list(): Promise<BackupView[]> {
        const out: BackupView[] = []
        for (const { place, root } of this.places()) {
            for (const name of await fs.readdir(root).catch(() => [] as string[])) {
                if (!NAME.test(name)) continue
                const path = join(root, name)
                const info = await readInfo(path)
                if (info && (await exists(join(path, LIBRARY_FILE))))
                    out.push({ ...viewOf(path, info), place })
            }
        }
        return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    }

    /** FR-207: once a day (the first start of the day, or the next full hour while the app runs). */
    async dailyIfDue(): Promise<boolean> {
        if (this.lib.repo.getMeta('last_backup_day') === localDayKey(this.now().toISOString()))
            return false
        await this.make('daily')
        return true
    }

    lastBackupAt(): string | null {
        return this.lib.repo.getMeta('last_backup_at')
    }

    /**
     * "Восстановить из резервной копии…": the current library becomes a backup first; the restore itself happens at the
     * next start (the database is open now). `backupPath` must be one of `list()`.
     */
    async scheduleRestore(backupPath: string): Promise<void> {
        const known = await this.list()
        if (!known.some((b) => b.path === backupPath)) throw new Error('unknown backup')
        await this.make('restore')
        await fs.writeFile(
            join(this.deps.appDir, RESTORE_FILE),
            JSON.stringify({ backup: backupPath })
        )
    }
}

/** At start, before the library is opened: a restore that the person asked for. Returns true if one was done. */
export async function applyPendingRestore(
    appDir: string,
    log?: (message: string) => void
): Promise<boolean> {
    const marker = join(appDir, RESTORE_FILE)
    const raw = await fs.readFile(marker, 'utf8').catch(() => null)
    if (raw === null) return false
    await fs.rm(marker, { force: true })
    let backup: string
    try {
        backup = (JSON.parse(raw) as { backup: string }).backup
    } catch {
        return false
    }
    // the current library is in a backup already (scheduleRestore)
    for (const suffix of ['', '-wal', '-shm'])
        await fs.rm(join(appDir, LIBRARY_FILE + suffix), { force: true })
    await copyBackupInto(appDir, backup)
    log?.(`restored from ${backup}`)
    return true
}

/**
 * FR-208: a damaged library is renamed (never deleted), and the newest backup takes its place. Returns the backup used,
 * or null when there is none (then the app starts with an empty library).
 */
export async function replaceDamagedLibrary(
    appDir: string,
    backup: string | null,
    now: Date = new Date()
): Promise<string> {
    const stamp = backupName(now)
    const kept = join(appDir, `library.damaged-${stamp}.sqlite`)
    for (const suffix of ['', '-wal', '-shm'])
        await renameWithRetry(join(appDir, LIBRARY_FILE + suffix), kept + suffix)
    if (backup) await copyBackupInto(appDir, backup)
    return kept
}

/** The newest backup of a place that has a readable database (used when the library is damaged). */
export async function newestBackup(roots: readonly string[]): Promise<BackupView | null> {
    const all: BackupView[] = []
    for (const root of roots)
        for (const name of await fs.readdir(root).catch(() => [] as string[])) {
            if (!NAME.test(name)) continue
            const path = join(root, name)
            const info = await readInfo(path)
            if (info && (await exists(join(path, LIBRARY_FILE))))
                all.push({ ...viewOf(path, info), place: 'app' })
        }
    all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    return all[0] ?? null
}

async function copyBackupInto(appDir: string, backup: string): Promise<void> {
    await fs.copyFile(join(backup, LIBRARY_FILE), join(appDir, LIBRARY_FILE))
    const pool = join(backup, '..', BLOB_DIR)
    for (const h of blobHashesOf(join(appDir, LIBRARY_FILE))) {
        const target = join(appDir, BLOB_DIR, h.slice(0, 2), h)
        if (await exists(target)) continue
        await fs.mkdir(join(appDir, BLOB_DIR, h.slice(0, 2)), { recursive: true })
        await fs.copyFile(join(pool, h.slice(0, 2), h), target).catch(() => undefined)
    }
}

async function readInfo(dir: string): Promise<BackupInfoFile | null> {
    try {
        return JSON.parse(await fs.readFile(join(dir, INFO_FILE), 'utf8')) as BackupInfoFile
    } catch {
        return null
    }
}

function viewOf(path: string, info: BackupInfoFile): Omit<BackupView, 'place'> {
    return {
        path,
        createdAt: info.createdAt,
        reason: info.reason,
        size: info.size,
        discussions: info.discussions,
        messages: info.messages
    }
}

/** Local time, sortable: 2026-11-15_09-31-00. */
function backupName(d: Date): string {
    const p = (n: number): string => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

/** A missing file is fine (-wal, -shm); Windows can hold a closed file for a moment, so a lock is retried. */
async function renameWithRetry(from: string, to: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
        try {
            await fs.rename(from, to)
            return
        } catch (err) {
            const code = (err as NodeJS.ErrnoException).code
            if (code === 'ENOENT') return
            if ((code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES') || attempt >= 10)
                throw err
            await new Promise((r) => setTimeout(r, 100 * (attempt + 1)))
        }
    }
}

async function exists(path: string): Promise<boolean> {
    return fs
        .access(path)
        .then(() => true)
        .catch(() => false)
}
