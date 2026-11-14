import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
    appendMessage,
    createBranch,
    ensureParticipant,
    mainThread,
    readStateAfterSend,
    setThreadStatus,
    type Author
} from '@shared/domain'
import type { DocumentContents, RichDoc } from '@shared/types'
import { eventsFromChange, normalizeSynced, type Envelope } from '@shared/sync'
import { checkDiscussionIntegrity, type SyncInfo } from '@shared/validation'
import { b64, fingerprintOf, fromB64 } from '../../src/main/crypto/identity'
import { getSodium } from '../../src/main/crypto/sodium'
import { sealEvent, sha256Hex } from '../../src/main/crypto/envelope'
import { newDocumentContents } from '../../src/main/document/factory'
import { ConversationSync, type DocumentPort } from '../../src/main/sync/conversationSync'
import { SyncState } from '../../src/main/sync/syncState'
import { FolderTransport, type FileOps } from '../../src/main/transport/folderTransport'
import { anna, boris, clara, makeCtx, simple, withTempDir } from '../helpers/fixtures'

const DOC = 'doc-shared'

interface Member {
    author: Author
    contents: DocumentContents
    images: Map<string, Uint8Array>
    sync: ConversationSync
    state: SyncState
    transport: FolderTransport
    ctx: ReturnType<typeof makeCtx>
    stateDir: string
    keys: {
        sign: (d: Uint8Array) => Promise<Uint8Array>
        open: (s: Uint8Array) => Promise<Uint8Array | null>
    }
    writes: number
    /** IDs reported by onNewMessages, one list per report (notifications, D-33). */
    arrived: string[][]
}

let clockMs = Date.parse('2026-11-11T10:00:00Z')
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

class FailingDeletes extends FolderTransport {
    override async delete(): Promise<'deleted' | 'missing' | 'failed'> {
        return 'failed'
    }
}

async function group(
    dir: string,
    options: { exdev?: boolean; failingDeletes?: Author[] } = {}
): Promise<{ members: Member[]; root: string }> {
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
            addedAt: '2026-11-11T09:00:00Z'
        }))
    }
    const start = normalizeSynced({
        ...newDocumentContents(makeCtx('s'), { title: 'Общее', author: anna }),
        sync: roster
    })
    start.manifest.documentId = DOC
    const exdev: FileOps = {
        rename: async () => {
            throw Object.assign(new Error('cross-device'), { code: 'EXDEV' })
        },
        copyFile: (a, b) => fs.copyFile(a, b)
    }
    const members: Member[] = []
    for (const [i, author] of people.entries()) {
        const stateDir = join(dir, 'local', author.participantId)
        const Transport = options.failingDeletes?.includes(author)
            ? FailingDeletes
            : FolderTransport
        const transport = new Transport(
            root,
            join(stateDir, 'staging'),
            options.exdev ? exdev : undefined
        )
        const m = {
            author,
            contents: structuredClone(start),
            images: new Map(),
            ctx: makeCtx(author.participantId),
            stateDir,
            transport,
            keys: keys[i]!.own,
            writes: 0
        } as unknown as Member
        await connect(m)
        members.push(m)
    }
    for (const m of members) await m.sync.start()
    return { members, root }
}

async function connect(m: Member): Promise<void> {
    const port: DocumentPort = {
        read: async () => m.contents,
        update: async (change) => {
            const r = change(m.contents)
            if (!r) return
            for (const img of r.images) m.images.set(img.assetId, img.data)
            m.contents = r.contents
            m.writes++
        },
        imageBytes: async (id) => m.images.get(id) ?? null
    }
    m.state = await SyncState.open(m.stateDir, DOC, m.author.participantId, () => clockMs)
    m.sync = new ConversationSync({
        conversationId: DOC,
        ownId: m.author.participantId,
        transport: m.transport,
        state: m.state,
        keys: m.keys,
        document: port,
        now,
        newId: randomUUID,
        maxFileBytes: () => 30 * 1024 * 1024,
        appVersion: '1.2.0',
        stableMs: 0,
        onNewMessages: (messages) => (m.arrived ??= []).push(messages.map((x) => x.messageId))
    })
}

/** A local change, as the document session will do it (Phase 8). */
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

async function say(
    m: Member,
    text: string,
    threadId = mainThread(m.contents.discussion).threadId
): Promise<void> {
    await change(m, (c) => ({
        ...c,
        readState: readStateAfterSend(c.discussion, c.readState, m.author.participantId, threadId),
        discussion: appendMessage(m.ctx, c.discussion, {
            threadId,
            author: m.author,
            content: simple(text)
        }).discussion
    }))
}

const texts = (c: DocumentContents) =>
    mainThread(c.discussion).messages.map(
        (x) => (x.content.content[0] as { content: Array<{ text: string }> }).content[0]!.text
    )

function view(c: DocumentContents): unknown {
    const n = normalizeSynced(c)
    return { ...n, discussion: { ...n.discussion, updatedAt: '' } }
}

