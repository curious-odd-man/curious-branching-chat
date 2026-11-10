/**
 * Frame inside a sealed box (sync-protocol.md section 3.2):
 *   "BCE1" | u32 big-endian length of the envelope JSON | envelope JSON | 64-byte signature | payload
 * Pure byte handling; signing and encryption are done by src/main/crypto.
 */

import { MAX_ENVELOPE_BYTES } from './schemas'

export const FRAME_MAGIC = new Uint8Array([0x42, 0x43, 0x45, 0x31]) // "BCE1"
export const SIGNATURE_BYTES = 64

/** Context strings that are prefixed (with one zero byte) to signed data (sections 4 and 6). */
export const SIGN_CONTEXT = {
    event: 'branchchat-event-v1',
    keyBundle: 'branchchat-key-v1',
    fingerprint: 'branchchat-fingerprint-v1'
} as const

export interface Frame {
    envelopeJson: Uint8Array
    signature: Uint8Array
    payload: Uint8Array
}

export class FrameError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'FrameError'
    }
}

export function encodeFrame(frame: Frame): Uint8Array {
    if (frame.signature.length !== SIGNATURE_BYTES)
        throw new FrameError('signature must be 64 bytes')
    if (frame.envelopeJson.length > MAX_ENVELOPE_BYTES)
        throw new FrameError('envelope is too large')
    const out = new Uint8Array(
        8 + frame.envelopeJson.length + SIGNATURE_BYTES + frame.payload.length
    )
    out.set(FRAME_MAGIC, 0)
    new DataView(out.buffer).setUint32(4, frame.envelopeJson.length, false)
    out.set(frame.envelopeJson, 8)
    out.set(frame.signature, 8 + frame.envelopeJson.length)
    out.set(frame.payload, 8 + frame.envelopeJson.length + SIGNATURE_BYTES)
    return out
}

export function decodeFrame(bytes: Uint8Array): Frame {
    if (bytes.length < 8 + SIGNATURE_BYTES) throw new FrameError('frame is too short')
    for (let i = 0; i < FRAME_MAGIC.length; i++)
        if (bytes[i] !== FRAME_MAGIC[i]) throw new FrameError('wrong frame magic')
    const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
        4,
        false
    )
    if (length > MAX_ENVELOPE_BYTES) throw new FrameError('envelope is too large')
    if (8 + length + SIGNATURE_BYTES > bytes.length) throw new FrameError('frame is truncated')
    return {
        envelopeJson: bytes.subarray(8, 8 + length),
        signature: bytes.subarray(8 + length, 8 + length + SIGNATURE_BYTES),
        payload: bytes.subarray(8 + length + SIGNATURE_BYTES)
    }
}

/** `context || 0x00 || data`: the exact bytes that are signed. */
export function withContext(context: string, data: Uint8Array): Uint8Array {
    const prefix = new TextEncoder().encode(context)
    const out = new Uint8Array(prefix.length + 1 + data.length)
    out.set(prefix, 0)
    out[prefix.length] = 0
    out.set(data, prefix.length + 1)
    return out
}
