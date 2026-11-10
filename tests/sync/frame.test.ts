import { describe, expect, it } from 'vitest'
import { FrameError, decodeFrame, encodeFrame, withContext } from '@shared/sync'

const sig = new Uint8Array(64).fill(7)

describe('frame (sync-protocol.md 3.2)', () => {
    it('round-trips envelope, signature, and payload', () => {
        const envelopeJson = new TextEncoder().encode('{"a":1}')
        const payload = new Uint8Array([1, 2, 3])
        const bytes = encodeFrame({ envelopeJson, signature: sig, payload })
        expect(Array.from(bytes.subarray(0, 8))).toEqual([0x42, 0x43, 0x45, 0x31, 0, 0, 0, 7])
        const back = decodeFrame(bytes)
        expect(new TextDecoder().decode(back.envelopeJson)).toBe('{"a":1}')
        expect(Array.from(back.signature)).toEqual(Array.from(sig))
        expect(Array.from(back.payload)).toEqual([1, 2, 3])
    })

    it('allows an empty payload', () => {
        const bytes = encodeFrame({
            envelopeJson: new Uint8Array([123, 125]),
            signature: sig,
            payload: new Uint8Array()
        })
        expect(decodeFrame(bytes).payload.length).toBe(0)
    })

    it('refuses wrong magic, short, and truncated frames', () => {
        const good = encodeFrame({
            envelopeJson: new Uint8Array([123, 125]),
            signature: sig,
            payload: new Uint8Array()
        })
        const wrong = good.slice()
        wrong[0] = 0
        expect(() => decodeFrame(wrong)).toThrow(FrameError)
        expect(() => decodeFrame(good.subarray(0, 20))).toThrow(FrameError)
        const longer = good.slice()
        new DataView(longer.buffer).setUint32(4, 1000, false)
        expect(() => decodeFrame(longer)).toThrow(FrameError)
    })

    it('refuses a signature of the wrong size', () => {
        expect(() =>
            encodeFrame({
                envelopeJson: new Uint8Array(),
                signature: new Uint8Array(10),
                payload: new Uint8Array()
            })
        ).toThrow(FrameError)
    })

    it('prefixes the context and one zero byte', () => {
        expect(Array.from(withContext('ab', new Uint8Array([9])))).toEqual([97, 98, 0, 9])
    })
})