/** Scans until a full round changes nothing (deliveries and receipts take an extra round, D-40). */
async function scanAll(members: Member[], rounds = 8): Promise<void> {
    for (let i = 0; i < rounds; i++) {
        let busy = false
        for (const m of members) {
            const r = await m.sync.scan()
            if (r.applied > 0 || r.receipts > 0) busy = true
        }
        if (!busy && i > 0) return
    }
}

async function filesIn(root: string): Promise<string[]> {
    const out: string[] = []
    try {
        for (const e of await fs.readdir(root, { withFileTypes: true, recursive: true }))
            if (e.isFile()) out.push(join(e.parentPath, e.name).slice(root.length + 1))
    } catch {
        // missing folder
    }
    return out.sort()
}

function pngOf(size: number): Uint8Array {
    const head = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64'
    )
    const out = new Uint8Array(Math.max(size, head.length))
    out.set(head, 0)
    for (let i = head.length; i < out.length; i++) out[i] = (i * 7) & 0xff
    return out
}

function imageMessage(assetId: string, text: string): RichDoc {
    return {
        type: 'doc',
        content: [
            {
                type: 'paragraph',
                content: [
                    { type: 'text', text },
                    { type: 'image', attrs: { assetId } }
                ]
            }
        ]
    } as RichDoc
}

