import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
    appendMessage,
    ensureParticipant,
    mainThread,
    toggleReaction,
    withReaction,
    reactionCounts,
    type Author
} from '@shared/domain'
import type { DocumentContents } from '@shared/types'
import {
    applyEvent,
    checkEnvelope,
    eventsFromChange,
    normalizeSynced,
    PART_SIZE,
    type VerifiedEvent
} from '@shared/sync'
import { checkDiscussionIntegrity, type Attachment, type SyncInfo } from '@shared/validation'
import { b64, fingerprintOf } from '../../src/main/crypto/identity'
import { getSodium } from '../../src/main/crypto/sodium'
import { newDocumentContents } from '../../src/main/document/factory'
import { ConversationSync, type DocumentPort } from '../../src/main/sync/conversationSync'
import { SyncState } from '../../src/main/sync/syncState'
import { FolderTransport } from '../../src/main/transport/folderTransport'
import { anna, boris, clara, makeCtx, simple, withTempDir } from '../helpers/fixtures'

const DOC = 'doc-r24'
const MB = 1024 * 1024

interface Member {
    author: Author
    contents: DocumentContents
    blobs: Map<string, Uint8Array>
    limitMb: number
    sync: ConversationSync
    state: SyncState
    transport: FolderTransport
    ctx: ReturnType<typeof makeCtx>
    stateDir: string
    keys: {
        sign: (d: Uint8Array) => Promise<Uint8Array>
        open: (s: Uint8Array) => Promise<Uint8Array | null>
    }
}

const clockMs = Date.parse('2026-11-16T10:00:00Z')
const now = (): string => new Date(clockMs).toISOString()

async function makeKeys() {
    const sodium = await getSodium()
    const sign = sodium.crypto_sign_keypair()
    const box = sodium.crypto_box_keypair()
    return {
        sign,
        box,
        own: {
            sign: async (d: Uint8Array) => sodium.crypto_sign_detached(d, sign.privateKey),
            open: async (s: Uint8Array) => {
                try {
                    return sodium.crypto_box_seal_open(s, box.publicKey, box.privateKey)
                } catch {
                    return null
                }
            }
        }
    }
}

async function group(dir: string, limits: number[] = [30, 30, 30]): Promise<Member[]> {
    const root = join(dir, 'shared')
    await fs.mkdir(root, { recursive: true })
    const people = [anna, boris, clara]
    const keys = await Promise.all(people.map(() => makeKeys()))
    const roster: SyncInfo = {
        protocolVersion: 1,
        members: people.map((a, i) => ({
            participantId: a.participantId,
            displayName: a.displayName,
            signingPublicKey: b64(keys[i]!.sign.publicKey),
            encryptionPublicKey: b64(keys[i]!.box.publicKey),
            fingerprint: fingerprintOf(keys[i]!.sign.publicKey, keys[i]!.box.publicKey),
            addedBy: anna.participantId,
            addedAt: '2026-11-16T09:00:00Z'
        }))
    }
    const start = normalizeSynced({
        ...newDocumentContents(makeCtx('s'), { title: 'Общее', author: anna }),
        sync: roster
    })
    start.manifest.documentId = DOC
    const members: Member[] = []
    for (const [i, author] of people.entries()) {
        const stateDir = join(dir, 'local', author.participantId)
        const m = {
            author,
            contents: structuredClone(start),
            blobs: new Map<string, Uint8Array>(),
            limitMb: limits[i]!,
            ctx: makeCtx(author.participantId),
            stateDir,
            transport: new FolderTransport(root, join(stateDir, 'staging')),
            keys: keys[i]!.own
        } as unknown as Member
        const port: DocumentPort = {
            read: async () => m.contents,
            update: async (change) => {
                const r = change(m.contents)
                if (r) m.contents = r.contents
            },
            imageBytes: async () => null,
            blobBytes: async (h) => m.blobs.get(h) ?? null,
            hasBlob: async (h) => m.blobs.has(h),
            storeBlob: async (h, data) => void m.blobs.set(h, data)
        }
        m.state = await SyncState.open(stateDir, DOC, author.participantId, () => clockMs)
        m.sync = new ConversationSync({
            conversationId: DOC,
            ownId: author.participantId,
            transport: m.transport,
            state: m.state,
            keys: m.keys,
            document: port,
            now,
            newId: randomUUID,
            maxFileBytes: () => m.limitMb * MB,
            appVersion: '9.9.0',
            stableMs: 0
        })
        members.push(m)
    }
    for (const m of members) await m.sync.start()
    return members
}

