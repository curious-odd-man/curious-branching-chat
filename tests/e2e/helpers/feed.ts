import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface Feed {
    /** Folder URL to give the updater (BRANCHCHAT_E2E_UPDATE_FEED). */
    url: string
    /** Every request received: "METHOD path" plus all header lines, for privacy assertions (NFR-008). */
    requests: string[]
    payload: Buffer
    close(): Promise<void>
}

export interface FeedOptions {
    version: string
    notes?: string
    releaseDate?: string
    /** Serve a file whose bytes differ from the published checksum (a corrupted download, FR-102). */
    corrupt?: boolean
    payloadSize?: number
}

/**
 * A local stand-in for a GitHub release: serves `latest.yml` (under both the Windows and Linux channel names, since
 * the end-to-end tests run on Linux) and the installer file with its SHA-512, like electron-builder publishes them.
 */
export async function startFeed(options: FeedOptions): Promise<Feed> {
    const payload = randomBytes(options.payloadSize ?? 300 * 1024)
    const served = options.corrupt ? Buffer.from(payload.map((b) => b ^ 0xff)) : payload
    const sha512 = createHash('sha512').update(payload).digest('base64')
    const fileName = 'BranchChat-Setup.exe'
    const yaml = [
        `version: ${options.version}`,
        'files:',
        `  - url: ${fileName}`,
        `    sha512: ${sha512}`,
        `    size: ${payload.length}`,
        `path: ${fileName}`,
        `sha512: ${sha512}`,
        `releaseDate: '${options.releaseDate ?? '2026-11-01T10:00:00.000Z'}'`,
        `releaseNotes: ${JSON.stringify(options.notes ?? '<h2>Что нового</h2><ul><li>Первое</li><li>Второе</li></ul>')}`,
        ''
    ].join('\n')

    const requests: string[] = []
    const server: Server = createServer((req, res) => {
        const headers = Object.entries(req.headers)
            .map(([k, v]) => `${k}: ${String(v)}`)
            .join('\n')
        requests.push(`${req.method} ${req.url}\n${headers}`)
        const path = decodeURIComponent((req.url ?? '').split('?')[0] ?? '')
        if (/\/latest[^/]*\.yml$/.test(path)) {
            res.writeHead(200, { 'content-type': 'text/yaml' }).end(yaml)
        } else if (path.endsWith(fileName)) {
            res.writeHead(200, {
                'content-type': 'application/octet-stream',
                'content-length': served.length
            }).end(served)
        } else {
            res.writeHead(404).end('not found')
        }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    return {
        url: `http://127.0.0.1:${port}/`,
        requests,
        payload,
        close: () =>
            new Promise<void>((resolve) => {
                server.closeAllConnections()
                server.close(() => resolve())
            })
    }
}
