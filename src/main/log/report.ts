import { createWriteStream, promises as fs } from 'node:fs'
import { join } from 'node:path'
import yazl from 'yazl'
import { redact } from './logger'

/**
 * FR-323: the sync state without anything that can hold message text or keys. Events (outbox envelopes, waiting and
 * loading events) keep only their type, IDs, and times; the processed list and the sequence numbers become counts.
 */
export function sanitizeSyncState(raw: unknown): unknown {
    if (!raw || typeof raw !== 'object') return null
    const s = raw as Record<string, unknown>
    const list = (v: unknown): Record<string, unknown>[] =>
        Array.isArray(v) ? (v as Record<string, unknown>[]) : []
    const envelopeType = (e: unknown): unknown =>
        e && typeof e === 'object' ? (e as Record<string, unknown>)['type'] : undefined
    return {
        version: s['version'],
        conversationId: s['conversationId'],
        ownId: s['ownId'],
        senderSeq: s['senderSeq'],
        outbox: list(s['outbox']).map((o) => ({
            id: o['id'],
            kind: o['kind'],
            type: envelopeType(o['envelope']),
            recipientId: o['recipientId'],
            memberId: o['memberId'],
            fileName: o['fileName'],
            writtenAt: o['writtenAt'],
            deliveredAt: o['deliveredAt'],
            lastWriteAt: o['lastWriteAt'],
            abandonedAt: o['abandonedAt']
        })),
        processedCount: list(s['processed']).length,
        pending: list(s['pending']).map((e) => ({
            eventId: e['eventId'],
            type: e['type'],
            senderId: e['senderId'],
            createdAt: e['createdAt']
        })),
        loading: Object.values((s['loading'] as Record<string, Record<string, unknown>>) ?? {}).map(
            (l) => ({ eventId: l['eventId'], senderId: l['senderId'], createdAt: l['createdAt'] })
        ),
        receivedPartsCount: list(s['receivedParts']).length,
        held: s['held'],
        keptFiles: s['keptFiles'],
        needsUpdate: s['needsUpdate'],
        quarantine: s['quarantine'],
        failures: s['failures'],
        peers: s['peers'],
        ownReceipts: list(s['ownReceipts']).length,
        keyRequests: list(s['keyRequests']).map((r) => ({
            participantId: r['participantId'],
            fingerprint: r['fingerprint'],
            requestedBy: r['requestedBy'],
            createdAt: r['createdAt'],
            state: r['state']
        })),
        rejoin: s['rejoin'],
        lastScanAt: s['lastScanAt']
    }
}

/** FR-323: the settings without the person's name. */
export function sanitizeSettings(raw: unknown): unknown {
    if (!raw || typeof raw !== 'object') return null
    const copy: Record<string, unknown> = { ...(raw as Record<string, unknown>) }
    if ('displayName' in copy) copy['displayName'] = '[…]'
    return copy
}

export interface ReportInput {
    /** Log files: name in the ZIP → path on disk. */
    logs: Array<{ name: string; path: string }>
    info: Record<string, unknown>
    settings: unknown
    registry: unknown
    /** conversation ID → raw `state.json` content. */
    syncStates: Record<string, unknown>
}

/** Writes the diagnostics report ZIP (FR-323). Missing log files are skipped. */
export async function writeReport(target: string, input: ReportInput): Promise<void> {
    const zip = new yazl.ZipFile()
    const out = createWriteStream(target)
    const done = new Promise<void>((resolve, reject) => {
        out.on('close', resolve)
        out.on('error', reject)
        zip.outputStream.on('error', reject)
    })
    zip.outputStream.pipe(out)
    const json = (v: unknown): Buffer => Buffer.from(redact(JSON.stringify(v, null, 2)), 'utf8')
    for (const log of input.logs) {
        const data = await fs.readFile(log.path).catch(() => null)
        if (data) zip.addBuffer(data, `logs/${log.name}`)
    }
    zip.addBuffer(json(input.info), 'info.json')
    zip.addBuffer(json(sanitizeSettings(input.settings)), 'settings.json')
    zip.addBuffer(json(input.registry), 'sync-registry.json')
    for (const [id, state] of Object.entries(input.syncStates))
        zip.addBuffer(
            json(sanitizeSyncState(state)),
            join('sync', id, 'state.json').replace(/\\/g, '/')
        )
    zip.end()
    await done
}
