import { CURRENT_SCHEMA_VERSION } from '@shared/validation'

/** Raw, not yet schema-validated document parts. */
export interface RawDocument {
    manifest: Record<string, unknown>
    discussion: unknown
    readState: unknown
    /** Raw `sync.json` (schema version 2 and later). */
    sync?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Version 1 -> 2 (FR-151, FR-152): every thread and message gets a logical clock that keeps the current order.
 * One counter runs over the threads in file order (the order in which they were created) and, inside each thread,
 * over the messages in sequence order. The main thread gets clock 0. Status and title stamps stay absent ("never
 * changed"). The data is not validated yet, so anything unexpected is left as it is for the schema to refuse.
 */
export function migrate1to2(raw: RawDocument): RawDocument {
    if (!isRecord(raw.discussion) || !Array.isArray(raw.discussion.threads)) return raw
    let counter = 0
    const threads = raw.discussion.threads.map((thread: unknown) => {
        if (!isRecord(thread)) return thread
        const isMain = thread.parentThreadId === undefined
        const clock = isMain ? 0 : ++counter
        const messages = Array.isArray(thread.messages)
            ? [...thread.messages]
                  .map((m: unknown, index) => ({ m, index }))
                  .sort((a, b) => {
                      const sa =
                          isRecord(a.m) && typeof a.m.sequence === 'number' ? a.m.sequence : a.index
                      const sb =
                          isRecord(b.m) && typeof b.m.sequence === 'number' ? b.m.sequence : b.index
                      return sa - sb
                  })
                  .map(({ m }) => (isRecord(m) ? { ...m, clock: ++counter } : m))
            : thread.messages
        return { ...thread, clock, messages }
    })
    return { ...raw, discussion: { ...raw.discussion, threads } }
}

/** migrations[n] upgrades a document from schema version n to n + 1. Version 1 is the first version. */
export const migrations: Record<number, (raw: RawDocument) => RawDocument> = {
    1: migrate1to2
}

export function migrateToCurrent(raw: RawDocument, fromVersion: number): RawDocument {
    let current = raw
    for (let v = fromVersion; v < CURRENT_SCHEMA_VERSION; v++) {
        const step = migrations[v]
        if (!step) throw new Error(`No migration from schema version ${v}`)
        current = step(current)
        current.manifest = { ...current.manifest, schemaVersion: v + 1 }
    }
    return current
}
