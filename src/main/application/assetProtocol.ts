import { protocol } from 'electron'
import { ASSET_SCHEME, parseAssetUrl } from '@shared/types/assets'
import type { AppController } from './appController'

/** Must run before the app is ready. */
export function registerAssetScheme(): void {
    protocol.registerSchemesAsPrivileged([
        {
            scheme: ASSET_SCHEME,
            privileges: { standard: true, secure: true, supportFetchAPI: true }
        }
    ])
}

/**
 * Serves embedded images to the window (FR-068): bcasset://asset/<sessionId>/<assetId>.
 * Only images of currently open discussions can be requested; the type and checksum are verified before anything is
 * returned (see DocumentSession.readAssetBytes), and the response is marked so that it can never be treated as
 * anything but an image. A missing or damaged image is a 404, which the window shows as a placeholder (FR-075).
 */
export function installAssetProtocol(controller: AppController): void {
    protocol.handle(ASSET_SCHEME, async (request) => {
        const parsed = parseAssetUrl(request.url)
        if (!parsed) return new Response(null, { status: 400 })
        const session = controller.sessionById(parsed.sessionId)
        if (!session) return new Response(null, { status: 404 })
        const asset = await session.readAssetBytes(parsed.assetId)
        if (!asset) return new Response(null, { status: 404 })
        return new Response(asset.data, {
            status: 200,
            headers: {
                'Content-Type': asset.mediaType,
                'Content-Length': String(asset.data.length),
                // the address contains the image's checksum, so its content never changes
                'Cache-Control': 'private, max-age=31536000, immutable',
                'X-Content-Type-Options': 'nosniff'
            }
        })
    })
}
