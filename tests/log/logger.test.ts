import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Logger, redact } from '../../src/main/log/logger'
import { sanitizeSettings, sanitizeSyncState, writeReport } from '../../src/main/log/report'
import { collect, openEntry, scanZip } from '../../src/main/document/zip'
import { withTempDir } from '../helpers/fixtures'

const KEY = 'q3Jd8Z9kV0xY1/aB2+cD3eF4gH5iJ6kL7mN8oP9qR0s='
const SECRET_TEXT = 'Секретный текст сообщения'

describe('log file (FR-321, FR-322, FR-324)', () => {
    it('writes one line per entry with the time, level, and area', async () => {
        await withTempDir(async (dir) => {
            const log = new Logger({ dir, now: () => new Date('2026-11-15T10:00:00Z') })
            log.area('sync').info('scan done')
            log.area('updates').error('check failed', new Error('404'))
            await log.flush()
            const text = await fs.readFile(join(dir, 'main.log'), 'utf8')
            expect(text.split('\n')[0]).toBe('2026-11-15T10:00:00.000Z INFO  [sync] scan done')
            expect(text).toContain('ERROR [updates] check failed: Error: 404')
        })
    })

    it('removes long base64 and hex runs (keys, signatures, hashes); keeps paths and IDs', () => {
        const line = redact(
            `key ${KEY} in C:\\Users\\anna\\Планы.branchchat from p-anna-1 ${'a'.repeat(64)}`
        )
        expect(line).not.toContain(KEY)
        expect(line).not.toContain('a'.repeat(64))
        expect(line).toContain('C:\\Users\\anna\\Планы.branchchat')
        expect(line).toContain('p-anna-1')
        expect(redact('9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f')).toBe(
            '9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f'
        )
    })

    it('rotates at the size limit and keeps the number of files', async () => {
        await withTempDir(async (dir) => {
            const log = new Logger({ dir, maxBytes: 200, files: 3 })
            for (let i = 0; i < 40; i++) log.area('app').info(`line ${i} ${'x'.repeat(30)}`)
            await log.flush()
            const names = (await fs.readdir(dir)).sort()
            expect(names).toEqual(['main.1.log', 'main.2.log', 'main.log'])
            for (const n of names)
                expect((await fs.stat(join(dir, n))).size).toBeLessThanOrEqual(200)
            expect(await fs.readFile(join(dir, 'main.log'), 'utf8')).toContain('line 39')
        })
    })

    it('a write error never reaches the caller, and later lines are still written', async () => {
        await withTempDir(async (dir) => {
            const blocked = join(dir, 'blocked')
            await fs.writeFile(blocked, 'a file where the folder should be')
            const broken = new Logger({ dir: blocked })
            expect(() => broken.area('app').info('lost')).not.toThrow()
            await expect(broken.flush()).resolves.toBeUndefined()
            await fs.rm(blocked)
            broken.area('app').info('kept')
            await broken.flush()
            expect(await fs.readFile(join(blocked, 'main.log'), 'utf8')).toContain('kept')
        })
    })

    it('a failing console mirror does not stop the log', async () => {
        await withTempDir(async (dir) => {
            const log = new Logger({
                dir,
                mirror: () => {
                    throw new Error('EPIPE')
                }
            })
            expect(() => log.area('app').info('still written')).not.toThrow()
            await log.flush()
            expect(await fs.readFile(join(dir, 'main.log'), 'utf8')).toContain('still written')
        })
    })
})

describe('diagnostics report (FR-323)', () => {
    const state = {
        version: 1,
        conversationId: 'c1',
        ownId: 'p-anna',
        senderSeq: 5,
        outbox: [
            {
                id: 'e1',
                kind: 'event',
                recipientId: 'p-boris',
                fileName: 'x.bcmsg',
                envelope: { type: 'message.sent', payload: { message: { text: SECRET_TEXT } } },
                writtenAt: '2026-11-15T10:00:00Z',
                deliveredAt: null,
                lastWriteAt: null
            }
        ],
        processed: ['a', 'b'],
        seqs: { 'p-boris': { 1: 'e' } },
        pending: [
            {
                eventId: 'e2',
                type: 'message.sent',
                senderId: 'p-boris',
                payload: { text: SECRET_TEXT }
            }
        ],
        loading: {
            e3: {
                eventId: 'e3',
                senderId: 'p-boris',
                createdAt: 'x',
                payload: { text: SECRET_TEXT }
            }
        },
        keyRequests: [
            { participantId: 'p-boris', signingPublicKey: KEY, fingerprint: 'f', state: 'pending' }
        ],
        quarantine: [{ name: 'q.bcmsg', reason: 'signature is not valid', at: 'x' }]
    }

    it('the sync state keeps types, IDs, and times, but no message text and no keys', () => {
        const text = JSON.stringify(sanitizeSyncState(state))
        expect(text).not.toContain(SECRET_TEXT)
        expect(text).not.toContain(KEY)
        expect(text).toContain('"type":"message.sent"')
        expect(text).toContain('signature is not valid')
        expect(text).toContain('"processedCount":2')
    })

    it('the settings lose the name', () => {
        expect(sanitizeSettings({ displayName: 'Анна', participantId: 'p-anna' })).toEqual({
            displayName: '[…]',
            participantId: 'p-anna'
        })
    })

    it('writes logs, versions, settings, registry, and sync states into one ZIP', async () => {
        await withTempDir(async (dir) => {
            const log = new Logger({ dir: join(dir, 'logs') })
            log.area('app').info('start')
            await log.flush()
            const target = join(dir, 'report.zip')
            await writeReport(target, {
                logs: log.fileNames().map((name) => ({ name, path: join(log.dir, name) })),
                info: { appVersion: '1.6.0' },
                settings: { displayName: 'Анна', fileSizeLimitMb: 30 },
                registry: { version: 1, entries: [] },
                syncStates: { c1: state }
            })
            const entries: Record<string, string> = {}
            await scanZip(target, async (entry, zip) => {
                entries[entry.fileName] = (await collect(await openEntry(zip, entry))).toString(
                    'utf8'
                )
            })
            expect(Object.keys(entries).sort()).toEqual([
                'info.json',
                'logs/main.log',
                'settings.json',
                'sync-registry.json',
                'sync/c1/state.json'
            ])
            const all = Object.values(entries).join('\n')
            expect(all).not.toContain(SECRET_TEXT)
            expect(all).not.toContain('Анна')
            expect(all).not.toContain(KEY)
        })
    })
})