describe('sync service with three members (design 13 to 18)', () => {
    it('delivers messages, branches, and status in both directions and cleans up the shared folder', async () => {
        await withTempDir(async (dir) => {
            const { members, root } = await group(dir)
            const [a, b, c] = members as [Member, Member, Member]
            await say(a, 'Привет всем')
            await b.sync.scan() // Boris sees Anna's message before he answers it
            await say(b, 'Привет, Анна')
            await scanAll(members)
            const source = mainThread(c.contents.discussion).messages[0]!.messageId
            let branchId = ''
            await change(c, (x) => {
                const r = createBranch(c.ctx, x.discussion, {
                    sourceMessageId: source,
                    quoteText: 'Привет',
                    author: clara
                })
                branchId = r.thread.threadId
                return { ...x, discussion: r.discussion }
            })
            await say(c, 'ответ в ветке', branchId)
            await change(a, (x) => x) // nothing
            await scanAll(members)
            await change(b, (x) => ({
                ...x,
                discussion: setThreadStatus(b.ctx, x.discussion, branchId, 'closed', 'p-boris')
            }))
            await scanAll(members)

            for (const m of members) {
                expect(checkDiscussionIntegrity(m.contents.discussion)).toEqual([])
                expect(view(m.contents)).toEqual(view(a.contents))
            }
            const branch = a.contents.discussion.threads.find((t) => t.threadId === branchId)!
            expect(branch).toMatchObject({ status: 'closed' })
            expect(branch.messages).toHaveLength(1)
            expect(new Set(texts(a.contents))).toEqual(new Set(['Привет всем', 'Привет, Анна']))
            // read state travelled: Boris read Anna's message by answering it (FR-112)
            expect(a.contents.readState['p-boris']).toContain(
                mainThread(a.contents.discussion).messages.find((m) => m.authorId === 'p-anna')!
                    .messageId
            )

            // every file was confirmed and deleted; only the marker and empty folders remain
            expect(await filesIn(root)).toEqual(['branchchat-sync.json'])
            for (const m of members)
                expect(m.state.data.outbox.every((i) => i.deliveredAt !== null)).toBe(true)
        })
    })

    it('sends images in parts, shows the message as loading, and works across drives (D-30, D-39)', async () => {
        await withTempDir(async (dir) => {
            const { members, root } = await group(dir, { exdev: true })
            const [a, b] = members as [Member, Member, Member]
            const img = pngOf(9 * 1024 * 1024) // three parts
            const id = sha256Hex(img)
            a.images.set(id, img)
            await change(a, (x) => ({
                ...x,
                discussion: appendMessage(
                    a.ctx,
                    {
                        ...x.discussion,
                        assets: [
                            ...x.discussion.assets,
                            {
                                assetId: id,
                                path: `assets/images/${id}.png`,
                                mediaType: 'image/png',
                                size: img.length,
                                sha256: id
                            }
                        ]
                    },
                    {
                        threadId: mainThread(x.discussion).threadId,
                        author: anna,
                        content: imageMessage(id, 'Смотрите')
                    }
                ).discussion
            }))
            const parts = (await filesIn(join(root, 'inbox', 'p-boris'))).filter((n) =>
                n.endsWith('.bcpart')
            )
            expect(parts).toHaveLength(3)

            // hold back one part: Boris sees a loading message with its text
            const held = join(root, 'inbox', 'p-boris', parts[0]!)
            const aside = join(dir, 'aside.bin')
            await fs.rename(held, aside)
            await b.sync.scan()
            expect(mainThread(b.contents.discussion).messages).toHaveLength(0)
            // a loading message raises no notification yet (D-38)
            expect(b.arrived ?? []).toEqual([])
            const [loading] = await b.sync.loadingMessages()
            expect(loading).toMatchObject({
                partsTotal: 3,
                partsReceived: 2,
                authorDisplayName: 'Анна'
            })
            expect(loading!.content).not.toBeNull()

            await fs.rename(aside, held)
            await b.sync.scan()
            expect(await b.sync.loadingMessages()).toEqual([])
            expect(mainThread(b.contents.discussion).messages).toHaveLength(1)
            expect(b.arrived).toEqual([[mainThread(b.contents.discussion).messages[0]!.messageId]])
            expect(sha256Hex(b.images.get(id)!)).toBe(id)
            // after the receipts, the parts are gone from the shared folder and from the local stores
            await scanAll(members)
            expect((await filesIn(root)).filter((n) => n.includes('p-boris'))).toEqual([])
        })
    })

    it('handles duplicates, conflict copies, and parts that arrive before their header', async () => {
        await withTempDir(async (dir) => {
            const { members, root } = await group(dir)
            const [a, b] = members as [Member, Member, Member]
            await say(a, 'один')
            const inbox = join(root, 'inbox', 'p-boris')
            const [file] = await filesIn(inbox)
            await fs.copyFile(
                join(inbox, file!),
                join(inbox, file!.replace('.bcmsg', ' (1).bcmsg'))
            )
            await b.sync.scan()
            await b.sync.scan()
            expect(texts(b.contents)).toEqual(['один'])
            expect(await filesIn(inbox)).toEqual([])

            // a part first, then its header
            const img = pngOf(5 * 1024 * 1024)
            const id = sha256Hex(img)
            a.images.set(id, img)
            await change(a, (x) => ({
                ...x,
                discussion: appendMessage(
                    a.ctx,
                    {
                        ...x.discussion,
                        assets: [
                            ...x.discussion.assets,
                            {
                                assetId: id,
                                path: `assets/images/${id}.png`,
                                mediaType: 'image/png',
                                size: img.length,
                                sha256: id
                            }
                        ]
                    },
                    {
                        threadId: mainThread(x.discussion).threadId,
                        author: anna,
                        content: imageMessage(id, 'два')
                    }
                ).discussion
            }))
            const header = (await filesIn(inbox)).find((n) => n.endsWith('.bcmsg'))!
            await fs.rename(join(inbox, header), join(dir, 'header'))
            await b.sync.scan()
            expect(await b.sync.loadingMessages()).toEqual([])
            await fs.rename(join(dir, 'header'), join(inbox, header))
            await b.sync.scan()
            expect(texts(b.contents)).toEqual(['один', 'два'])
        })
    })

    it('waits for an incomplete file and quarantines it only after 10 unchanged minutes (protocol 9.6)', async () => {
        await withTempDir(async (dir) => {
            const { members, root } = await group(dir)
            const [a, b] = members as [Member, Member, Member]
            await say(a, 'длинный путь')
            const inbox = join(root, 'inbox', 'p-boris')
            const [file] = await filesIn(inbox)
            const full = await fs.readFile(join(inbox, file!))
            // a copy across drives that has not finished yet
            await fs.writeFile(join(inbox, file!), full.subarray(0, full.length >> 1))
            await b.sync.scan()
            expect(b.state.data.quarantine).toEqual([])
            await fs.writeFile(join(inbox, file!), full)
            await b.sync.scan()
            expect(texts(b.contents)).toEqual(['длинный путь'])

            await say(a, 'оборвалось')
            const [second] = await filesIn(inbox)
            const bytes = await fs.readFile(join(inbox, second!))
            await fs.writeFile(join(inbox, second!), bytes.subarray(0, 40))
            await b.sync.scan()
            clockMs += 9 * 60_000
            await b.sync.scan()
            expect(b.state.data.quarantine).toEqual([])
            clockMs += 2 * 60_000
            await b.sync.scan()
            expect(b.state.data.quarantine.map((q) => q.name)).toEqual([second])
            // the file stays: only the owner's normal cleanup deletes files
            expect(await filesIn(inbox)).toEqual([second])
        })
    })

    it('keeps files that cannot be deleted as processed and does not apply them twice (D-19)', async () => {
        await withTempDir(async (dir) => {
            const { members, root } = await group(dir, { failingDeletes: [boris] })
            const [a, b] = members as [Member, Member, Member]
            await say(a, 'не удаляется')
            await b.sync.scan()
            await b.sync.scan()
            expect(texts(b.contents)).toEqual(['не удаляется'])
            expect(b.state.data.keptFiles).toHaveLength(1)
            // Anna got the receipt and deleted her own file from Boris's inbox
            await a.sync.scan()
            const left = await filesIn(join(root, 'inbox', 'p-boris'))
            expect(left.filter((n) => n.endsWith('.bcmsg'))).toEqual([])
            // one write for the message, one for Boris's own delivery entry
            expect(b.writes).toBe(2)
        })
    })

    it('recovers after a crash between applying an event and saving the state', async () => {
        await withTempDir(async (dir) => {
            const { members } = await group(dir)
            const [a, b] = members as [Member, Member, Member]
            await say(a, 'до сбоя')
            const stateFile = join(b.stateDir, 'state.json')
            const before = await fs.readFile(stateFile)
            await b.sync.scan()
            expect(texts(b.contents)).toEqual(['до сбоя'])
            // the discussion was saved, the sync state was not
            await fs.writeFile(stateFile, before)
            await connect(b)
            await b.sync.start()
            await b.sync.scan()
            expect(texts(b.contents)).toEqual(['до сбоя'])
            await a.sync.scan()
            const forBoris = a.state.data.outbox.filter((i) => i.recipientId === 'p-boris')
            expect(forBoris.length).toBeGreaterThan(0)
            expect(forBoris.every((i) => i.deliveredAt !== null)).toBe(true)
        })
    })

    it('refuses a forged sender and a reused sequence number (protocol 6, 9.1)', async () => {
        await withTempDir(async (dir) => {
            const { members, root } = await group(dir)
            const [a, b] = members as [Member, Member, Member]
            const fakeSender = async (keys: Member['keys'], stateName: string) =>
                new ConversationSync({
                    conversationId: DOC,
                    ownId: 'p-anna',
                    transport: new FolderTransport(root, join(dir, `${stateName}-staging`)),
                    state: await SyncState.open(join(dir, stateName), DOC, 'p-anna'),
                    keys,
                    document: {
                        read: async () => a.contents,
                        update: async () => undefined,
                        imageBytes: async () => null
                    },
                    now,
                    newId: randomUUID,
                    maxFileBytes: () => 30 * 1024 * 1024,
                    appVersion: '1.2.0',
                    stableMs: 0
                })
            const post = async (sender: ConversationSync, text: string) => {
                const before = a.contents
                a.ctx.tick()
                const after = normalizeSynced({
                    ...before,
                    discussion: appendMessage(a.ctx, before.discussion, {
                        threadId: mainThread(before.discussion).threadId,
                        author: anna,
                        content: simple(text)
                    }).discussion
                })
                await sender.send(eventsFromChange(before, after, 'p-anna', now()), after)
            }
            // Mallory has folder access and Boris's public key, and claims to be Anna
            const mallory = await makeKeys()
            await post(await fakeSender(mallory.own, 'mallory'), 'подделка')
            await b.sync.scan()
            expect(texts(b.contents)).toEqual([])
            // D-32: a bad signature of a known member waits for the grace time (new keys can come later)
            expect(b.state.data.quarantine).toEqual([])
            clockMs += 11 * 60_000
            await b.sync.scan()
            expect(texts(b.contents)).toEqual([])
            expect(b.state.data.quarantine.map((q) => q.reason)).toEqual(['signature is not valid'])

            // a real event, then another event that reuses its sequence number with a different event ID
            await say(a, 'настоящее')
            await b.sync.scan()
            const used = Object.keys(b.state.data.seqs['p-anna']!)[0]!
            const replay = await fakeSender(a.keys, 'replay')
            replay['state'].data.senderSeq = Number(used) - 1
            await post(replay, 'повтор номера')
            await b.sync.scan()
            expect(texts(b.contents)).toEqual(['настоящее'])
            expect(b.state.data.quarantine.map((q) => q.reason)).toContain(
                'sequence number used twice'
            )
        })
    })

    it('continues the sequence after the local sync state is lost (protocol 5)', async () => {
        await withTempDir(async (dir) => {
            const { members } = await group(dir)
            const [a, b] = members as [Member, Member, Member]
            await say(a, 'первое')
            await b.sync.scan()
            await fs.rm(a.stateDir, { recursive: true, force: true })
            clockMs += 1000
            await connect(a)
            await a.sync.start()
            await say(a, 'после переустановки')
            await b.sync.scan()
            expect(texts(b.contents)).toEqual(['первое', 'после переустановки'])
            expect(b.state.data.quarantine).toEqual([])
        })
    })

    it('a member cannot replace or block another member\u2019s part (security review)', async () => {
        await withTempDir(async (dir) => {
            const { members, root } = await group(dir)
            const [a, b, c] = members as [Member, Member, Member]
            const img = pngOf(5 * 1024 * 1024)
            const id = sha256Hex(img)
            a.images.set(id, img)
            await change(a, (x) => ({
                ...x,
                discussion: appendMessage(
                    a.ctx,
                    {
                        ...x.discussion,
                        assets: [
                            ...x.discussion.assets,
                            {
                                assetId: id,
                                path: `assets/images/${id}.png`,
                                mediaType: 'image/png',
                                size: img.length,
                                sha256: id
                            }
                        ]
                    },
                    {
                        threadId: mainThread(x.discussion).threadId,
                        author: anna,
                        content: imageMessage(id, 'настоящее')
                    }
                ).discussion
            }))
            // Clara knows the part IDs: her own copy of the header lists the same parts
            const partIds = [
                ...new Set(a.state.data.outbox.filter((o) => o.kind === 'part').map((o) => o.id))
            ]
            const messageId = mainThread(a.contents.discussion).messages[0]!.messageId
            const bobInbox = join(root, 'inbox', 'p-boris')
            const aside = join(dir, 'aside')
            await fs.mkdir(aside)
            for (const n of (await fs.readdir(bobInbox)).filter((n) => n.endsWith('.bcpart')))
                await fs.rename(join(bobInbox, n), join(aside, n))
            // Clara sends Boris forged parts with the same IDs before the real ones arrive
            const bobKey = fromB64(
                c.contents.sync!.members.find((m) => m.participantId === 'p-boris')!
                    .encryptionPublicKey
            )
            for (const partId of partIds) {
                const junk = new Uint8Array(100).fill(1)
                const env = {
                    protocolVersion: 1,
                    eventId: randomUUID(),
                    type: 'message.part',
                    conversationId: DOC,
                    senderId: 'p-clara',
                    recipientId: 'p-boris',
                    senderSeq: 900 + partIds.indexOf(partId),
                    clock: 1,
                    createdAt: now(),
                    payload: { messageId, partId },
                    payloadSha256: sha256Hex(junk)
                } as Envelope
                await fs.writeFile(
                    join(bobInbox, `${randomUUID()}.bcpart`),
                    await sealEvent(env, junk, c.keys.sign, bobKey)
                )
            }
            await b.sync.scan()
            for (const n of await fs.readdir(aside))
                await fs.rename(join(aside, n), join(bobInbox, n))
            await b.sync.scan()
            await b.sync.scan()
            expect(texts(b.contents)).toEqual(['настоящее'])
            expect(sha256Hex(b.images.get(id)!)).toBe(id)
        })
    })

    it('a file larger than the size limit is not read and goes to the local quarantine (FR-166)', async () => {
        await withTempDir(async (dir) => {
            const { members, root } = await group(dir)
            const b = members[1]!
            const big = join(root, 'inbox', 'p-boris', `${randomUUID()}.bcmsg`)
            const handle = await fs.open(big, 'w')
            await handle.truncate(31 * 1024 * 1024)
            await handle.close()
            await b.sync.scan()
            expect(b.state.data.quarantine.map((q) => q.reason)).toEqual(['larger than the limit'])
        })
    })

    it('ignores files of the sync product and never writes temporary files into the shared folder', async () => {
        await withTempDir(async (dir) => {
            const { members, root } = await group(dir, { exdev: true })
            const [a, b] = members as [Member, Member, Member]
            await fs.writeFile(join(root, 'inbox', 'p-boris', 'desktop.ini'), 'x')
            await fs.writeFile(join(root, 'inbox', 'p-boris', '~$lock.tmp'), 'x')
            await say(a, 'чисто')
            const names = await filesIn(root)
            expect(names.filter((n) => /\.(tmp|staging)$/.test(n) && !n.includes('~$'))).toEqual([])
            await b.sync.scan()
            expect(texts(b.contents)).toEqual(['чисто'])
            expect(b.state.data.quarantine).toEqual([])
        })
    })
})

