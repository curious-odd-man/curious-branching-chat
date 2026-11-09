import { createHash } from 'node:crypto'
import type { AssetInfo } from '@shared/validation'
import { DocumentError } from './errors'

export interface PreparedImage {
    data: Buffer
    sha256: string
    size: number
    mediaType: AssetInfo['mediaType']
    /** Entry name inside the ZIP, e.g. assets/images/<sha256>.png */
    path: string
}

const EXTENSIONS: Record<AssetInfo['mediaType'], string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp'
}

/** Identifies the image type from its first bytes. Only PNG, JPEG, GIF and WebP are accepted (FR-116). */
export function sniffImageType(data: Buffer): AssetInfo['mediaType'] | null {
    if (
        data.length >= 8 &&
        data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    )
        return 'image/png'
    if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)
        return 'image/jpeg'
    if (data.length >= 6) {
        const head = data.subarray(0, 6).toString('latin1')
        if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif'
    }
    if (
        data.length >= 12 &&
        data.subarray(0, 4).toString('latin1') === 'RIFF' &&
        data.subarray(8, 12).toString('latin1') === 'WEBP'
    )
        return 'image/webp'
    return null
}

export function sha256Hex(data: Buffer): string {
    return createHash('sha256').update(data).digest('hex')
}

/** Validates an image and computes its content-addressed asset path. No size limit is applied (NFR-015). */
export function prepareImage(data: Buffer): PreparedImage {
    const mediaType = sniffImageType(data)
    if (!mediaType)
        throw new DocumentError(
            'UNSUPPORTED_IMAGE',
            'Only PNG, JPEG, GIF and WebP images are supported.'
        )
    const sha256 = sha256Hex(data)
    return {
        data,
        sha256,
        size: data.length,
        mediaType,
        path: `assets/images/${sha256}.${EXTENSIONS[mediaType]}`
    }
}

/** Checks that stored bytes really are what the discussion says they are. */
export function verifyImageAsset(data: Buffer, info: AssetInfo): void {
    const sniffed = sniffImageType(data)
    if (sniffed !== info.mediaType)
        throw new DocumentError(
            'ASSET_MISMATCH',
            `Asset ${info.assetId} is not a ${info.mediaType} image.`
        )
    if (data.length !== info.size || sha256Hex(data) !== info.sha256)
        throw new DocumentError(
            'ASSET_MISMATCH',
            `Asset ${info.assetId} does not match its recorded checksum.`
        )
}
