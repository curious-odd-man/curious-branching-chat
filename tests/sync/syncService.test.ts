import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { mainThread, type Author } from '@shared/domain'
import type { DocumentContents } from '@shared/types'
import { normalizeSynced } from '@shared/sync'
import type { SyncInfo } from '@shared/validation'
import { DocumentSession } from '../../src/main/application/documentSession'
import { b64, fingerprintOf } from '../../src/main/crypto/identity'
import { KeyStore, type KeyProtector } from '../../src/main/crypto/keyStore'
import { newDocumentContents, readDocument } from '../../src/main/document'
import type { LibraryService } from '../../src/main/library'
import { closeLibraries, libraryIn } from '../helpers/library'
import { SettingsStore } from '../../src/main/local-state/settings'
import { SyncRegistry } from '../../src/main/sync/registry'
import { SyncService } from '../../src/main/sync/syncService'
import { anna, boris, makeCtx, pngBytes, simple, withTempDir } from '../helpers/fixtures'

const protector: KeyProtector = {
    isAvailable: () => true,
    encrypt: (p) => Buffer.concat([Buffer.from('T:'), p]),
    decrypt: (s) => Buffer.from(s.subarray(2))
}

afterEach(() => closeLibraries())

interface Profile {
    author: Author
    dir: string
    /** The ID of the synchronized discussion. */
    file: string
    lib: LibraryService
    settings: SettingsStore
    keys: KeyStore
    registry: SyncRegistry
    sync: SyncService
}

const now = (): string => new Date().toISOString()

async function profiles(dir: string): Promise<{ a: Profile; b: Profile; shared: string }> {
    const shared = join(dir, 'shared')
    await fs.mkdir(shared)
    const people = [anna, boris]
    const made: Array<Omit<Profile, 'sync' | 'registry' | 'file' | 'lib'>> = []
    for (const author of people) {
        const pdir = join(dir, author.participantId)
        await fs.mkdir(pdir, { recursive: true })
        await fs.writeFile(
            join(pdir, 'settings.json'),
            JSON.stringify({ participantId: author.participantId, displayName: author.displayName })
        )
        const settings = new SettingsStore(pdir, randomUUID)
        await settings.load()
        const keys = new KeyStore(join(pdir, 'keys'), protector, now)
        await keys.ensure(author.participantId)
        made.push({ author, dir: pdir, settings, keys })
    }
    const members = await Promise.all(
        made.map(async (p) => {
            const { identity } = await p.keys.ensure(p.author.participantId)
            if (identity.state !== 'ready') throw new Error('keys')
            const i = identity.identity
            return {
                participantId: p.author.participantId,
                displayName: p.author.displayName,
                signingPublicKey: b64(i.signingPublicKey),
                encryptionPublicKey: b64(i.encryptionPublicKey),
                fingerprint: fingerprintOf(i.signingPublicKey, i.encryptionPublicKey),
                addedBy: anna.participantId,
                addedAt: now()
            }
        })
    )
    const roster: SyncInfo = { protocolVersion: 1, members }
    const base = newDocumentContents(makeCtx('s'), { title: 'Общее', author: anna })
    const start: DocumentContents = normalizeSynced({ ...base, sync: roster })
    const out: Profile[] = []
    for (const p of made) {
        const file = start.manifest.documentId
        const lib = await libraryIn(p.dir)
        await lib.create(start)
        const registry = new SyncRegistry(join(p.dir, 'sync'))
        await registry.load()
        await registry.put({
            conversationId: start.manifest.documentId,
            sharedRoot: shared,
            ownId: p.author.participantId
        })
        const sync = new SyncService({
            userData: p.dir,
            library: lib,
            registry,
            keys: p.keys,
            settings: p.settings,
            now,
            newId: randomUUID,
            appVersion: '1.2.0',
            stableMs: 0,
            watch: false,
            scanIntervalMs: 3_600_000
        })
        await sync.start()
        out.push({ ...p, file, lib, registry, sync })
    }
    return { a: out[0]!, b: out[1]!, shared }
}

const texts = (c: DocumentContents): string[] =>
    mainThread(c.discussion).messages.map(
        (m) => (m.content.content[0] as { content: Array<{ text: string }> }).content[0]!.text
    )

