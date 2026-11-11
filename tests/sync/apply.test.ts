import { describe, expect, it } from 'vitest'
import {
    appendMessage,
    createBranch,
    ensureParticipant,
    mainThread,
    markMessageRead,
    readStateAfterBranch,
    readStateAfterSend,
    setThreadStatus,
    setThreadTitle,
    type Author
} from '@shared/domain'
import type { DocumentContents, RichDoc } from '@shared/types'
import {
    applyAll,
    applyEvent,
    eventsFromChange,
    isComplete,
    knownParticipants,
    loadingMessage,
    normalizeSynced,
    partRanges,
    withLocalDisplayName,
    type LocalEvent,
    type MessageSentPayload,
    type VerifiedEvent
} from '@shared/sync'
import { checkDiscussionIntegrity, type SyncInfo } from '@shared/validation'
import { newDocumentContents } from '../../src/main/document/factory'
import { anna, boris, clara, makeCtx, simple } from '../helpers/fixtures'

const key = 'A'.repeat(43) + '='
const memberOf = (a: Author, addedBy = anna.participantId) => ({
    participantId: a.participantId,
    displayName: a.displayName,
    signingPublicKey: key,
    encryptionPublicKey: key,
    fingerprint: '0123456789ABCDEF0123456789ABCDEF',
    addedBy,
    addedAt: '2026-11-10T10:00:00Z'
})
const roster: SyncInfo = {
    protocolVersion: 1,
    members: [anna, boris, clara].map((a) => memberOf(a))
}

/** The same synchronized discussion as every member gets it from the invitation. */
function sharedStart(): DocumentContents {
    const ctx = makeCtx('start')
    const c = newDocumentContents(ctx, { title: 'Общее', author: anna })
    return normalizeSynced({ ...c, sync: roster })
}

let seq = 0
function verified(e: LocalEvent, senderId: string): VerifiedEvent {
    return { eventId: `e-${++seq}`, senderId, ...e } as VerifiedEvent
}

/** Comparable form: every member must end with exactly this (updatedAt is display information). */
function view(c: DocumentContents): unknown {
    const n = normalizeSynced(c)
    return { ...n, discussion: { ...n.discussion, updatedAt: '' } }
}

