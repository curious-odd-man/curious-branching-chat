import {CURRENT_SCHEMA_VERSION} from '@shared/validation'

/** Raw, not yet schema-validated document parts. */
export interface RawDocument {
  manifest: Record<string, unknown>
  discussion: unknown
  readState: unknown
}

/** migrations[n] upgrades a document from schema version n to n + 1. Version 1 is the first version. */
export const migrations: Record<number, (raw: RawDocument) => RawDocument> = {}

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
