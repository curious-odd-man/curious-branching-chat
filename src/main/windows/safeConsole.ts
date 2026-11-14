import type { Writable } from 'node:stream'

/** Errors of a console stream whose reader has gone (a closed pipe or terminal). */
const GONE = new Set([
    'EPIPE',
    'EOF',
    'ECONNRESET',
    'ERR_STREAM_DESTROYED',
    'ERR_STREAM_WRITE_AFTER_END'
])

/**
 * A log line must never stop the application. An installed Windows app normally has no console; if its output goes
 * to a pipe that closes (for example a PowerShell redirection that ended), every later write fails with EPIPE, and
 * Node reports that as an uncaught exception ("A JavaScript error occurred in the main process"), also for the
 * `console.info` calls of electron-updater. After the first such error the stream is muted.
 */
export function guardConsoleStreams(
    streams: readonly Writable[] = [process.stdout, process.stderr]
): void {
    for (const stream of streams) {
        stream.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code && !GONE.has(err.code)) return
            stream.write = (() => true) as Writable['write']
        })
    }
}