async function change(m: Member, fn: (c: DocumentContents) => DocumentContents): Promise<void> {
    const before = m.contents
    m.ctx.tick()
    const next = fn(before)
    const after = normalizeSynced({
        ...next,
        discussion: ensureParticipant(next.discussion, m.author)
    })
    m.contents = after
    await m.sync.send(eventsFromChange(before, after, m.author.participantId, now()), after)
}

async function say(m: Member, text: string, attachments: Attachment[] = []): Promise<void> {
    await change(m, (c) => ({
        ...c,
        discussion: appendMessage(m.ctx, c.discussion, {
            threadId: mainThread(c.discussion).threadId,
            author: m.author,
            content: simple(text),
            attachments
        }).discussion
    }))
}

async function scanAll(members: Member[], rounds = 8): Promise<void> {
    for (let i = 0; i < rounds; i++) for (const m of members) await m.sync.scan()
}

function fileOf(size: number, seed: number): { data: Uint8Array; attachment: Attachment } {
    const data = new Uint8Array(size)
    for (let i = 0; i < size; i++) data[i] = (i * seed + 13) & 0xff
    const sha256 = createHash('sha256').update(data).digest('hex')
    return { data, attachment: { name: 'план.pdf', size, type: 'application/pdf', sha256 } }
}

const first = (m: Member) => mainThread(m.contents.discussion).messages[0]!

describe('reactions and attachments through the shared folder', () => {
    it('reactions converge in any order; the last change of a person wins per emoji (FR-233)', async () => {
        await withTempDir(async (dir) => {
            const members = await group(dir)
            const [a, b, c] = members as [Member, Member, Member]
            await say(a, 'Привет')
            await scanAll(members, 2)
            const id = first(b).messageId
            await change(b, (x) => ({
                ...x,
                discussion: toggleReaction(x.discussion, b.author, id, '👍')
            }))
            await change(c, (x) => ({
                ...x,
                discussion: toggleReaction(x.discussion, c.author, id, '👍')
            }))
            await change(c, (x) => ({
                ...x,
                discussion: toggleReaction(x.discussion, c.author, id, '❤️')
            }))
            // Clara takes her 👍 back
            await change(c, (x) => ({
                ...x,
                discussion: toggleReaction(x.discussion, c.author, id, '👍')
            }))
            await scanAll(members)
            for (const m of members) {
                expect(reactionCounts(first(m), anna.participantId)).toEqual([
                    { emoji: '👍', by: [boris.participantId], mine: false },
                    { emoji: '❤️', by: [clara.participantId], mine: false }
                ])
                expect(checkDiscussionIntegrity(m.contents.discussion)).toEqual([])
            }
            expect(JSON.stringify(a.contents.discussion.threads)).toBe(
                JSON.stringify(b.contents.discussion.threads)
            )
            // FR-234: no change of the discussion time for a reaction
            expect(a.contents.discussion.updatedAt).toBe(b.contents.discussion.updatedAt)
        })
    })

    it('an attachment travels in parts and is stored once by hash (FR-261, FR-266)', async () => {
        await withTempDir(async (dir) => {
            const members = await group(dir)
            const [a, b, c] = members as [Member, Member, Member]
            const file = fileOf(PART_SIZE + 1000, 7)
            a.blobs.set(file.attachment.sha256, file.data)
            await say(a, 'Вот план', [file.attachment])
            await scanAll(members)
            for (const m of [b, c]) {
                expect(first(m).attachments).toEqual([file.attachment])
                expect(Buffer.from(m.blobs.get(file.attachment.sha256)!).equals(file.data)).toBe(
                    true
                )
            }
            // all copies confirmed and removed from the shared folder
            expect(a.state.data.outbox.every((i) => i.deliveredAt !== null)).toBe(true)
        })
    })

    it('a member with a smaller limit gets the message without the file, and the file after raising the limit (FR-268a)', async () => {
        await withTempDir(async (dir) => {
            const members = await group(dir, [30, 5, 30])
            const [a, b, c] = members as [Member, Member, Member]
            await scanAll(members, 2)
            // Boris told the others his limit (FR-268)
            expect(a.state.data.peerLimits[boris.participantId]?.maxFileMb).toBe(5)
            expect(await a.sync.receiversBelow(6 * MB)).toEqual([
                { participantId: boris.participantId, maxFileMb: 5 }
            ])
            const file = fileOf(6 * MB, 3)
            a.blobs.set(file.attachment.sha256, file.data)
            await say(a, 'Большой файл', [file.attachment])
            await scanAll(members)
            expect(first(b).attachments).toEqual([file.attachment])
            expect(b.blobs.has(file.attachment.sha256)).toBe(false)
            expect(c.blobs.has(file.attachment.sha256)).toBe(true)
            expect(Object.keys(b.state.data.deferred).length).toBe(2)
            b.limitMb = 10
            await b.sync.announceLimits()
            await scanAll(members)
            expect(b.blobs.has(file.attachment.sha256)).toBe(true)
            expect(b.state.data.deferred).toEqual({})
            expect(a.state.data.peerLimits[boris.participantId]?.maxFileMb).toBe(10)
        })
    })

    it('the default limit is not announced (no new event type for older members)', async () => {
        await withTempDir(async (dir) => {
            const members = await group(dir)
            for (const m of members)
                expect(
                    m.state.data.outbox.some((i) => i.envelope.type === 'member.limits.set')
                ).toBe(false)
        })
    })
})