describe('apply rules (sync-protocol.md 7 to 9)', () => {
    it('applies a remote message in clock order and ignores it the second time', () => {
        const start = sharedStart()
        const main = mainThread(start.discussion).threadId
        const ctx = makeCtx('b')
        const { discussion } = appendMessage(ctx, start.discussion, {
            threadId: main,
            author: boris,
            content: simple('Привет от Бориса')
        })
        const [event] = eventsFromChange(
            start,
            { ...start, discussion },
            boris.participantId,
            ctx.now()
        )
        expect(event!.type).toBe('message.sent')
        const e = verified(event!, boris.participantId)

        const r = applyEvent(start, e)
        if (r.status !== 'applied') throw new Error(r.status)
        const m = mainThread(r.contents.discussion).messages[0]!
        expect(m).toMatchObject({ authorId: 'p-boris', clock: 1, sequence: 0 })
        expect(r.contents.discussion.participants.map((p) => p.participantId)).toEqual([
            'p-anna',
            'p-boris'
        ])
        expect(checkDiscussionIntegrity(r.contents.discussion)).toEqual([])
        expect(applyEvent(r.contents, e).status).toBe('duplicate')
    })

    it('waits for a missing thread, source message, or image, then applies (section 9.3)', () => {
        const start = sharedStart()
        const main = mainThread(start.discussion).threadId
        const ctx = makeCtx('b')
        let c = start
        const step = (fn: (d: DocumentContents) => DocumentContents) => {
            const before = c
            c = normalizeSynced(fn(c))
            return eventsFromChange(before, c, boris.participantId, ctx.now()).map((e) =>
                verified(e, boris.participantId)
            )
        }
        const [m1] = step((x) => ({
            ...x,
            discussion: appendMessage(ctx, x.discussion, {
                threadId: main,
                author: boris,
                content: simple('один')
            }).discussion
        }))
        const sourceId = mainThread(c.discussion).messages[0]!.messageId
        let branchId = ''
        const [b1] = step((x) => {
            const r = createBranch(ctx, x.discussion, {
                sourceMessageId: sourceId,
                quoteText: 'один',
                author: boris
            })
            branchId = r.thread.threadId
            return { ...x, discussion: r.discussion }
        })
        const [m2] = step((x) => ({
            ...x,
            discussion: appendMessage(ctx, x.discussion, {
                threadId: branchId,
                author: boris,
                content: simple('в ветке')
            }).discussion
        }))
        const [s1] = step((x) => ({
            ...x,
            discussion: setThreadStatus(ctx, x.discussion, branchId, 'closed', boris.participantId)
        }))

        expect(applyEvent(start, m2!).status).toBe('pending')
        expect(applyEvent(start, b1!).status).toBe('pending')
        expect(applyEvent(start, s1!).status).toBe('pending')
        const r = applyAll(start, [s1!, m2!, b1!, m1!, m1!])
        expect(r.pending).toEqual([])
        expect(r.rejected).toEqual([])
        expect(r.applied.map((a) => a.event.type)).toContain('branch.status.set')
        expect(view(r.contents)).toEqual(view(c))
    })

    it('accepts a message for a branch that is closed here; the branch stays closed (D-07)', () => {
        const start = sharedStart()
        const ctx = makeCtx('x')
        const main = mainThread(start.discussion).threadId
        let d = appendMessage(ctx, start.discussion, {
            threadId: main,
            author: anna,
            content: simple('a')
        }).discussion
        const source = mainThread(d).messages[0]!.messageId
        const br = createBranch(ctx, d, { sourceMessageId: source, quoteText: 'a', author: anna })
        d = setThreadStatus(ctx, br.discussion, br.thread.threadId, 'closed', anna.participantId)
        const here = normalizeSynced({ ...start, discussion: d })

        const remote: VerifiedEvent<'message.sent'> = {
            eventId: 'e-closed',
            type: 'message.sent',
            senderId: boris.participantId,
            clock: 2,
            createdAt: '2026-11-10T10:00:00Z',
            payload: {
                message: {
                    messageId: 'm-late',
                    threadId: br.thread.threadId,
                    authorDisplayName: 'Борис',
                    createdAt: '2026-11-10T10:00:00Z',
                    content: simple('написал, пока ветка была открыта'),
                    assetReferences: []
                },
                images: [],
                parts: []
            }
        }
        const r = applyEvent(here, remote)
        if (r.status !== 'applied') throw new Error(r.status)
        const branch = r.contents.discussion.threads.find((t) => t.threadId === br.thread.threadId)!
        expect(branch.status).toBe('closed')
        expect(branch.messages.map((m) => m.messageId)).toEqual(['m-late'])
    })

    it('last writer wins for branch status and title, in any order (D-24)', () => {
        const start = sharedStart()
        const ctx = makeCtx('y')
        const main = mainThread(start.discussion).threadId
        const d = appendMessage(ctx, start.discussion, {
            threadId: main,
            author: anna,
            content: simple('a')
        }).discussion
        const br = createBranch(ctx, d, {
            sourceMessageId: mainThread(d).messages[0]!.messageId,
            quoteText: 'a',
            author: anna
        })
        const base = normalizeSynced({ ...start, discussion: br.discussion })
        const t = br.thread.threadId
        const ev = (senderId: string, clock: number, status: 'open' | 'closed', title: string) =>
            [
                {
                    eventId: `s${senderId}${clock}`,
                    type: 'branch.status.set',
                    senderId,
                    clock,
                    createdAt: 'x',
                    payload: { threadId: t, status }
                },
                {
                    eventId: `t${senderId}${clock}`,
                    type: 'branch.title.set',
                    senderId,
                    clock,
                    createdAt: 'x',
                    payload: { threadId: t, title }
                }
            ] as VerifiedEvent[]
        const events = [
            ...ev('p-boris', 5, 'closed', 'Борис'),
            ...ev('p-clara', 5, 'open', 'Клара'), // same clock: higher participant ID wins
            ...ev('p-anna', 4, 'closed', 'Анна')
        ]
        const results = [
            events,
            [...events].reverse(),
            [events[2]!, events[5]!, events[0]!, events[4]!, events[1]!, events[3]!]
        ].map((order) => applyAll(base, order).contents)
        for (const r of results) {
            const branch = r.discussion.threads.find((x) => x.threadId === t)!
            expect(branch).toMatchObject({
                status: 'open',
                title: 'Клара',
                statusSet: { clock: 5, by: 'p-clara' }
            })
        }
    })

    it('keeps read state as a union, without the sender’s own messages (D-08)', () => {
        const start = sharedStart()
        const r = applyAll(start, [
            {
                eventId: 'r1',
                type: 'readstate.added',
                senderId: 'p-boris',
                clock: 3,
                createdAt: 'x',
                payload: { messageIds: ['m2', 'm1'] }
            },
            {
                eventId: 'r2',
                type: 'readstate.added',
                senderId: 'p-boris',
                clock: 4,
                createdAt: 'x',
                payload: { messageIds: ['m1', 'm3'] }
            }
        ] as VerifiedEvent[])
        expect(r.contents.readState['p-boris']).toEqual(['m1', 'm2', 'm3'])
        expect(r.duplicates).toEqual([])
    })

    it('delivery.added changes only the entry of the sender and is a set union (D-41)', () => {
        const start = sharedStart()
        const r = applyAll(start, [
            {
                eventId: 'd1',
                type: 'delivery.added',
                senderId: 'p-boris',
                clock: 3,
                createdAt: 'x',
                payload: { messageIds: ['m2', 'm1'] }
            },
            {
                eventId: 'd2',
                type: 'delivery.added',
                senderId: 'p-boris',
                clock: 4,
                createdAt: 'x',
                payload: { messageIds: ['m1', 'm3'] }
            }
        ] as VerifiedEvent[])
        expect(r.contents.delivery).toEqual({ 'p-boris': ['m1', 'm2', 'm3'] })
        expect(r.contents.readState['p-boris']).toBeUndefined()
    })

    it('adds members only when the sender added them, and updates names by clock (D-12, D-13)', () => {
        const start = sharedStart()
        const dora = memberOf({ participantId: 'p-dora', displayName: 'Дора' }, 'p-boris')
        const ok = applyEvent(start, {
            eventId: 'a',
            type: 'member.added',
            senderId: 'p-boris',
            clock: 1,
            createdAt: 'x',
            payload: { member: dora }
        } as VerifiedEvent)
        const forged = applyEvent(start, {
            eventId: 'b',
            type: 'member.added',
            senderId: 'p-clara',
            clock: 1,
            createdAt: 'x',
            payload: { member: dora }
        } as VerifiedEvent)
        expect(ok.status).toBe('applied')
        expect(forged.status).toBe('rejected')
        if (ok.status !== 'applied') return
        expect(knownParticipants(ok.contents).map((p) => p.participantId)).toContain('p-dora')

        const rename = (clock: number, displayName: string) =>
            ({
                eventId: `n${clock}`,
                type: 'profile.updated',
                senderId: 'p-boris',
                clock,
                createdAt: 'x',
                payload: { displayName }
            }) as VerifiedEvent
        const a = applyAll(ok.contents, [rename(7, 'Боря'), rename(3, 'Борис Б.')]).contents
        const b = applyAll(ok.contents, [rename(3, 'Борис Б.'), rename(7, 'Боря')]).contents
        expect(view(a)).toEqual(view(b))
        expect(a.sync!.members.find((m) => m.participantId === 'p-boris')!.displayName).toBe('Боря')
    })

    it('rejects a main-thread close, a branch from another thread, and inconsistent images', () => {
        const start = sharedStart()
        const main = mainThread(start.discussion).threadId
        expect(
            applyEvent(start, {
                eventId: 'c',
                type: 'branch.status.set',
                senderId: 'p-boris',
                clock: 1,
                createdAt: 'x',
                payload: { threadId: main, status: 'closed' }
            } as VerifiedEvent).status
        ).toBe('rejected')
        const withImage: MessageSentPayload = {
            message: {
                messageId: 'm-img',
                threadId: main,
                authorDisplayName: 'Борис',
                createdAt: 'x',
                content: {
                    type: 'doc',
                    content: [
                        {
                            type: 'paragraph',
                            content: [{ type: 'image', attrs: { assetId: 'a'.repeat(64) } }]
                        }
                    ]
                } as RichDoc,
                assetReferences: []
            },
            images: [],
            parts: []
        }
        expect(
            applyEvent(start, {
                eventId: 'i',
                type: 'message.sent',
                senderId: 'p-boris',
                clock: 1,
                createdAt: 'x',
                payload: withImage
            } as VerifiedEvent).status
        ).toBe('rejected')
    })

    it('registers new images without bytes and reports them for writing', () => {
        const start = sharedStart()
        const main = mainThread(start.discussion).threadId
        const id = 'b'.repeat(64)
        const payload: MessageSentPayload = {
            message: {
                messageId: 'm-img',
                threadId: main,
                authorDisplayName: 'Борис',
                createdAt: 'x',
                content: {
                    type: 'doc',
                    content: [
                        { type: 'paragraph', content: [{ type: 'image', attrs: { assetId: id } }] }
                    ]
                } as RichDoc,
                assetReferences: [id]
            },
            images: [{ assetId: id, mediaType: 'image/webp', size: 10 }],
            parts: []
        }
        const r = applyEvent(start, {
            eventId: 'i',
            type: 'message.sent',
            senderId: 'p-boris',
            clock: 1,
            createdAt: 'x',
            payload
        } as VerifiedEvent)
        if (r.status !== 'applied') throw new Error(r.status)
        expect(r.newAssetIds).toEqual([id])
        expect(r.contents.discussion.assets[0]).toMatchObject({
            path: `assets/images/${id}.webp`,
            size: 10
        })
        // a later message that uses an image not yet seen here waits for it
        const again = { ...payload, message: { ...payload.message, messageId: 'm-2' }, images: [] }
        expect(
            applyEvent(start, {
                eventId: 'j',
                type: 'message.sent',
                senderId: 'p-boris',
                clock: 2,
                createdAt: 'x',
                payload: again
            } as VerifiedEvent).status
        ).toBe('pending')
        expect(
            applyEvent(r.contents, {
                eventId: 'j',
                type: 'message.sent',
                senderId: 'p-boris',
                clock: 2,
                createdAt: 'x',
                payload: again
            } as VerifiedEvent).status
        ).toBe('applied')
    })

    it('a local name change updates the roster with a new clock and becomes profile.updated', () => {
        const start = sharedStart()
        const after = withLocalDisplayName(start, 'p-anna', 'Аня')
        const [e] = eventsFromChange(start, after, 'p-anna', 'now')
        expect(e).toMatchObject({ type: 'profile.updated', payload: { displayName: 'Аня' } })
        expect(withLocalDisplayName(after, 'p-anna', 'Аня')).toBe(after)
    })
})