describe('sync service under random faults (implementation plan, phase 7 exit criteria)', () => {
    function rng(seed: number): () => number {
        let x = seed >>> 0
        return () => {
            x = (x * 1664525 + 1013904223) >>> 0
            return x / 2 ** 32
        }
    }

    for (const seed of [11, 12, 13, 14]) {
        it(`seed ${seed}: delays, duplicates, hidden files, failing deletes, and crashes still converge`, async () => {
            await withTempDir(async (dir) => {
                const rand = rng(seed)
                const { members, root } = await group(dir, {
                    failingDeletes: [clara],
                    exdev: seed % 2 === 0
                })
                const hidden: Array<{ from: string; to: string }> = []
                const allInbox = async () =>
                    (await filesIn(join(root, 'inbox'))).map((n) => join(root, 'inbox', n))

                for (let round = 0; round < 40; round++) {
                    const m = members[Math.floor(rand() * 3)]!
                    const r = rand()
                    if (r < 0.35) await say(m, `${m.author.displayName} ${round}`)
                    else if (r < 0.45) {
                        const all = m.contents.discussion.threads.flatMap((t) => t.messages)
                        const source = all[Math.floor(rand() * all.length)]
                        if (source)
                            await change(m, (x) => ({
                                ...x,
                                discussion: createBranch(m.ctx, x.discussion, {
                                    sourceMessageId: source.messageId,
                                    quoteText: 'x',
                                    author: m.author
                                }).discussion
                            }))
                    } else if (r < 0.55) {
                        const branches = m.contents.discussion.threads.filter(
                            (t) => t.parentThreadId !== undefined
                        )
                        const t = branches[Math.floor(rand() * branches.length)]
                        if (t)
                            await change(m, (x) => ({
                                ...x,
                                discussion: setThreadStatus(
                                    m.ctx,
                                    x.discussion,
                                    t.threadId,
                                    rand() < 0.5 ? 'open' : 'closed',
                                    m.author.participantId
                                )
                            }))
                    } else if (r < 0.65) {
                        // the sync product makes a conflict copy of some file
                        const files = (await allInbox()).filter((f) => !f.includes(' ('))
                        const f = files[Math.floor(rand() * files.length)]
                        if (f)
                            await fs
                                .copyFile(f, f.replace(/\.(bc\w+)$/, ' (1).$1'))
                                .catch(() => undefined)
                    } else if (r < 0.72) {
                        // a file is delayed by the sync product
                        const files = await allInbox()
                        const f = files[Math.floor(rand() * files.length)]
                        if (f) {
                            const to = join(dir, `hidden-${round}`)
                            await fs.rename(f, to)
                            hidden.push({ from: f, to })
                        }
                    } else if (r < 0.8 && hidden.length > 0) {
                        const h = hidden.splice(Math.floor(rand() * hidden.length), 1)[0]!
                        await fs.rename(h.to, h.from)
                    } else if (r < 0.85) {
                        // crash: the scan applied events, but the sync state was not saved
                        const stateFile = join(m.stateDir, 'state.json')
                        const before = await fs.readFile(stateFile).catch(() => null)
                        await m.sync.scan()
                        // the state is saved before each write, so a crash never gives back a used senderSeq
                        if (before) {
                            const after = JSON.parse(await fs.readFile(stateFile, 'utf8'))
                            const old = JSON.parse(before.toString('utf8'))
                            await fs.writeFile(
                                stateFile,
                                JSON.stringify({ ...old, senderSeq: after.senderSeq })
                            )
                        }
                        await connect(m)
                        await m.sync.start()
                    } else await m.sync.scan()
                    clockMs += 1000
                }
                for (const h of hidden) await fs.rename(h.to, h.from)
                await scanAll(members, 10)

                for (const m of members) {
                    expect(checkDiscussionIntegrity(m.contents.discussion)).toEqual([])
                    expect(m.state.data.quarantine).toEqual([])
                    expect(await m.sync.loadingMessages()).toEqual([])
                    const ids = m.contents.discussion.threads.flatMap((t) =>
                        t.messages.map((x) => x.messageId)
                    )
                    expect(new Set(ids).size).toBe(ids.length)
                    expect(view(m.contents)).toEqual(view(members[0]!.contents))
                }
                // only files that Clara could not delete are left in her inbox; the other inboxes are empty
                const left = await filesIn(join(root, 'inbox'))
                expect(left.filter((n) => !n.startsWith('p-clara'))).toEqual([])
                expect(left.filter((n) => /\.(tmp|staging)$/.test(n))).toEqual([])
            })
        }, 60_000)
    }
})

