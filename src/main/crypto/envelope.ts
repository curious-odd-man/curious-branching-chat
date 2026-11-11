import { createHash } from 'node:crypto'
import {
    FrameError,
    PART_EVENT_TYPES,
    SIGN_CONTEXT,
    canonicalJson,
    checkEnvelope,
    decodeFrame,
    encodeFrame,
    isCanonicalJson,
    withContext,
    type Envelope,
    type EnvelopeBase
} from '@shared/sync'
import { getSodium } from './sodium'

/**
 * Recipient copies of events (sync-protocol.md sections 3.2, 5, 6): canonical envelope JSON, Ed25519 signature,
 * frame, and `crypto_box_seal` to the recipient. Pure apart from the keys passed in.
 */

export const sha256Hex = (data: Uint8Array): string =>
    createHash('sha256').update(data).digest('hex')

export type Signer = (data: Uint8Array) => Promise<Uint8Array>

/** Builds one encrypted recipient copy. For parts, `payload` is the binary payload of the frame. */
export async function sealEvent(
    envelope: Envelope,
    payload: Uint8Array,
    sign: Signer,
    recipientEncryptionKey: Uint8Array
): Promise<Uint8Array> {
    const isPart = PART_EVENT_TYPES.includes(envelope.type)
    if (isPart && envelope.payloadSha256 !== sha256Hex(payload))
        throw new Error('payloadSha256 does not match the payload')
    if (!isPart && payload.length > 0) throw new Error('only parts carry a binary payload')
    const check = checkEnvelope(envelope)
    if (check.status !== 'ok') throw new Error(`invalid envelope: ${JSON.stringify(check)}`)
    const envelopeJson = new TextEncoder().encode(canonicalJson(envelope))
    const signature = await sign(withContext(SIGN_CONTEXT.event, envelopeJson))
    const frame = encodeFrame({ envelopeJson, signature, payload })
    const sodium = await getSodium()
    return sodium.crypto_box_seal(frame, recipientEncryptionKey)
}

export type OpenedEvent =
    | { status: 'ok'; envelope: Envelope; payload: Uint8Array }
    /** The sealed box did not open or the frame is cut: maybe still being copied (section 9.6). */
    | { status: 'unopened' }
    /** Newer protocol or unknown type: keep pending, ask to update (section 10). */
    | { status: 'needs-update'; base: EnvelopeBase }
    /** The sender is not in the roster (yet), so the signature cannot be checked. */
    | { status: 'unknown-sender'; base: EnvelopeBase }
    | { status: 'invalid'; reason: string }

export interface OpenContext {
    /** Opens the sealed box with the own private key; null if it does not open. */
    open(sealed: Uint8Array): Promise<Uint8Array | null>
    conversationId: string
    /** Own participant ID: every copy must be addressed to it. */
    recipientId: string
    /** Signing keys of the sender that may have signed this event (current first), or null if not a member. */
    signingKeysOf(senderId: string, createdAt: string): Uint8Array[] | null
}

/** Opens and verifies one recipient copy (sync-protocol.md section 6, steps for the recipient). */
export async function openEvent(sealed: Uint8Array, ctx: OpenContext): Promise<OpenedEvent> {
    const plain = await ctx.open(sealed)
    if (!plain) return { status: 'unopened' }
    let frame
    try {
        frame = decodeFrame(plain)
    } catch (err) {
        if (err instanceof FrameError && /truncated|too short/.test(err.message))
            return { status: 'unopened' }
        return { status: 'invalid', reason: 'bad frame' }
    }
    const text = new TextDecoder('utf-8', { fatal: true })
    let json: string
    try {
        json = text.decode(frame.envelopeJson)
    } catch {
        return { status: 'invalid', reason: 'envelope is not UTF-8' }
    }
    if (!isCanonicalJson(json))
        return { status: 'invalid', reason: 'envelope is not canonical JSON' }
    const check = checkEnvelope(JSON.parse(json))
    if (check.status === 'invalid') return { status: 'invalid', reason: check.problems.join('; ') }
    const base = check.status === 'ok' ? check.envelope : check.base
    if (base.conversationId !== ctx.conversationId)
        return { status: 'invalid', reason: 'other conversation' }
    if (base.recipientId !== ctx.recipientId)
        return { status: 'invalid', reason: 'other recipient' }

    const keys = ctx.signingKeysOf(base.senderId, base.createdAt)
    if (!keys || keys.length === 0) return { status: 'unknown-sender', base }
    const sodium = await getSodium()
    const signed = withContext(SIGN_CONTEXT.event, frame.envelopeJson)
    const valid = keys.some((k) => {
        try {
            return sodium.crypto_sign_verify_detached(frame.signature, signed, k)
        } catch {
            return false
        }
    })
    // successful decryption is never proof of the sender
    if (!valid) return { status: 'invalid', reason: 'signature is not valid' }
    if (check.status === 'needs-update') return { status: 'needs-update', base }

    const envelope = check.envelope
    const isPart = PART_EVENT_TYPES.includes(envelope.type)
    if (isPart && envelope.payloadSha256 !== sha256Hex(frame.payload))
        return { status: 'invalid', reason: 'payload does not match payloadSha256' }
    if (!isPart && frame.payload.length > 0)
        return { status: 'invalid', reason: 'unexpected binary payload' }
    return { status: 'ok', envelope, payload: new Uint8Array(frame.payload) }
}

/** A decrypted frame whose signature is not checked yet (only used for invitations, see `verifyFrame`). */
export interface UnverifiedFrame {
    envelope: Envelope
    envelopeJson: Uint8Array
    signature: Uint8Array
    payload: Uint8Array
}

/**
 * Invitations (sync-protocol.md 7.10): the invitee does not know the inviter's key before it has read the snapshot,
 * so the frame is decrypted first and verified afterwards with the key from the snapshot's roster. The person then
 * compares the inviter's fingerprint (FR-162). Returns null if the file does not open or is not a valid frame.
 */
export async function openUnverified(
    sealed: Uint8Array,
    open: (sealed: Uint8Array) => Promise<Uint8Array | null>
): Promise<UnverifiedFrame | null> {
    const plain = await open(sealed)
    if (!plain) return null
    try {
        const frame = decodeFrame(plain)
        const json = new TextDecoder('utf-8', { fatal: true }).decode(frame.envelopeJson)
        if (!isCanonicalJson(json)) return null
        const check = checkEnvelope(JSON.parse(json))
        if (check.status !== 'ok') return null
        const env = check.envelope
        const isPart = PART_EVENT_TYPES.includes(env.type)
        if (isPart && env.payloadSha256 !== sha256Hex(frame.payload)) return null
        if (!isPart && frame.payload.length > 0) return null
        return {
            envelope: env,
            envelopeJson: new Uint8Array(frame.envelopeJson),
            signature: new Uint8Array(frame.signature),
            payload: new Uint8Array(frame.payload)
        }
    } catch {
        return null
    }
}

/** Checks the signature of a frame from `openUnverified` with the sender's signing key. */
export async function verifyFrame(
    frame: UnverifiedFrame,
    signingKey: Uint8Array
): Promise<boolean> {
    const sodium = await getSodium()
    try {
        return sodium.crypto_sign_verify_detached(
            frame.signature,
            withContext(SIGN_CONTEXT.event, frame.envelopeJson),
            signingKey
        )
    } catch {
        return false
    }
}
