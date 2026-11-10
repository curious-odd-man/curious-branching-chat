import { describe, expect, it } from 'vitest'
import {
    EVENT_TYPES,
    PART_SIZE,
    PAYLOAD_SCHEMAS,
    SHARED_FILE_NAME,
    checkEnvelope,
    keyBundleSchema,
    type EventType
} from '@shared/sync'
import { checkRosterIntegrity, syncInfoSchema } from '@shared/validation'

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const hash = (c: string): string => c.repeat(64)
const key = 'A'.repeat(43) + '='
const fp = '0123456789ABCDEF0123456789ABCDEF'
const doc = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Привет' }] }]
}

const member = {
    participantId: 'p-anna',
    displayName: 'Анна',
    signingPublicKey: key,
    encryptionPublicKey: key,
    fingerprint: fp,
    addedBy: 'p-anna',
    addedAt: '2026-11-10T10:00:00Z'
}

/** One valid payload for every event type. */
const validPayloads: Record<EventType, unknown> = {
    'message.sent': {
        message: {
            messageId: 'm1',
            threadId: 't1',
            authorDisplayName: 'Анна',
            createdAt: '2026-11-10T10:00:00.000Z',
            assetReferences: [hash('a')]
        },
        images: [{ assetId: hash('a'), mediaType: 'image/png', size: 5_000_000 }],
        parts: [
            { partId: id(1), kind: 'content', index: 0, size: 100, sha256: hash('c') },
            {
                partId: id(2),
                kind: 'image',
                assetId: hash('a'),
                index: 0,
                size: PART_SIZE,
                sha256: hash('d')
            },
            {
                partId: id(3),
                kind: 'image',
                assetId: hash('a'),
                index: 1,
                size: 805_696,
                sha256: hash('e')
            }
        ]
    },
    'message.part': { messageId: 'm1', partId: id(1) },
    'branch.created': {
        thread: {
            threadId: 't2',
            parentThreadId: 't1',
            sourceMessageId: 'm1',
            quoteText: 'Привет',
            selectionStart: 0,
            selectionEnd: 6,
            createdAt: '2026-11-10T10:00:00Z'
        }
    },
    'branch.status.set': { threadId: 't2', status: 'closed' },
    'branch.title.set': { threadId: 't2', title: '' },
    'readstate.added': { messageIds: ['m1', 'm2'] },
    'member.added': { member },
    'member.keys.replaced': {
        participantId: 'p-anna',
        signingPublicKey: key,
        encryptionPublicKey: key,
        fingerprint: fp
    },
    'profile.updated': { displayName: 'Аня' },
    'receipt.delivered': { ids: [id(5)] },
    invitation: {
        invitationId: id(9),
        minProtocolVersion: 1,
        snapshotSize: 150,
        snapshotSha256: hash('f'),
        parts: [
            { partId: id(10), index: 1, size: 50, sha256: hash('1') },
            { partId: id(11), index: 0, size: 100, sha256: hash('2') }
        ]
    },
    'invitation.part': { invitationId: id(9), partId: id(10) }
}

function envelope(type: string, payload: unknown, extra: Record<string, unknown> = {}): unknown {
    const isPart = type === 'message.part' || type === 'invitation.part'
    return {
        protocolVersion: 1,
        eventId: id(100),
        type,
        conversationId: 'doc-1',
        senderId: 'p-anna',
        recipientId: 'p-boris',
        senderSeq: type === 'receipt.delivered' ? 0 : 1,
        clock: 5,
        createdAt: '2026-11-10T10:00:00Z',
        payload,
        ...(isPart ? { payloadSha256: hash('9') } : {}),
        ...extra
    }
}