/** What the library of a profile holds now (read from the database). */
const saved = (p: Profile): DocumentContents => p.lib.repo.load(p.file).contents

async function openSession(p: Profile, ctx: ReturnType<typeof makeCtx>): Promise<DocumentSession> {
    const store = p.lib.store(p.file)
    return DocumentSession.open(store, await store.load(), { ctx })
}

async function idle(...sessions: DocumentSession[]): Promise<void> {
    await new Promise((r) => setTimeout(r, 50))
    for (const s of sessions) await s.flush()
}

describe('sync service with document sessions and the library (design section 10)', () => {
    it('syncs between an open window and a closed discussion in both directions', async () => {
        await withTempDir(async (dir) => {
            const { a, b } = await profiles(dir)
            const ctx = makeCtx('a')
            const sa = await openSession(a, ctx)
            expect(await a.sync.attach(sa)).toBe('synced')
            sa.appendMessage(
                anna,
                mainThread(sa.current.discussion).threadId,
                simple('из окна Анны')
            )
            await idle(sa)
            await a.sync.scanAll() // flushes the outbox

            // Boris has no window: the library is updated directly
            await b.sync.scanAll()
            expect(texts(saved(b))).toEqual(['из окна Анны'])

            // Boris opens the discussion and answers with a picture
            const sb = await openSession(b, makeCtx('b'))
            expect(await b.sync.attach(sb)).toBe('synced')
            const img = sb.stageImage(pngBytes(3))
            sb.appendMessage(boris, mainThread(sb.current.discussion).threadId, {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            { type: 'text', text: 'ответ' },
                            { type: 'image', attrs: { assetId: img.assetId } }
                        ]
                    }
                ]
            })
            await idle(sb)
            await b.sync.scanAll()
            await a.sync.scanAll()
            await idle(sa)
            expect(texts(sa.current)).toEqual(['из окна Анны', 'ответ'])
            const bytes = await sa.readAssetBytes(img.assetId)
            expect(bytes?.data.equals(pngBytes(3))).toBe(true)
            // the window's save also wrote the image into Anna's library
            const onDisk = a.lib.repo.load(a.file)
            expect(onDisk.missingAssetIds).toEqual([])
            expect(texts(onDisk.contents)).toEqual(['из окна Анны', 'ответ'])
            // the read indicator counts both members from the start (FR-163)
            expect(
                sa
                    .view('p-anna')
                    .knownParticipants.map((p) => p.participantId)
                    .sort()
            ).toEqual(['p-anna', 'p-boris'])
            await a.sync.stop()
            await b.sync.stop()
        })
    })

    it('a discussion with a member list that is not registered here is detached (FR-154)', async () => {
        await withTempDir(async (dir) => {
            const { a } = await profiles(dir)
            await a.registry.remove(a.file)
            const detached = await openSession(a, makeCtx('c'))
            expect(await a.sync.attach(detached)).toBe('detached')
            expect(detached.synced).toBe(false)
            await a.sync.stop()
        })
    })

    it('a name change reaches the other member; "Экспортировать…" leaves out the roster (D-12, FR-167)', async () => {
        await withTempDir(async (dir) => {
            const { a, b } = await profiles(dir)
            await a.settings.setDisplayName('Аня')
            await a.sync.nameChanged('Аня')
            await a.sync.scanAll()
            await b.sync.scanAll()
            const roster = saved(b).sync!
            expect(roster.members.find((m) => m.participantId === 'p-anna')!.displayName).toBe(
                'Аня'
            )

            const sa = await openSession(a, makeCtx('a'))
            await a.sync.attach(sa)
            sa.appendMessage(
                { participantId: 'p-anna', displayName: 'Аня' },
                mainThread(sa.current.discussion).threadId,
                simple('копия')
            )
            const target = join(dir, 'для WhatsApp.branchchat')
            await sa.flush()
            await a.lib.exportTo(sa.current, target)
            const copy = await readDocument(target)
            expect(copy.contents.sync).toBeUndefined()
            expect(copy.contents.manifest.documentId).toBe(sa.documentId)
            expect(texts(copy.contents)).toEqual(['копия'])
            await a.sync.stop()
            await b.sync.stop()
        })
    })
})
