import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { guardConsoleStreams } from '../../src/main/windows/safeConsole'

/** A console stream whose reader has gone: each write fails with EPIPE, as a closed pipe on Windows does. */
function closedPipe(): Writable & { attempts: number } {
    const stream = new Writable({
        write(_chunk, _encoding, callback) {
            stream.attempts++
            callback(Object.assign(new Error('EPIPE: broken pipe, write'), { code: 'EPIPE' }))
        }
    }) as Writable & { attempts: number }
    stream.attempts = 0
    return stream
}

describe('console streams (a log line must not stop the app)', () => {
    it('without the guard, a write to a closed pipe is an uncaught error', async () => {
        const stream = closedPipe()
        const uncaught = new Promise<Error>((resolve) => stream.once('error', resolve))
        stream.write('line\n')
        expect((await uncaught).message).toContain('EPIPE')
    })

    it('with the guard, the error is absorbed and later writes do nothing', async () => {
        const stream = closedPipe()
        guardConsoleStreams([stream])
        stream.write('first\n')
        await new Promise((r) => setImmediate(r))
        expect(stream.attempts).toBe(1)
        expect(() => stream.write('second\n')).not.toThrow()
        expect(stream.attempts).toBe(1) // muted: nothing more goes to the closed pipe
    })
})
