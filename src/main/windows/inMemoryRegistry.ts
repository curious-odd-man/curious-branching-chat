import type { Registry } from './fileAssociation'

/** A registry kept in memory. Used by unit tests and by end-to-end test builds, never touching the real registry. */
export class InMemoryRegistry implements Registry {
    /** key (lower-case) -> value name ('' = default) -> value */
    private readonly keys = new Map<string, Map<string, string>>()
    /** Original spelling of each key, for inspection. */
    private readonly spelling = new Map<string, string>()

    constructor(seed: Record<string, Record<string, string>> = {}) {
        for (const [key, values] of Object.entries(seed))
            for (const [name, value] of Object.entries(values))
                void this.set(key, name || undefined, value)
    }

    get(key: string, name?: string): Promise<string | null> {
        return Promise.resolve(
            this.keys.get(key.toLowerCase())?.get((name ?? '').toLowerCase()) ?? null
        )
    }

    set(key: string, name: string | undefined, value: string): Promise<void> {
        const k = key.toLowerCase()
        let values = this.keys.get(k)
        if (!values) {
            values = new Map()
            this.keys.set(k, values)
            this.spelling.set(k, key)
        }
        values.set((name ?? '').toLowerCase(), value)
        return Promise.resolve()
    }

    deleteTree(key: string): Promise<void> {
        const k = key.toLowerCase()
        for (const existing of [...this.keys.keys()]) {
            if (existing === k || existing.startsWith(`${k}\\`)) {
                this.keys.delete(existing)
                this.spelling.delete(existing)
            }
        }
        return Promise.resolve()
    }

    /** Everything stored, for assertions: key -> name -> value. */
    dump(): Record<string, Record<string, string>> {
        const out: Record<string, Record<string, string>> = {}
        for (const [k, values] of this.keys)
            out[this.spelling.get(k) ?? k] = Object.fromEntries(values)
        return out
    }
}