describe('reactions and attachments: apply rules', () => {
    const base = (): DocumentContents => {
        const ctx = makeCtx('x')
        const c = newDocumentContents(ctx, { title: 'T', author: anna })
        const d = appendMessage(ctx, c.discussion, {
            threadId: mainThread(c.discussion).threadId,
            author: anna,
            content: simple('m')
        }).discussion
        return { ...c, discussion: d }
    }
    const ev = <T extends VerifiedEvent['type']>(
        type: T,
        payload: unknown,
        senderId: string,
        clock: number
    ): VerifiedEvent =>
        ({
            eventId: randomUUID(),
            type,
            senderId,
            clock,
            createdAt: now(),
            payload
        }) as VerifiedEvent

    it('reaction.set waits for its message and keeps the later change', () => {
        const c = base()
        const id = mainThread(c.discussion).messages[0]!.messageId
        expect(
            applyEvent(c, ev('reaction.set', { messageId: 'x', emoji: '👍', on: true }, 'p-b', 5))
                .status
        ).toBe('pending')
        const on = applyEvent(
            c,
            ev('reaction.set', { messageId: id, emoji: '👍', on: true }, 'p-b', 5)
        )
        expect(on.status).toBe('applied')
        const after = on.status === 'applied' ? on.contents : c
        const older = applyEvent(
            after,
            ev('reaction.set', { messageId: id, emoji: '👍', on: false }, 'p-b', 4)
        )
        expect(older.status).toBe('duplicate')
        // the same clock: a removal wins, so both orders give the same result
        const m = mainThread(c.discussion).messages[0]!
        const x = withReaction(withReaction(m, { emoji: '😂', by: 'p', on: true, clock: 3 }), {
            emoji: '😂',
            by: 'p',
            on: false,
            clock: 3
        })
        const y = withReaction(withReaction(m, { emoji: '😂', by: 'p', on: false, clock: 3 }), {
            emoji: '😂',
            by: 'p',
            on: true,
            clock: 3
        })
        expect(x.reactions).toEqual(y.reactions)
    })

    it('message.attachments only from the author, once', () => {
        const c = base()
        const id = mainThread(c.discussion).messages[0]!.messageId
        const payload = {
            messageId: id,
            attachments: [
                { name: 'a.txt', size: 3, type: 'text/plain', sha256: 'a'.repeat(64), parts: [] }
            ]
        }
        expect(applyEvent(c, ev('message.attachments', payload, 'p-other', 9)).status).toBe(
            'rejected'
        )
        const ok = applyEvent(c, ev('message.attachments', payload, anna.participantId, 9))
        expect(ok.status).toBe('applied')
        if (ok.status !== 'applied') return
        expect(
            applyEvent(ok.contents, ev('message.attachments', payload, anna.participantId, 9))
                .status
        ).toBe('duplicate')
    })

    it('refuses unsafe file names and unknown fields in the new events', () => {
        const env = (payload: unknown) => ({
            protocolVersion: 1,
            eventId: randomUUID(),
            type: 'message.attachments',
            conversationId: DOC,
            senderId: 'p-a',
            recipientId: 'p-b',
            senderSeq: 1,
            clock: 1,
            createdAt: '2026-11-16T10:00:00Z',
            payload
        })
        const att = (name: string) => ({
            messageId: 'm',
            attachments: [{ name, size: 0, type: '', sha256: 'b'.repeat(64), parts: [] }]
        })
        expect(checkEnvelope(env(att('ok.txt'))).status).toBe('ok')
        for (const bad of ['..\\x.exe', 'a/b', 'evil‮txt.exe', 'line\nbreak', ' x', 'x.'])
            expect(checkEnvelope(env(att(bad))).status).toBe('invalid')
        expect(
            checkEnvelope({
                ...env(att('ok.txt')),
                type: 'reaction.set',
                payload: { messageId: 'm', emoji: '👍', on: true, x: 1 }
            }).status
        ).toBe('invalid')
        expect(
            checkEnvelope({
                ...env(att('ok.txt')),
                type: 'reaction.set',
                payload: { messageId: 'm', emoji: '🙂', on: true }
            }).status
        ).toBe('invalid')
    })
})