describe('delivery marks and sync health (release 1.3: D-09, D-29, D-34, D-35)', () => {
    const DAY = 24 * 60 * 60_000
    const ownMessage = (m: Member) =>
        mainThread(m.contents.discussion).messages.find(
            (x) => x.authorId === m.author.participantId
        )!

    it('reports per member: written, then delivered; all together only when everybody confirmed', async () => {
        await withTempDir(async (dir) => {
            const { members } = await group(dir)
            const [a, b, c] = members as [Member, Member, Member]
            await say(a, 'кто получил?')
            const id = ownMessage(a).messageId
            expect(a.sync.deliveries()[id]).toEqual({
                state: 'written',
                members: { 'p-boris': 'written', 'p-clara': 'written' }
            })
            await b.sync.scan()
            await a.sync.scan()
            expect(a.sync.deliveries()[id]).toEqual({
                state: 'written',
                members: { 'p-boris': 'delivered', 'p-clara': 'written' }
            })
            await c.sync.scan()
            await a.sync.scan()
            expect(a.sync.deliveries()[id]!.state).toBe('delivered')
        })
    })

    it('reports new messages of others once per scan, never own messages (D-33)', async () => {
        await withTempDir(async (dir) => {
            const { members } = await group(dir)
            const [a, b] = members as [Member, Member, Member]
            await say(a, 'первое')
            await say(a, 'второе')
            const ids = mainThread(a.contents.discussion).messages.map((m) => m.messageId)
            await b.sync.scan()
            expect(b.arrived).toEqual([ids])
            await b.sync.scan()
            expect(b.arrived).toEqual([ids]) // nothing new
            await say(b, 'ответ')
            await a.sync.scan()
            const reply = mainThread(b.contents.discussion).messages.at(-1)!.messageId
            expect(a.arrived).toEqual([[reply]])
            expect(b.arrived).toEqual([ids])
        })
    })

    it('a member who did not create the discussion adds a new member; all learn it (D-13, FR-176)', async () => {
        await withTempDir(async (dir) => {
            const { members, root } = await group(dir)
            const [a, b, c] = members as [Member, Member, Member]
            const dana = await makeKeys()
            const member = {
                participantId: 'p-dana',
                displayName: 'Дана',
                signingPublicKey: b64(dana.sign.publicKey),
                encryptionPublicKey: b64(dana.box.publicKey),
                fingerprint: fingerprintOf(dana.sign.publicKey, dana.box.publicKey),
                addedBy: 'p-boris',
                addedAt: '2026-11-11T11:00:00Z'
            }
            const after = await b.sync.addMembers([member])
            expect(after.sync?.members.map((m) => m.participantId)).toContain('p-dana')
            expect(
                b.contents.sync?.members.find((m) => m.participantId === 'p-dana')?.addedBy
            ).toBe('p-boris')
            // a second call adds nothing and sends nothing
            const files = (await filesIn(join(root, 'inbox', 'p-anna'))).length
            await b.sync.addMembers([member])
            expect((await filesIn(join(root, 'inbox', 'p-anna'))).length).toBe(files)
            // the new member gets no member.added; the earlier members do
            expect(await filesIn(join(root, 'inbox', 'p-dana')).catch(() => [])).toEqual([])
            await a.sync.scan()
            await c.sync.scan()
            for (const m of [a, c]) {
                const added = m.contents.sync?.members.find((x) => x.participantId === 'p-dana')
                expect(added).toMatchObject({ displayName: 'Дана', addedBy: 'p-boris' })
            }
            // from now on every message has a copy for the new member (D-23)
            await say(c, 'для всех, и для Даны')
            expect(
                (await filesIn(join(root, 'inbox', 'p-dana'))).filter((n) => n.endsWith('.bcmsg'))
            ).toHaveLength(1)
        })
    })

    describe('rejoin after key loss (D-15, D-32, FR-177)', () => {
        /** Anna re-invites Boris, who lost the keys; Boris starts again from Anna's copy with new keys. */
        async function rejoin(dir: string) {
            const { members, root } = await group(dir)
            const [a, b, c] = members as [Member, Member, Member]
            // a message for the old key, which Boris never reads
            await say(a, 'для старого ключа')
            const fresh = await makeKeys()
            const keys = {
                signingPublicKey: b64(fresh.sign.publicKey),
                encryptionPublicKey: b64(fresh.box.publicKey),
                fingerprint: fingerprintOf(fresh.sign.publicKey, fresh.box.publicKey)
            }
            const oldFingerprint = b.contents.sync!.members.find(
                (m) => m.participantId === 'p-boris'
            )!.fingerprint
            await a.sync.replaceKeys('p-boris', keys)
            // Boris after the import: Anna's copy, new keys, a new local state
            b.contents = structuredClone(a.contents)
            b.keys = fresh.own
            b.stateDir = join(dir, 'local', 'p-boris-rejoined')
            await connect(b)
            await b.sync.start()
            await b.sync.startRejoin('p-anna')
            return { a, b, c, root, keys, oldFingerprint }
        }

        it('the re-inviter replaces the keys at once and keeps the old ones as history', async () => {
            await withTempDir(async (dir) => {
                const { a, keys, oldFingerprint } = await rejoin(dir)
                const boris = a.contents.sync!.members.find((m) => m.participantId === 'p-boris')!
                expect(boris.fingerprint).toBe(keys.fingerprint)
                expect(boris.previousKeys?.map((k) => k.fingerprint)).toEqual([oldFingerprint])
            })
        })

        it("another member gets a request; until it accepts, the person's events wait (not quarantined)", async () => {
            await withTempDir(async (dir) => {
                const { a, b, c } = await rejoin(dir)
                await c.sync.scan()
                expect(c.sync.health().keyRequests).toEqual([
                    expect.objectContaining({ participantId: 'p-boris', state: 'pending' })
                ])
                await say(b, 'я вернулся')
                await a.sync.scan()
                expect(mainThread(a.contents.discussion).messages.at(-1)?.authorId).toBe('p-boris')
                clockMs += 20 * 60_000 // longer than the grace time
                await c.sync.scan()
                await c.sync.scan()
                expect(
                    mainThread(c.contents.discussion).messages.some((m) => m.authorId === 'p-boris')
                ).toBe(false)
                expect(c.sync.health().quarantined).toBe(0)
                // Boris knows that Clara has not accepted yet; Anna (the re-inviter) has
                await b.sync.scan()
                expect(b.sync.health().rejoinHeardFrom).toEqual(['p-anna'])

                await c.sync.decideKeys('p-boris', true)
                expect(c.sync.health().keyRequests).toEqual([])
                await c.sync.scan()
                expect(
                    mainThread(c.contents.discussion).messages.some((m) => m.authorId === 'p-boris')
                ).toBe(true)
                // Clara's events now reach Boris
                await say(c, 'привет, Борис')
                await b.sync.scan()
                expect(b.sync.health().rejoinHeardFrom?.sort()).toEqual(['p-anna', 'p-clara'])
                expect(mainThread(b.contents.discussion).messages.at(-1)?.authorId).toBe('p-clara')
            })
        })

        it("a member who rejects keeps the old keys; the person's events never reach it", async () => {
            await withTempDir(async (dir) => {
                const { b, c, oldFingerprint } = await rejoin(dir)
                await c.sync.scan()
                await c.sync.decideKeys('p-boris', false)
                expect(c.sync.health().keyRequests).toEqual([
                    expect.objectContaining({ participantId: 'p-boris', state: 'rejected' })
                ])
                expect(
                    c.contents.sync!.members.find((m) => m.participantId === 'p-boris')!.fingerprint
                ).toBe(oldFingerprint)
                await say(b, 'не дойдёт')
                clockMs += 20 * 60_000
                await c.sync.scan()
                await c.sync.scan()
                expect(
                    mainThread(c.contents.discussion).messages.some((m) => m.authorId === 'p-boris')
                ).toBe(false)
                expect(c.sync.health().quarantined).toBe(0)
                // the decision can still change
                await c.sync.decideKeys('p-boris', true)
                await c.sync.scan()
                expect(
                    mainThread(c.contents.discussion).messages.some((m) => m.authorId === 'p-boris')
                ).toBe(true)
            })
        })

        it('files for the old key are set aside, not quarantined', async () => {
            await withTempDir(async (dir) => {
                const { b } = await rejoin(dir)
                clockMs += 20 * 60_000
                await b.sync.scan()
                await b.sync.scan()
                expect(b.sync.health().quarantined).toBe(0)
            })
        })
    })

    it('every member tells the others which messages it received (D-41)', async () => {
        await withTempDir(async (dir) => {
            const { members } = await group(dir)
            const [a, b, c] = members as [Member, Member, Member]
            await say(a, 'доставка для всех')
            const id = ownMessage(a).messageId
            await b.sync.scan()
            expect(b.contents.delivery?.['p-boris']).toEqual([id])
            // Clara learns that Boris has the message of Anna, before she has it herself
            await c.sync.scan()
            expect(c.contents.delivery?.['p-boris']).toEqual([id])
            expect(c.contents.delivery?.['p-clara']).toEqual([id])
            await a.sync.scan()
            await b.sync.scan()
            for (const m of [a, b, c])
                expect(m.contents.delivery).toEqual({ 'p-boris': [id], 'p-clara': [id] })
            // the author does not send a delivery entry for an own message
            expect(a.contents.delivery?.['p-anna']).toBeUndefined()
        })
    })

    it('a lost copy is written again only after the recipient showed activity (D-29)', async () => {
        await withTempDir(async (dir) => {
            const { members, root } = await group(dir)
            const [a, b] = members as [Member, Member, Member]
            await say(a, 'потерялось')
            // the sync product lost the copy for Boris
            const inbox = join(root, 'inbox', 'p-boris')
            for (const n of await fs.readdir(inbox)) await fs.rm(join(inbox, n))
            clockMs += 31 * 60_000
            expect((await a.sync.maintain()).rewritten).toBe(0) // no activity from Boris: no retry
            await b.sync.scan()
            expect(texts(b.contents)).toEqual([])

            clockMs += 1000
            await say(b, 'я здесь') // activity
            await a.sync.scan()
            clockMs += 31 * 60_000
            // only the copy for Boris: Clara has not confirmed either, but she has shown no activity
            expect((await a.sync.maintain()).rewritten).toBe(1)
            await b.sync.scan()
            expect(texts(b.contents)).toContain('потерялось')
            await a.sync.scan()
            const forBoris = a.state.data.outbox.filter((i) => i.recipientId === 'p-boris')
            expect(forBoris.every((i) => i.deliveredAt !== null)).toBe(true)
        })
    })

    it('deletes own receipts after 7 days and own unconfirmed files after 30 days (D-34)', async () => {
        await withTempDir(async (dir) => {
            const { members, root } = await group(dir, { failingDeletes: [anna] })
            const [a, b] = members as [Member, Member, Member]
            await say(a, 'старое')
            await b.sync.scan() // Boris writes a receipt into Anna's inbox, which Anna cannot delete
            await a.sync.scan()
            const annaInbox = join(root, 'inbox', 'p-anna')
            expect((await fs.readdir(annaInbox)).filter((n) => n.endsWith('.bcrcpt'))).toHaveLength(
                1
            )
            clockMs += 6 * DAY
            expect((await b.sync.maintain()).receiptsDeleted).toBe(0)
            clockMs += 2 * DAY
            expect((await b.sync.maintain()).receiptsDeleted).toBe(1)
            expect((await fs.readdir(annaInbox)).filter((n) => n.endsWith('.bcrcpt'))).toEqual([])
        })
    })

    it('deletes own files that never got a receipt after 30 days (D-34)', async () => {
        await withTempDir(async (dir) => {
            const { members, root } = await group(dir)
            const a = members[0]!
            await say(a, 'старое')
            // Clara never comes online: after 30 days Anna's files in her inbox are deleted
            const claraInbox = join(root, 'inbox', 'p-clara')
            expect((await fs.readdir(claraInbox)).length).toBeGreaterThan(0)
            clockMs += 29 * DAY
            expect((await a.sync.maintain()).abandoned).toBe(0)
            clockMs += 2 * DAY
            const r = await a.sync.maintain()
            expect(r.abandoned).toBeGreaterThan(0)
            expect(await fs.readdir(claraInbox)).toEqual([])
            expect((await a.sync.maintain()).abandoned).toBe(0)
        })
    })

    it('reports a missing shared folder and recovers when it is back (D-35)', async () => {
        await withTempDir(async (dir) => {
            const { members, root } = await group(dir)
            const b = members[1]!
            expect(b.sync.health()).toMatchObject({
                folder: 'ok',
                quarantined: 0,
                needsUpdate: false
            })
            await fs.rename(root, `${root}-away`)
            await b.sync.scan()
            expect(b.sync.health().folder).toBe('missing')
            await fs.rename(`${root}-away`, root)
            await b.sync.scan()
            expect(b.sync.health().folder).toBe('ok')
        })
    })
})
