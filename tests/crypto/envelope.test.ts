import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
    PART_SIZE,
    SIGN_CONTEXT,
    canonicalJson,
    encodeFrame,
    withContext,
    type Envelope
} from '@shared/sync'
import { openEvent, sealEvent, sha256Hex, type OpenContext } from '../../src/main/crypto/envelope'
import { joinContent, joinImage, planMessageParts, PartsError } from '../../src/main/crypto/parts'
import { getSodium } from '../../src/main/crypto/sodium'
import { simple } from '../helpers/fixtures'

async function person() {
    const sodium = await getSodium()
    return { sign: sodium.crypto_sign_keypair(), box: sodium.crypto_box_keypair() }
}
type Person = Awaited<ReturnType<typeof person>>

const signer = (p: Person) => async (data: Uint8Array) =>
    (await getSodium()).crypto_sign_detached(data, p.sign.privateKey)

function ctxFor(me: Person, roster: Record<string, Person>, recipientId = 'p-boris'): OpenContext {
    return {
        open: async (sealed) => {
            try {
                return (await getSodium()).crypto_box_seal_open(
                    sealed,
                    me.box.publicKey,
                    me.box.privateKey
                )
            } catch {
                return null
            }
        },
        conversationId: 'doc-1',
        recipientId,
        signingKeysOf: (id) => (roster[id] ? [roster[id]!.sign.publicKey] : null)
    }
}

const envelope = (extra: Partial<Envelope> = {}): Envelope =>
    ({
        protocolVersion: 1,
        eventId: randomUUID(),
        type: 'profile.updated',
        conversationId: 'doc-1',
        senderId: 'p-anna',
        recipientId: 'p-boris',
        senderSeq: 1,
        clock: 3,
        createdAt: '2026-11-11T10:00:00Z',
        payload: { displayName: 'Аня' },
        ...extra
    }) as Envelope

