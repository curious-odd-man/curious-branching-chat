import type { Database } from './db'

/** Values of the library itself (table `meta`). */
export class MetaRows {
    constructor(private readonly db: Database) {}

    /** A value of the library itself (for example "the files of the earlier storage were offered for migration"). */
    getMeta(key: string): string | null {
        const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key)
        return row ? String(row.value) : null
    }

    setMeta(key: string, value: string): void {
        this.db
            .prepare(
                'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
            )
            .run(key, value)
    }
}