describe('loading messages (D-30, D-37)', () => {
    it('reports parts and bytes, and the content once present', () => {
        const id = 'c'.repeat(64)
        const payload = {
            message: {
                messageId: 'm',
                threadId: 't',
                authorDisplayName: 'Б',
                createdAt: 'x',
                assetReferences: [id]
            },
            images: [{ assetId: id, mediaType: 'image/png' as const, size: 6 }],
            parts: [
                { partId: 'p0', kind: 'content' as const, index: 0, size: 2, sha256: 'x' },
                {
                    partId: 'p1',
                    kind: 'image' as const,
                    assetId: id,
                    index: 0,
                    size: 4,
                    sha256: 'x'
                },
                {
                    partId: 'p2',
                    kind: 'image' as const,
                    assetId: id,
                    index: 1,
                    size: 2,
                    sha256: 'x'
                }
            ]
        } as MessageSentPayload
        const l = loadingMessage('p-b', 9, payload, new Set(['p0', 'p2']), simple('текст'))
        expect(l).toMatchObject({
            partsTotal: 3,
            partsReceived: 2,
            bytesTotal: 8,
            bytesReceived: 4,
            clock: 9
        })
        expect(l.images[0]).toMatchObject({
            partsTotal: 2,
            partsReceived: 1,
            bytesTotal: 6,
            bytesReceived: 2
        })
        expect(l.content).not.toBeNull()
        expect(isComplete(payload, new Set(['p0', 'p2']))).toBe(false)
        expect(isComplete(payload, new Set(['p0', 'p1', 'p2']))).toBe(true)
    })

    it('splits payloads into 4 MiB ranges', () => {
        expect(partRanges(10, 4)).toEqual([
            { index: 0, start: 0, end: 4 },
            { index: 1, start: 4, end: 8 },
            { index: 2, start: 8, end: 10 }
        ])
        expect(partRanges(4 * 1024 * 1024)).toHaveLength(1)
        expect(() => partRanges(0)).toThrow()
    })
})

