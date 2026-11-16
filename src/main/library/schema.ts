import type { Database } from './db'

/**
 * The library schema (ADR-003 section 6). Migrations go forward only; each one runs in one transaction and raises
 * `meta.schema_version` by one. Release 2.4 adds reactions and attachments as migration 2.
 *
 * Data that the domain model keeps as JSON with unknown extra fields (zod `passthrough`) is stored as JSON, so a
 * discussion comes back exactly as it went in: the columns next to the JSON are for queries (list, order, search).
 */
const MIGRATIONS: ReadonlyArray<(db: Database) => void> = [
    (db) =>
        db.exec(`
            CREATE TABLE discussion (
                id               TEXT PRIMARY KEY,
                schema_version   INTEGER NOT NULL,
                revision         INTEGER NOT NULL DEFAULT 1,
                title            TEXT NOT NULL,
                created_at       TEXT NOT NULL,
                updated_at       TEXT NOT NULL,
                last_message_at  TEXT,
                message_count    INTEGER NOT NULL DEFAULT 0,
                synced           INTEGER NOT NULL DEFAULT 0,
                conversation_id  TEXT,
                manifest         TEXT NOT NULL,
                head             TEXT NOT NULL,
                sync             TEXT,
                mark_keys        TEXT NOT NULL,
                opened_at        TEXT
            ) STRICT;
            CREATE INDEX discussion_by_activity ON discussion (last_message_at DESC);

            CREATE TABLE participant (
                discussion_id  TEXT NOT NULL REFERENCES discussion (id) ON DELETE CASCADE,
                participant_id TEXT NOT NULL,
                ord            INTEGER NOT NULL,
                data           TEXT NOT NULL,
                PRIMARY KEY (discussion_id, participant_id)
            ) STRICT, WITHOUT ROWID;

            CREATE TABLE thread (
                discussion_id TEXT NOT NULL REFERENCES discussion (id) ON DELETE CASCADE,
                thread_id     TEXT NOT NULL,
                ord           INTEGER NOT NULL,
                data          TEXT NOT NULL,
                PRIMARY KEY (discussion_id, thread_id)
            ) STRICT, WITHOUT ROWID;

            CREATE TABLE message (
                rowid         INTEGER PRIMARY KEY,
                discussion_id TEXT NOT NULL REFERENCES discussion (id) ON DELETE CASCADE,
                message_id    TEXT NOT NULL,
                thread_id     TEXT NOT NULL,
                ord           INTEGER NOT NULL,
                created_at    TEXT NOT NULL,
                data          TEXT NOT NULL,
                UNIQUE (discussion_id, message_id)
            ) STRICT;
            CREATE INDEX message_by_thread ON message (discussion_id, thread_id, ord);

            CREATE TABLE blob (
                sha256     TEXT PRIMARY KEY,
                media_type TEXT NOT NULL,
                size       INTEGER NOT NULL
            ) STRICT, WITHOUT ROWID;

            CREATE TABLE asset (
                discussion_id TEXT NOT NULL REFERENCES discussion (id) ON DELETE CASCADE,
                asset_id      TEXT NOT NULL,
                ord           INTEGER NOT NULL,
                sha256        TEXT NOT NULL,
                data          TEXT NOT NULL,
                PRIMARY KEY (discussion_id, asset_id)
            ) STRICT, WITHOUT ROWID;
            CREATE INDEX asset_by_hash ON asset (sha256);

            -- kind 0: read marks (readstate.json), kind 1: delivery marks (delivery.json)
            CREATE TABLE mark (
                discussion_id  TEXT NOT NULL REFERENCES discussion (id) ON DELETE CASCADE,
                kind           INTEGER NOT NULL,
                participant_id TEXT NOT NULL,
                message_id     TEXT NOT NULL,
                ord            INTEGER NOT NULL,
                PRIMARY KEY (discussion_id, kind, participant_id, message_id)
            ) STRICT, WITHOUT ROWID;

            -- normalized text (lower case, ё → е); rowid = message.rowid
            CREATE VIRTUAL TABLE search_index USING fts5 (text, tokenize = 'unicode61 remove_diacritics 0');
        `),
    // release 2.3: the author of a message (unread counts in the list, FR-221) and drafts (FR-251 to FR-254)
    (db) =>
        db.exec(`
            ALTER TABLE message ADD COLUMN author_id TEXT NOT NULL DEFAULT '';
            UPDATE message SET author_id = COALESCE(json_extract(data, '$.authorId'), '');
            CREATE INDEX message_by_author ON message (discussion_id, author_id);

            CREATE TABLE draft (
                discussion_id TEXT NOT NULL REFERENCES discussion (id) ON DELETE CASCADE,
                thread_id     TEXT NOT NULL,
                content       TEXT NOT NULL,
                images        TEXT NOT NULL,
                updated_at    TEXT NOT NULL,
                PRIMARY KEY (discussion_id, thread_id)
            ) STRICT, WITHOUT ROWID;
        `)
]

export const LIBRARY_SCHEMA_VERSION = MIGRATIONS.length

export function schemaVersionOf(db: Database): number {
    db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT')
    const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()
    return row ? Number(row.value) : 0
}

/**
 * Brings the database to the current schema. `beforeMigration` runs before the first migration of an existing library
 * (the backup of phase 7). A library of a newer app version is refused, so an older app does not damage it.
 */
export async function migrate(
    db: Database,
    beforeMigration?: (from: number) => Promise<void>
): Promise<{ from: number; to: number }> {
    const from = schemaVersionOf(db)
    if (from > LIBRARY_SCHEMA_VERSION)
        throw new LibraryError(
            'NEWER_LIBRARY',
            `The library has schema version ${from}; this app knows version ${LIBRARY_SCHEMA_VERSION}.`
        )
    if (from > 0 && from < LIBRARY_SCHEMA_VERSION && beforeMigration) await beforeMigration(from)
    for (let v = from; v < LIBRARY_SCHEMA_VERSION; v++) {
        db.transaction(() => {
            MIGRATIONS[v]!(db)
            db.prepare(
                "INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value"
            ).run(String(v + 1))
        })
    }
    return { from, to: LIBRARY_SCHEMA_VERSION }
}

export type LibraryErrorCode =
    'NEWER_LIBRARY' | 'NOT_FOUND' | 'EXISTS' | 'SYNCED_IMPORT' | 'DAMAGED' | 'CONFLICT'

export class LibraryError extends Error {
    constructor(
        readonly code: LibraryErrorCode,
        message: string
    ) {
        super(message)
        this.name = 'LibraryError'
    }
}
