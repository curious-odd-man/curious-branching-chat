import { DatabaseSync } from 'node:sqlite'

/**
 * The only module that imports `node:sqlite` (ADR-003): a change to another SQLite binding (for example
 * `better-sqlite3`) stays in this file. The API of `node:sqlite` is synchronous; the library keeps its transactions
 * small, so the main process is blocked only briefly.
 */

export type SqlValue = string | number | bigint | null | Uint8Array
export type Row = Record<string, SqlValue>

export interface Statement {
    run(...params: SqlValue[]): { changes: number | bigint }
    get(...params: SqlValue[]): Row | undefined
    all(...params: SqlValue[]): Row[]
}

export class Database {
    private readonly db: DatabaseSync
    private readonly statements = new Map<string, Statement>()
    private depth = 0

    constructor(readonly path: string) {
        this.db = new DatabaseSync(path)
        this.exec('PRAGMA journal_mode = WAL')
        this.exec('PRAGMA synchronous = NORMAL')
        this.exec('PRAGMA foreign_keys = ON')
        this.exec('PRAGMA trusted_schema = OFF')
        this.exec('PRAGMA busy_timeout = 5000')
    }

    exec(sql: string): void {
        this.db.exec(sql)
    }

    /** A prepared statement, kept for the life of the connection. */
    prepare(sql: string): Statement {
        let s = this.statements.get(sql)
        if (!s) {
            s = this.db.prepare(sql) as unknown as Statement
            this.statements.set(sql, s)
        }
        return s
    }

    /** Runs `work` in one transaction (nested calls join the outer one). A thrown error rolls everything back. */
    transaction<T>(work: () => T): T {
        if (this.depth > 0) return work()
        this.exec('BEGIN IMMEDIATE')
        this.depth++
        try {
            const result = work()
            this.exec('COMMIT')
            return result
        } catch (err) {
            this.exec('ROLLBACK')
            throw err
        } finally {
            this.depth--
        }
    }

    /** `PRAGMA quick_check`: "ok", or the problems found. */
    check(): string[] {
        return this.prepare('PRAGMA quick_check')
            .all()
            .map((r) => String(Object.values(r)[0]))
    }

    /** A consistent copy of the database (SQLite backup API), also while the app writes. */
    async backupTo(target: string): Promise<void> {
        const sqlite = (await import('node:sqlite')) as unknown as {
            backup(source: DatabaseSync, path: string): Promise<number>
        }
        await sqlite.backup(this.db, target)
    }

    close(): void {
        this.statements.clear()
        this.db.close()
    }
}

/** A backup file is a plain database file (no WAL), so it can be read and copied on its own. */
export function toRollbackJournal(file: string): void {
    const db = new DatabaseSync(file)
    try {
        db.exec('PRAGMA journal_mode = DELETE')
    } finally {
        db.close()
    }
}

/** The image hashes that a database file (a backup) refers to; empty if it cannot be read. */
export function blobHashesOf(file: string): string[] {
    try {
        const db = new DatabaseSync(file, { readOnly: true })
        try {
            return (db.prepare('SELECT sha256 FROM blob').all() as Array<{ sha256: string }>).map(
                (r) => r.sha256
            )
        } finally {
            db.close()
        }
    } catch {
        return []
    }
}