// --- Property test: random changes on three members converge ------------------------------------------------

function rng(seed: number): () => number {
    let s = seed >>> 0
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0
        return s / 2 ** 32
    }
}

interface Member {
    author: Author
    contents: DocumentContents
    outbox: VerifiedEvent[]
    ctx: ReturnType<typeof makeCtx>
}

function localChange(m: Member, change: (c: DocumentContents) => DocumentContents | null): void {
    const before = m.contents
    let next: DocumentContents | null
    try {
        next = change(before)
    } catch {
        return // e.g. writing in a closed branch: the UI would not allow it
    }
    if (!next) return
    const after = normalizeSynced({
        ...next,
        discussion: ensureParticipant(next.discussion, m.author)
    })
    m.contents = after
    for (const e of eventsFromChange(before, after, m.author.participantId, m.ctx.now()))
        m.outbox.push(verified(e, m.author.participantId))
}

function randomStep(m: Member, rand: () => number): void {
    const d = m.contents.discussion
    const threads = d.threads
    const thread = threads[Math.floor(rand() * threads.length)]!
    const allMessages = threads.flatMap((t) => t.messages)
    const pick = <T>(xs: readonly T[]): T | undefined => xs[Math.floor(rand() * xs.length)]
    const id = m.author.participantId
    const r = rand()
    m.ctx.tick()
    if (r < 0.4)
        localChange(m, (c) => ({
            ...c,
            readState: readStateAfterSend(c.discussion, c.readState, id, thread.threadId),
            discussion: appendMessage(m.ctx, c.discussion, {
                threadId: thread.threadId,
                author: m.author,
                content: simple(`${m.author.displayName} ${r.toFixed(4)}`)
            }).discussion
        }))
    else if (r < 0.55) {
        const source = pick(allMessages)
        if (!source) return
        localChange(m, (c) => ({
            ...c,
            readState: readStateAfterBranch(c.discussion, c.readState, id, source.messageId),
            discussion: createBranch(m.ctx, c.discussion, {
                sourceMessageId: source.messageId,
                quoteText: 'фрагмент',
                author: m.author
            }).discussion
        }))
    } else if (r < 0.7) {
        if (thread.parentThreadId === undefined) return
        localChange(m, (c) => ({
            ...c,
            discussion: setThreadStatus(
                m.ctx,
                c.discussion,
                thread.threadId,
                rand() < 0.5 ? 'open' : 'closed',
                id
            )
        }))
    } else if (r < 0.8) {
        localChange(m, (c) => ({
            ...c,
            discussion: setThreadTitle(
                m.ctx,
                c.discussion,
                thread.threadId,
                rand() < 0.3 ? '' : `T${r.toFixed(3)}`,
                id
            )
        }))
    } else if (r < 0.95) {
        const target = pick(allMessages.filter((x) => x.authorId !== id))
        if (!target) return
        localChange(m, (c) => ({
            ...c,
            readState: markMessageRead(c.discussion, c.readState, id, target.messageId)
        }))
    } else
        localChange(m, (c) =>
            withLocalDisplayName(c, id, `${m.author.displayName}-${r.toFixed(2)}`)
        )
}