describe('recipient copies (sync-protocol.md 3.2, 5, 6)', () => {
    it('round-trips an event and a part with its binary payload', async () => {
        const anna = await person()
        const boris = await person()
        const ctx = ctxFor(boris, { 'p-anna': anna })
        const e = envelope()
        const opened = await openEvent(
            await sealEvent(e, new Uint8Array(), signer(anna), boris.box.publicKey),
            ctx
        )
        expect(opened).toMatchObject({ status: 'ok', envelope: e })

        const data = new Uint8Array(1000).fill(7)
        const part = envelope({
            type: 'message.part',
            payload: { messageId: 'm1', partId: randomUUID() },
            payloadSha256: sha256Hex(data)
        } as Partial<Envelope>)
        const openedPart = await openEvent(
            await sealEvent(part, data, signer(anna), boris.box.publicKey),
            ctx
        )
        if (openedPart.status !== 'ok') throw new Error(openedPart.status)
        expect(Array.from(openedPart.payload)).toEqual(Array.from(data))
    })

    it('another member cannot open a copy for someone else', async () => {
        const [anna, boris, clara] = await Promise.all([person(), person(), person()])
        const sealed = await sealEvent(
            envelope(),
            new Uint8Array(),
            signer(anna),
            boris.box.publicKey
        )
        expect((await openEvent(sealed, ctxFor(clara, { 'p-anna': anna }, 'p-clara'))).status).toBe(
            'unopened'
        )
    })

    it('treats a changed or cut file as not opened (maybe still copying, section 9.6)', async () => {
        const anna = await person()
        const boris = await person()
        const sealed = await sealEvent(
            envelope(),
            new Uint8Array(),
            signer(anna),
            boris.box.publicKey
        )
        const flipped = sealed.slice()
        flipped[flipped.length - 5]! ^= 1
        const ctx = ctxFor(boris, { 'p-anna': anna })
        expect((await openEvent(flipped, ctx)).status).toBe('unopened')
        expect((await openEvent(sealed.subarray(0, sealed.length - 10), ctx)).status).toBe(
            'unopened'
        )
    })

    it('refuses a forged sender, an unknown sender, and a copy for another recipient or conversation', async () => {
        const [anna, boris, mallory] = await Promise.all([person(), person(), person()])
        const roster = { 'p-anna': anna }
        const ctx = ctxFor(boris, roster)
        // Mallory has folder access and Boris's public key, and claims to be Anna
        const forged = await sealEvent(
            envelope(),
            new Uint8Array(),
            signer(mallory),
            boris.box.publicKey
        )
        expect(await openEvent(forged, ctx)).toMatchObject({
            status: 'invalid',
            reason: 'signature is not valid'
        })
        const unknown = await sealEvent(
            envelope({ senderId: 'p-mallory' }),
            new Uint8Array(),
            signer(mallory),
            boris.box.publicKey
        )
        expect((await openEvent(unknown, ctx)).status).toBe('unknown-sender')
        const other = await sealEvent(
            envelope({ recipientId: 'p-clara' }),
            new Uint8Array(),
            signer(anna),
            boris.box.publicKey
        )
        expect(await openEvent(other, ctx)).toMatchObject({
            status: 'invalid',
            reason: 'other recipient'
        })
        const otherDoc = await sealEvent(
            envelope({ conversationId: 'doc-2' }),
            new Uint8Array(),
            signer(anna),
            boris.box.publicKey
        )
        expect(await openEvent(otherDoc, ctx)).toMatchObject({
            status: 'invalid',
            reason: 'other conversation'
        })
    })

    it('refuses non-canonical envelope JSON and a payload that does not match its hash', async () => {
        const anna = await person()
        const boris = await person()
        const sodium = await getSodium()
        const ctx = ctxFor(boris, { 'p-anna': anna })
        const craft = async (json: string, payload = new Uint8Array()) => {
            const bytes = new TextEncoder().encode(json)
            const signature = sodium.crypto_sign_detached(
                withContext(SIGN_CONTEXT.event, bytes),
                anna.sign.privateKey
            )
            return sodium.crypto_box_seal(
                encodeFrame({ envelopeJson: bytes, signature, payload }),
                boris.box.publicKey
            )
        }
        const e = envelope()
        expect((await openEvent(await craft(JSON.stringify(e, null, 1)), ctx)).status).toBe(
            'invalid'
        )
        expect(await openEvent(await craft(canonicalJson(e)), ctx)).toMatchObject({ status: 'ok' })
        expect(
            (await openEvent(await craft(canonicalJson(e), new Uint8Array([1])), ctx)).status
        ).toBe('invalid')
        const part = envelope({
            type: 'message.part',
            payload: { messageId: 'm', partId: randomUUID() },
            payloadSha256: sha256Hex(new Uint8Array([1]))
        } as Partial<Envelope>)
        expect(
            await openEvent(await craft(canonicalJson(part), new Uint8Array([2])), ctx)
        ).toMatchObject({
            status: 'invalid',
            reason: 'payload does not match payloadSha256'
        })
        // the sender's own envelope cannot be sealed with a payload that does not match
        await expect(
            sealEvent(part, new Uint8Array([2]), signer(anna), boris.box.publicKey)
        ).rejects.toThrow()
    })

    it('reports a newer protocol version only after the signature checks out', async () => {
        const anna = await person()
        const boris = await person()
        const sodium = await getSodium()
        const json = canonicalJson({
            ...envelope(),
            protocolVersion: 2,
            type: 'poll.created',
            payload: { q: 'x' }
        })
        const bytes = new TextEncoder().encode(json)
        const seal = (key: Uint8Array) =>
            sodium.crypto_box_seal(
                encodeFrame({
                    envelopeJson: bytes,
                    signature: sodium.crypto_sign_detached(
                        withContext(SIGN_CONTEXT.event, bytes),
                        key
                    ),
                    payload: new Uint8Array()
                }),
                boris.box.publicKey
            )
        const ctx = ctxFor(boris, { 'p-anna': anna })
        expect((await openEvent(seal(anna.sign.privateKey), ctx)).status).toBe('needs-update')
        expect((await openEvent(seal(boris.sign.privateKey), ctx)).status).toBe('invalid')
    })
})

