/**
 * Canonical JSON (sync-protocol.md section 2.2): sorted keys, no white space, whole numbers only.
 * Used for everything that is signed. Refuses values that break the rules instead of changing them.
 */

export class CanonicalJsonError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'CanonicalJsonError'
    }
}

function write(value: unknown, path: string, out: string[]): void {
    if (value === null) {
        out.push('null')
        return
    }
    switch (typeof value) {
        case 'boolean':
            out.push(value ? 'true' : 'false')
            return
        case 'string':
            out.push(JSON.stringify(value))
            return
        case 'number':
            if (!Number.isSafeInteger(value) || value < 0)
                throw new CanonicalJsonError(`${path}: only whole numbers from 0 to 2^53-1`)
            out.push(String(value))
            return
        case 'object': {
            if (Array.isArray(value)) {
                out.push('[')
                value.forEach((item, i) => {
                    if (i > 0) out.push(',')
                    if (item === undefined)
                        throw new CanonicalJsonError(`${path}[${i}]: undefined is not allowed`)
                    write(item, `${path}[${i}]`, out)
                })
                out.push(']')
                return
            }
            const proto = Object.getPrototypeOf(value) as unknown
            if (proto !== Object.prototype && proto !== null)
                throw new CanonicalJsonError(`${path}: only plain objects are allowed`)
            const record = value as Record<string, unknown>
            const keys = Object.keys(record).sort()
            out.push('{')
            keys.forEach((key, i) => {
                const item = record[key]
                if (item === undefined)
                    throw new CanonicalJsonError(`${path}.${key}: undefined is not allowed`)
                if (i > 0) out.push(',')
                out.push(JSON.stringify(key), ':')
                write(item, `${path}.${key}`, out)
            })
            out.push('}')
            return
        }
        default:
            throw new CanonicalJsonError(`${path}: ${typeof value} is not allowed`)
    }
}

export function canonicalJson(value: unknown): string {
    const out: string[] = []
    write(value, '$', out)
    return out.join('')
}

export function canonicalJsonBytes(value: unknown): Uint8Array {
    return new TextEncoder().encode(canonicalJson(value))
}

/** True if the text is exactly the canonical form of what it parses to. */
export function isCanonicalJson(text: string): boolean {
    try {
        return canonicalJson(JSON.parse(text)) === text
    } catch {
        return false
    }
}
