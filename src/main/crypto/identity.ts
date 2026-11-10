import { createHash } from 'node:crypto'
import {
    KEY_BUNDLE_FORMAT,
    KEY_BUNDLE_TEXT_PREFIX,
    SIGN_CONTEXT,
    canonicalJson,
    keyBundleSchema,
    withContext,
    type KeyBundle
} from '@shared/sync'
import { getSodium } from './sodium'

/** Public half of an identity (FR-155). */
export interface PublicIdentity {
    participantId: string
    signingPublicKey: Uint8Array
    encryptionPublicKey: Uint8Array
}

export const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')
export const fromB64 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'base64'))

/**
 * Fingerprint (sync-protocol.md 4.1): first 32 upper-case hex characters of
 * SHA-256("branchchat-fingerprint-v1" || 0x00 || signingPublicKey || encryptionPublicKey).
 */
export function fingerprintOf(
    signingPublicKey: Uint8Array,
    encryptionPublicKey: Uint8Array
): string {
    const data = new Uint8Array(signingPublicKey.length + encryptionPublicKey.length)
    data.set(signingPublicKey, 0)
    data.set(encryptionPublicKey, signingPublicKey.length)
    return createHash('sha256')
        .update(withContext(SIGN_CONTEXT.fingerprint, data))
        .digest('hex')
        .slice(0, 32)
        .toUpperCase()
}

/** "3F2A91C0…" -> "3F2A 91C0 …" (8 groups of 4, FR-157). */
export function groupFingerprint(fingerprint: string): string {
    return fingerprint.match(/.{1,4}/g)?.join(' ') ?? fingerprint
}

export type BundleSigner = (data: Uint8Array) => Promise<Uint8Array>

/** Builds and signs a public-key bundle (sync-protocol.md section 4). */
export async function makeKeyBundle(
    identity: PublicIdentity,
    displayName: string,
    createdAt: string,
    sign: BundleSigner
): Promise<KeyBundle> {
    const unsigned = {
        format: KEY_BUNDLE_FORMAT,
        version: 1 as const,
        participantId: identity.participantId,
        displayName,
        signingPublicKey: b64(identity.signingPublicKey),
        encryptionPublicKey: b64(identity.encryptionPublicKey),
        fingerprint: fingerprintOf(identity.signingPublicKey, identity.encryptionPublicKey),
        createdAt
    }
    const signed = new TextEncoder().encode(canonicalJson(unsigned))
    const signature = await sign(withContext(SIGN_CONTEXT.keyBundle, signed))
    return keyBundleSchema.parse({ ...unsigned, signature: b64(signature) })
}

export class KeyBundleError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'KeyBundleError'
    }
}

/** Checks schema, fingerprint, and self-signature of a bundle. Throws KeyBundleError if anything is wrong. */
export async function verifyKeyBundle(value: unknown): Promise<KeyBundle> {
    const parsed = keyBundleSchema.safeParse(value)
    if (!parsed.success) throw new KeyBundleError('not a valid BranchChat key')
    const bundle = parsed.data
    const signingKey = fromB64(bundle.signingPublicKey)
    const encryptionKey = fromB64(bundle.encryptionPublicKey)
    if (fingerprintOf(signingKey, encryptionKey) !== bundle.fingerprint)
        throw new KeyBundleError('fingerprint does not match the keys')
    const { signature, ...unsigned } = bundle
    const signed = withContext(
        SIGN_CONTEXT.keyBundle,
        new TextEncoder().encode(canonicalJson(unsigned))
    )
    const sodium = await getSodium()
    if (!sodium.crypto_sign_verify_detached(fromB64(signature), signed, signingKey))
        throw new KeyBundleError('signature is not valid')
    return bundle
}

/** Text form for copy and paste: "BRANCHCHAT-KEY-1:" + base64url of the canonical JSON. */
export function keyBundleToText(bundle: KeyBundle): string {
    return KEY_BUNDLE_TEXT_PREFIX + Buffer.from(canonicalJson(bundle), 'utf8').toString('base64url')
}

/** Reads a bundle from its text form or from the JSON of a `.bckey` file, and verifies it. */
export async function parseKeyBundle(text: string): Promise<KeyBundle> {
    const trimmed = text.trim()
    let json: string
    if (trimmed.startsWith(KEY_BUNDLE_TEXT_PREFIX)) {
        const body = trimmed.slice(KEY_BUNDLE_TEXT_PREFIX.length).replace(/\s+/g, '')
        if (!/^[A-Za-z0-9_-]+$/.test(body)) throw new KeyBundleError('not a valid BranchChat key')
        json = Buffer.from(body, 'base64url').toString('utf8')
    } else json = trimmed
    let value: unknown
    try {
        value = JSON.parse(json)
    } catch {
        throw new KeyBundleError('not a valid BranchChat key')
    }
    return verifyKeyBundle(value)
}

/** JSON written to a `.bckey` file. */
export function keyBundleToFile(bundle: KeyBundle): string {
    return `${JSON.stringify(bundle, null, 2)}\n`
}