describe('parts (D-10, D-30)', () => {
    const imageOf = (size: number) => {
        const data = new Uint8Array(size)
        for (let i = 0; i < size; i++) data[i] = (i * 31) & 0xff
        return data
    }

    it('sends images as parts and keeps small content inline', () => {
        const img = imageOf(10)
        const id = sha256Hex(img)
        const draft = {
            message: {
                messageId: 'm',
                threadId: 't',
                authorDisplayName: 'А',
                createdAt: 'x',
                content: simple('текст'),
                assetReferences: [id]
            },
            images: [{ assetId: id, mediaType: 'image/png' as const, size: 10 }],
            parts: []
        }
        const { payload, parts } = planMessageParts(draft, new Map([[id, img]]), randomUUID, 4)
        expect(payload.message.content).toBeDefined()
        expect(parts.map((p) => p.entry.size)).toEqual([4, 4, 2])
        const received = new Map(parts.map((p) => [p.entry.partId, p.data]))
        expect(Array.from(joinImage(payload, id, received))).toEqual(Array.from(img))
    })

    it('moves large content into parts and joins it back', () => {
        const big = simple('ё'.repeat(2 * 1024 * 1024)) // more than 3 MiB of UTF-8
        const draft = {
            message: {
                messageId: 'm',
                threadId: 't',
                authorDisplayName: 'А',
                createdAt: 'x',
                content: big,
                assetReferences: []
            },
            images: [],
            parts: []
        }
        const { payload, parts } = planMessageParts(draft, new Map(), randomUUID)
        expect(payload.message.content).toBeUndefined()
        expect(parts.every((p) => p.entry.kind === 'content' && p.entry.size <= PART_SIZE)).toBe(
            true
        )
        expect(joinContent(payload, new Map(parts.map((p) => [p.entry.partId, p.data])))).toEqual(
            big
        )
    })

    it('refuses a missing, changed, or swapped part', () => {
        const img = imageOf(9)
        const id = sha256Hex(img)
        const draft = {
            message: {
                messageId: 'm',
                threadId: 't',
                authorDisplayName: 'А',
                createdAt: 'x',
                content: simple('x'),
                assetReferences: [id]
            },
            images: [{ assetId: id, mediaType: 'image/png' as const, size: 9 }],
            parts: []
        }
        const { payload, parts } = planMessageParts(draft, new Map([[id, img]]), randomUUID, 4)
        const received = new Map(parts.map((p) => [p.entry.partId, p.data]))
        expect(() => joinImage(payload, id, new Map([...received].slice(1)))).toThrow(PartsError)
        const changed = new Map(received)
        changed.set(parts[0]!.entry.partId, new Uint8Array(4))
        expect(() => joinImage(payload, id, changed)).toThrow(PartsError)
        const swapped = new Map(received)
        swapped.set(parts[0]!.entry.partId, parts[1]!.data)
        swapped.set(parts[1]!.entry.partId, parts[0]!.data)
        expect(() => joinImage(payload, id, swapped)).toThrow(PartsError)
        expect(() => planMessageParts(draft, new Map([[id, imageOf(8)]]), randomUUID)).toThrow()
    })

    it('handles a 200 MB image in 4 MiB parts', async () => {
        const anna = await person()
        const boris = await person()
        const img = new Uint8Array(200 * 1024 * 1024)
        for (let i = 0; i < img.length; i += 4096) img[i] = i & 0xff
        const id = sha256Hex(img)
        const draft = {
            message: {
                messageId: 'm',
                threadId: 't',
                authorDisplayName: 'А',
                createdAt: 'x',
                content: simple('x'),
                assetReferences: [id]
            },
            images: [{ assetId: id, mediaType: 'image/png' as const, size: img.length }],
            parts: []
        }
        const started = Date.now()
        const { payload, parts } = planMessageParts(draft, new Map([[id, img]]), randomUUID)
        expect(parts).toHaveLength(50)
        // every part is one encrypted file below the default 30 MB limit
        const sealedSizes: number[] = []
        const received = new Map<string, Uint8Array>()
        const ctx = ctxFor(boris, { 'p-anna': anna })
        for (const p of parts) {
            const e = envelope({
                type: 'message.part',
                payload: { messageId: 'm', partId: p.entry.partId },
                payloadSha256: p.entry.sha256
            } as Partial<Envelope>)
            const sealed = await sealEvent(e, p.data, signer(anna), boris.box.publicKey)
            sealedSizes.push(sealed.length)
            const opened = await openEvent(sealed, ctx)
            if (opened.status !== 'ok') throw new Error(opened.status)
            received.set(p.entry.partId, opened.payload)
        }
        expect(Math.max(...sealedSizes)).toBeLessThan(5 * 1024 * 1024)
        expect(sha256Hex(joinImage(payload, id, received))).toBe(id)
        expect(Date.now() - started).toBeLessThan(60_000)
    }, 120_000)
})