describe('sync event schemas (sync-protocol.md 5 and 7)', () => {
    it('defines every event type of the protocol', () => {
        expect(EVENT_TYPES.sort()).toEqual(
            [
                'branch.created',
                'branch.status.set',
                'branch.title.set',
                'invitation',
                'invitation.part',
                'member.added',
                'member.keys.replaced',
                'message.part',
                'message.sent',
                'profile.updated',
                'readstate.added',
                'receipt.delivered'
            ].sort()
        )
    })

    for (const type of Object.keys(PAYLOAD_SCHEMAS) as EventType[]) {
        it(`accepts a valid ${type} envelope`, () => {
            const result = checkEnvelope(envelope(type, validPayloads[type]))
            expect(result.status, JSON.stringify(result)).toBe('ok')
        })

        it(`refuses an unknown key in a ${type} payload`, () => {
            const payload = { ...(validPayloads[type] as object), extra: 1 }
            expect(checkEnvelope(envelope(type, payload)).status).toBe('invalid')
        })
    }

    it('accepts inline content without content parts', () => {
        const p = validPayloads['message.sent'] as {
            message: object
            images: unknown[]
            parts: unknown[]
        }
        const inline = {
            message: { ...p.message, content: doc, assetReferences: [] },
            images: [],
            parts: []
        }
        expect(checkEnvelope(envelope('message.sent', inline)).status).toBe('ok')
    })

    it('refuses a message with no content at all, or with content twice', () => {
        const p = validPayloads['message.sent'] as {
            message: Record<string, unknown>
            images: unknown[]
            parts: Array<Record<string, unknown>>
        }
        const none = { ...p, parts: p.parts.filter((x) => x.kind !== 'content') }
        expect(checkEnvelope(envelope('message.sent', none)).status).toBe('invalid')
        const twice = { ...p, message: { ...p.message, content: doc } }
        expect(checkEnvelope(envelope('message.sent', twice)).status).toBe('invalid')
    })

    it('refuses rich text outside the stored subset', () => {
        const bad = {
            message: {
                messageId: 'm1',
                threadId: 't1',
                authorDisplayName: 'A',
                createdAt: '2026-11-10T10:00:00Z',
                content: { type: 'doc', content: [{ type: 'script', text: 'x' }] },
                assetReferences: []
            },
            images: [],
            parts: []
        }
        expect(checkEnvelope(envelope('message.sent', bad)).status).toBe('invalid')
    })

    it('refuses parts with gaps, duplicates, wrong sizes, or images without parts', () => {
        const p = validPayloads['message.sent'] as {
            message: object
            images: unknown[]
            parts: Array<Record<string, unknown>>
        }
        const gap = {
            ...p,
            parts: p.parts.map((x) => (x.partId === id(3) ? { ...x, index: 2 } : x))
        }
        const dup = { ...p, parts: [...p.parts, p.parts[0]] }
        const big = {
            ...p,
            parts: p.parts.map((x, i) => (i === 1 ? { ...x, size: PART_SIZE + 1 } : x))
        }
        const noParts = { ...p, parts: p.parts.filter((x) => x.kind === 'content') }
        for (const bad of [gap, dup, big, noParts])
            expect(checkEnvelope(envelope('message.sent', bad)).status).toBe('invalid')
    })

    it('refuses an invitation whose parts do not add up', () => {
        const p = validPayloads.invitation as Record<string, unknown>
        expect(checkEnvelope(envelope('invitation', { ...p, snapshotSize: 151 })).status).toBe(
            'invalid'
        )
    })

    it('needs payloadSha256 for parts only, and senderSeq 0 for receipts only', () => {
        expect(
            checkEnvelope(
                envelope('message.part', validPayloads['message.part'], {
                    payloadSha256: undefined
                })
            ).status
        ).toBe('invalid')
        expect(
            checkEnvelope(
                envelope('profile.updated', validPayloads['profile.updated'], {
                    payloadSha256: hash('1')
                })
            ).status
        ).toBe('invalid')
        expect(
            checkEnvelope(
                envelope('receipt.delivered', validPayloads['receipt.delivered'], { senderSeq: 3 })
            ).status
        ).toBe('invalid')
        expect(
            checkEnvelope(
                envelope('profile.updated', validPayloads['profile.updated'], { senderSeq: 0 })
            ).status
        ).toBe('invalid')
    })

    it('asks for an update for a newer protocol version or an unknown type (section 10)', () => {
        expect(
            checkEnvelope(
                envelope('profile.updated', validPayloads['profile.updated'], {
                    protocolVersion: 2
                })
            ).status
        ).toBe('needs-update')
        expect(checkEnvelope(envelope('poll.created', { question: 'x' })).status).toBe(
            'needs-update'
        )
    })

    it('refuses unknown envelope keys, floats, and bad ids', () => {
        expect(
            checkEnvelope(envelope('profile.updated', validPayloads['profile.updated'], { x: 1 }))
                .status
        ).toBe('invalid')
        expect(
            checkEnvelope(
                envelope('profile.updated', validPayloads['profile.updated'], { clock: 1.5 })
            ).status
        ).toBe('invalid')
        expect(
            checkEnvelope(
                envelope('profile.updated', validPayloads['profile.updated'], { eventId: 'abc' })
            ).status
        ).toBe('invalid')
    })
})

describe('key bundle and roster schemas', () => {
    it('accepts a valid bundle and refuses a wrong fingerprint format', () => {
        const bundle = {
            format: 'branchchat-key',
            version: 1,
            participantId: 'p-anna',
            displayName: 'Анна',
            signingPublicKey: key,
            encryptionPublicKey: key,
            fingerprint: fp,
            createdAt: '2026-11-10T10:00:00Z',
            signature: 'A'.repeat(86) + '=='
        }
        expect(keyBundleSchema.safeParse(bundle).success).toBe(true)
        expect(
            keyBundleSchema.safeParse({ ...bundle, fingerprint: fp.toLowerCase() }).success
        ).toBe(false)
    })

    it('checks the roster: unique members, known addedBy', () => {
        const ok = syncInfoSchema.parse({ protocolVersion: 1, members: [member] })
        expect(checkRosterIntegrity(ok)).toEqual([])
        const bad = syncInfoSchema.parse({
            protocolVersion: 1,
            members: [member, member, { ...member, participantId: 'p-b', addedBy: 'p-x' }]
        })
        expect(checkRosterIntegrity(bad)).toHaveLength(2)
    })

    it('recognizes shared-folder file names, including conflict copies', () => {
        expect(SHARED_FILE_NAME.test(`${id(1)}.bcmsg`)).toBe(true)
        expect(SHARED_FILE_NAME.test(`${id(1)} (1).bcpart`)).toBe(true)
        expect(SHARED_FILE_NAME.test(`${id(1)}.bcmsg.abc.tmp`)).toBe(false)
        expect(SHARED_FILE_NAME.test('../evil.bcmsg')).toBe(false)
    })
})
