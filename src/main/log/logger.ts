import { promises as fs } from 'node:fs'
import { join } from 'node:path'

export type LogLevel = 'info' | 'warn' | 'error'

/** Where an entry comes from. */
export type LogArea = 'app' | 'sync' | 'updates' | 'background' | 'window' | 'library'

export interface AreaLogger {
    info(message: string): void
    warn(message: string): void
    error(message: string, err?: unknown): void
}

export interface LoggerOptions {
    /** `%APPDATA%\BranchChat\logs` */
    dir: string
    /** Largest size of one file before rotation (FR-321: 2 MB). */
    maxBytes?: number
    /** Number of files kept, the current one included (FR-321: 5). */
    files?: number
    now?: () => Date
    /** Also write each line to the console (development runs). */
    mirror?: (line: string) => void
}

export const LOG_FILE = 'main.log'

/**
 * FR-322: what must never be in a log, removed in one place. Long runs of base64 or hex characters are removed: keys,
 * signatures, sealed data, and hashes (the log does not need them). Paths and participant IDs stay (FR-322, Q-09).
 */
export function redact(text: string): string {
    return text.replace(/[A-Za-z0-9+/_-]{40,}={0,2}/g, '[…]')
}

/** The text of an error for the log: the message and the stack, redacted. */
export function describe(err: unknown): string {
    if (err instanceof Error) return redact(err.stack ?? `${err.name}: ${err.message}`)
    return redact(String(err))
}

/**
 * FR-321 to FR-324: the log file of the main process. Lines are queued and written in order; a write error (a full
 * disk, a locked file) is dropped and never reaches the caller. The file is rotated at `maxBytes`: `main.log` →
 * `main.1.log` → … → `main.<files-1>.log` (the oldest is deleted).
 */
export class Logger {
    private readonly maxBytes: number
    private readonly files: number
    private readonly now: () => Date
    private chain: Promise<void> = Promise.resolve()
    private size: number | null = null
    private ready = false

    constructor(private readonly options: LoggerOptions) {
        this.maxBytes = options.maxBytes ?? 2 * 1024 * 1024
        this.files = Math.max(1, options.files ?? 5)
        this.now = options.now ?? (() => new Date())
    }

    get dir(): string {
        return this.options.dir
    }

    /** All log files, newest first (for the diagnostics report). */
    fileNames(): string[] {
        return [LOG_FILE, ...Array.from({ length: this.files - 1 }, (_, i) => `main.${i + 1}.log`)]
    }

    write(level: LogLevel, area: LogArea, message: string): void {
        const line = `${this.now().toISOString()} ${level.toUpperCase().padEnd(5)} [${area}] ${redact(message).replace(/\r?\n/g, '\n    ')}\n`
        try {
            this.options.mirror?.(line.trimEnd())
        } catch {
            // the console is not important (FR-324)
        }
        this.chain = this.chain.then(() => this.append(line)).catch(() => undefined)
    }

    area(area: LogArea): AreaLogger {
        return {
            info: (m) => this.write('info', area, m),
            warn: (m) => this.write('warn', area, m),
            error: (m, err) =>
                this.write('error', area, err === undefined ? m : `${m}: ${describe(err)}`)
        }
    }

    /** Waits until every queued line is written (for the report and for tests). */
    flush(): Promise<void> {
        return this.chain
    }

    private async append(line: string): Promise<void> {
        const file = join(this.options.dir, LOG_FILE)
        if (!this.ready) {
            await fs.mkdir(this.options.dir, { recursive: true })
            this.size = await fs
                .stat(file)
                .then((s) => s.size)
                .catch(() => 0)
            this.ready = true
        }
        const bytes = Buffer.byteLength(line, 'utf8')
        if ((this.size ?? 0) > 0 && (this.size ?? 0) + bytes > this.maxBytes) await this.rotate()
        await fs.appendFile(file, line, 'utf8')
        this.size = (this.size ?? 0) + bytes
    }

    private async rotate(): Promise<void> {
        const names = this.fileNames()
        const path = (name: string): string => join(this.options.dir, name)
        await fs.rm(path(names[names.length - 1]!), { force: true }).catch(() => undefined)
        for (let i = names.length - 2; i >= 0; i--)
            await fs.rename(path(names[i]!), path(names[i + 1]!)).catch(() => undefined)
        this.size = 0
    }
}
