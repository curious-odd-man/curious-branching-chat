import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mainThread, type Author } from '@shared/domain'
import type { DocumentContents } from '@shared/types'
import { normalizeSynced } from '@shared/sync'
import type { SyncInfo } from '@shared/validation'
import { DocumentSession } from '../../src/main/application/documentSession'
import { b64, fingerprintOf } from '../../src/main/crypto/identity'
import { KeyStore, type KeyProtector } from '../../src/main/crypto/keyStore'
import { newDocumentContents, readDocument, writeDocument } from '../../src/main/document'
import { SettingsStore } from '../../src/main/local-state/settings'
import { SyncRegistry } from '../../src/main/sync/registry'
import { SyncService } from '../../src/main/sync/syncService'
import { anna, boris, makeCtx, pngBytes, simple, withTempDir } from '../helpers/fixtures'

const protector: KeyProtector = {
    isAvailable: () => true,
    encrypt: (p) => Buffer.concat([Buffer.from('T:'), p]),
    decrypt: (s) => Buffer.from(s.subarray(2))
}

interface Profile {
    author: Author
    dir: string
    file: string
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
    const made: Array<Omit<Profile, 'sync' | 'registry' | 'file'>> = []
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
        const file = join(p.dir, 'Общее.branchchat')
        await writeDocument(file, start, { discardExisting: true })
        const registry = new SyncRegistry(join(p.dir, 'sync'))
        await registry.load()
        await registry.put({
            conversationId: start.manifest.documentId,
            filePath: file,
            sharedRoot: shared,
            ownId: p.author.participantId
        })
        const sync = new SyncService({
            userData: p.dir,
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
        out.push({ ...p, file, registry, sync })
    }
    return { a: out[0]!, b: out[1]!, shared }
}

const texts = (c: DocumentContents): string[] =>
    mainThread(c.discussion).messages.map(
        (m) => (m.content.content[0] as { content: Array<{ text: string }> }).content[0]!.text
    )

async function idle(...sessions: DocumentSession[]): Promise<void> {
    await new Promise((r) => setTimeout(r, 50))
    for (const s of sessions) await s.flush()
}

describe('sync service with document sessions and files (design section 10)', () => {
    it('syncs between an open window and a closed file in both directions', async () => {
        await withTempDir(async (dir) => {
            const { a, b } = await profiles(dir)
            const ctx = makeCtx('a')
            const sa = await DocumentSession.open(a.file, { ctx })
            expect(await a.sync.attach(sa)).toBe('synced')
            sa.appendMessage(
                anna,
                mainThread(sa.current.discussion).threadId,
                simple('из окна Анны')
            )
            await idle(sa)
            await a.sync.scanAll() // flushes the outbox

            // Boris has no window: the file is updated directly
            await b.sync.scanAll()
            expect(texts((await readDocument(b.file)).contents)).toEqual(['из окна Анны'])

            // Boris opens the file and answers with a picture
            const sb = await DocumentSession.open(b.file, { ctx: makeCtx('b') })
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
            // the window's save also wrote the image into Anna's file
            const onDisk = await readDocument(a.file)
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

    it('a copy at another path is detached; a moved registered file can be adopted (FR-154, FR-168)', async () => {
        await withTempDir(async (dir) => {
            const { a } = await profiles(dir)
            const copy = join(dir, 'копия.branchchat')
            await fs.copyFile(a.file, copy)
            const detached = await DocumentSession.open(copy, { ctx: makeCtx('c') })
            expect(await a.sync.attach(detached)).toBe('detached')
            expect(detached.synced).toBe(false)

            const moved = join(dir, 'перенесено.branchchat')
            await fs.rename(a.file, moved)
            const id = detached.documentId
            expect(await a.sync.registeredFileMissing(id)).toBe(true)
            await a.sync.adoptMovedFile(id, moved)
            const s = await DocumentSession.open(moved, { ctx: makeCtx('m') })
            expect(await a.sync.attach(s)).toBe('synced')
            await a.sync.stop()
        })
    })

    it('a name change reaches the other member; "Отправить копию…" leaves out the roster (D-12, FR-167)', async () => {
        await withTempDir(async (dir) => {
            const { a, b } = await profiles(dir)
            await a.settings.setDisplayName('Аня')
            await a.sync.nameChanged('Аня')
            await a.sync.scanAll()
            await b.sync.scanAll()
            const roster = (await readDocument(b.file)).contents.sync!
            expect(roster.members.find((m) => m.participantId === 'p-anna')!.displayName).toBe(
                'Аня'
            )

            const sa = await DocumentSession.open(a.file, { ctx: makeCtx('a') })
            await a.sync.attach(sa)
            sa.appendMessage(
                { participantId: 'p-anna', displayName: 'Аня' },
                mainThread(sa.current.discussion).threadId,
                simple('копия')
            )
            const target = join(dir, 'для WhatsApp.branchchat')
            await sa.saveCopyWithoutSync(target)
            const copy = await readDocument(target)
            expect(copy.contents.sync).toBeUndefined()
            expect(copy.contents.manifest.documentId).toBe(sa.documentId)
            expect(texts(copy.contents)).toEqual(['копия'])
            await a.sync.stop()
            await b.sync.stop()
        })
    })
})