describe('convergence (D-04, D-05, D-24)', () => {
    it('three members with random changes and random delivery end with the same discussion', () => {
        for (let seed = 1; seed <= 200; seed++) {
            const rand = rng(seed)
            const members: Member[] = [anna, boris, clara].map((author) => ({
                author,
                contents: sharedStart(),
                outbox: [],
                ctx: makeCtx(`${author.participantId}-${seed}`)
            }))
            const delivered = new Map<Member, Set<string>>(members.map((m) => [m, new Set()]))
            const inbox = new Map<Member, VerifiedEvent[]>(members.map((m) => [m, []]))

            // rounds: some members change things, some events are delivered (in random order, sometimes twice)
            for (let round = 0; round < 25; round++) {
                for (const m of members) if (rand() < 0.7) randomStep(m, rand)
                for (const from of members) {
                    for (const e of from.outbox)
                        for (const to of members)
                            if (to !== from && rand() < 0.5) inbox.get(to)!.push(e)
                }
                for (const m of members) {
                    const queue = inbox.get(m)!
                    const take = queue.splice(0, Math.floor(rand() * (queue.length + 1)))
                    take.sort(() => rand() - 0.5)
                    if (rand() < 0.3 && take.length > 0) take.push(take[0]!) // duplicate file
                    const r = applyAll(m.contents, take)
                    m.contents = r.contents
                    for (const e of [...r.applied.map((a) => a.event), ...r.duplicates])
                        delivered.get(m)!.add(e.eventId)
                    expect(r.rejected, `seed ${seed}`).toEqual([])
                    queue.push(...r.pending)
                }
            }
            // finally every member gets everything it has not seen yet, in random order
            for (const m of members) {
                const missing = members
                    .filter((x) => x !== m)
                    .flatMap((x) => x.outbox)
                    .filter((e) => !delivered.get(m)!.has(e.eventId))
                    .sort(() => rand() - 0.5)
                const r = applyAll(m.contents, [...inbox.get(m)!, ...missing])
                expect(r.pending, `seed ${seed}`).toEqual([])
                expect(r.rejected, `seed ${seed}`).toEqual([])
                m.contents = r.contents
                expect(checkDiscussionIntegrity(m.contents.discussion), `seed ${seed}`).toEqual([])
            }
            expect(view(members[1]!.contents), `seed ${seed}`).toEqual(view(members[0]!.contents))
            expect(view(members[2]!.contents), `seed ${seed}`).toEqual(view(members[0]!.contents))
        }
    })
})
