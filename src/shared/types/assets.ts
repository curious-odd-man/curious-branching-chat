/**
 * Embedded images are shown through the app's own `bcasset:` scheme: bcasset://asset/<sessionId>/<assetId>.
 * `sessionId` identifies one open discussion window (so two copies of a file never mix up), `assetId` is the image's
 * SHA-256. The main process answers these requests from the discussion file (or from memory, for images that are
 * not saved yet), after checking the image's type and checksum.
 */
export const ASSET_SCHEME = 'bcasset'
const HEX64 = /^[0-9a-f]{64}$/

export function assetUrl(sessionId: string, assetId: string): string {
    return `${ASSET_SCHEME}://asset/${sessionId}/${assetId}`
}

export function parseAssetUrl(url: string): { sessionId: string; assetId: string } | null {
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        return null
    }
    if (parsed.protocol !== `${ASSET_SCHEME}:` || parsed.hostname !== 'asset') return null
    const parts = parsed.pathname.split('/').filter((p) => p.length > 0)
    if (parts.length !== 2) return null
    const [sessionId, assetId] = parts as [string, string]
    if (!/^[0-9a-zA-Z-]{1,64}$/.test(sessionId) || !HEX64.test(assetId)) return null
    return { sessionId, assetId }
}

/** What the window gets back after adding an image to a draft. */
export interface StagedImage {
    assetId: string
    mediaType: string
    size: number
}
