import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mainThread, type Author } from '@shared/domain'
import type { DocumentContents } from '@shared/types'
import { DocumentSession } from '../../src/main/application/documentSession'
import { groupFingerprint } from '../../src/main/crypto/identity'
import { KeyStore, type KeyProtector } from '../../src/main/crypto/keyStore'
import { readDocument } from '../../src/main/document'
import { SettingsStore } from '../../src/main/local-state/settings'
import { Onboarding } from '../../src/main/sync/onboarding'
import { SyncRegistry } from '../../src/main/sync/registry'
import { SyncService } from '../../src/main/sync/syncService'
import { anna, boris, clara, makeCtx, pngBytes, simple, withTempDir } from '../helpers/fixtures'

const protector: KeyProtector = {
    isAvailable: () => true,
    encrypt: (p) => Buffer.concat([Buffer.from('T:'), p]),
    decrypt: (s) => Buffer.from(s.subarray(2))
}

interface P {
    author: Author
    dir: string
    settings: SettingsStore
    keys: KeyStore
    registry: SyncRegistry
    sync: SyncService
    onboarding: Onboarding
}

async function person(dir: string, author: Author): Promise<P> {
    const pdir = join(dir, author.participantId)
    await fs.mkdir(pdir, { recursive: true })
    await fs.writeFile(
        join(pdir, 'settings.json'),
        JSON.stringify({ participantId: author.participantId, displayName: author.displayName })
    )
    const settings = new SettingsStore(pdir, randomUUID)
    await settings.load()
    const keys = new KeyStore(join(pdir, 'keys'), protector, () => new Date().toISOString())
    const registry = new SyncRegistry(join(pdir, 'sync'))
    await registry.load()
    const sync = new SyncService({
        userData: pdir,
        registry,
        keys,
        settings,
        now: () => new Date().toISOString(),
        newId: randomUUID,
        appVersion: '1.2.0',
        stableMs: 0,
        watch: false,
        scanIntervalMs: 3_600_000
    })
    await sync.start()
    const onboarding = new Onboarding({
        userData: pdir,
        keys,
        settings,
        registry,
        sync,
        ctx: makeCtx(author.participantId),
        appVersion: '1.2.0'
    })
    return { author, dir: pdir, settings, keys, registry, sync, onboarding }
}

const texts = (c: DocumentContents): string[] =>
    mainThread(c.discussion).messages.map(
        (m) => (m.content.content[0] as { content: Array<{ text: string }> }).content[0]!.text
    )

async function settle(...ps: P[]): Promise<void> {
    for (let i = 0; i < 3; i++) for (const p of ps) await p.sync.scanAll()
}

describe('onboarding (design 12.3 to 12.5, FR-158, FR-162)', () => {
    it('creates a discussion, finds the key in the folder, and the invitee joins and writes', async () => {
        await withTempDir(async (dir) => {
            const shared = join(dir, 'G', 'Общая папка')
            await fs.mkdir(shared, { recursive: true })
            const a = await person(dir, anna)
            const b = await person(dir, boris)

            expect(await a.onboarding.testFolder(shared)).toEqual({ ok: true })
            await b.onboarding.publishOwnKey(shared) // Boris goes first and leaves his key in the folder
            const candidates = await a.onboarding.candidates(shared)
            expect(candidates.map((c) => c.displayName)).toEqual(['Борис'])
            const bobPrint = (await b.onboarding.ownBundle()).fingerprint
            expect(candidates[0]!.fingerprint).toBe(groupFingerprint(bobPrint))

            // the local file may not be inside the shared folder (FR-160)
            await expect(
                a.onboarding.create({
                    root: shared,
                    filePath: join(shared, 'x.branchchat'),
                    keys: [candidates[0]!.text]
                })
            ).rejects.toMatchObject({ code: 'FILE_IN_SHARED_FOLDER' })
            const fileA = join(a.dir, 'Планы.branchchat')
            await a.onboarding.create({
                root: shared,
                filePath: fileA,
                keys: [candidates[0]!.text]
            })
            expect(
                a.sync.invitationStatus((await readDocument(fileA)).contents.manifest.documentId)
            ).toEqual({ 'p-boris': 'invited' })

            // Boris: the invitation names Anna with her fingerprint (he compares it, FR-162)
            const found = await b.onboarding.findInvitation(shared)
            if (found.state !== 'ready') throw new Error(found.state)
            expect(found).toMatchObject({
                title: 'Планы',
                inviterName: 'Анна',
                inviterFingerprint: groupFingerprint((await a.onboarding.ownBundle()).fingerprint)
            })
            const fileB = join(b.dir, 'Планы.branchchat')
            await b.onboarding.importInvitation(shared, found.invitationId, fileB)
            expect(await b.onboarding.findInvitation(shared)).toEqual({ state: 'waiting' })

            await settle(a, b)
            expect(a.sync.invitationStatus(found.conversationId)).toEqual({ 'p-boris': 'joined' })

            const sb = await DocumentSession.open(fileB, { ctx: makeCtx('b') })
            expect(await b.sync.attach(sb)).toBe('synced')
            sb.appendMessage(boris, mainThread(sb.current.discussion).threadId, simple('Я с вами'))
            await sb.flush()
            await settle(b, a)
            expect(texts((await readDocument(fileA)).contents)).toEqual(['Я с вами'])
            // nothing is left in the shared folder except the marker and the two key files
            const left = (await fs.readdir(shared, { recursive: true, withFileTypes: true }))
                .filter((e) => e.isFile())
                .map((e) => e.name)
            expect(left.filter((n) => !n.endsWith('.bckey')).sort()).toEqual([
                'branchchat-sync.json'
            ])
            await a.sync.stop()
            await b.sync.stop()
        })
    })

    it('converts an existing discussion with images; the history travels in the invitation (D-02)', async () => {
        await withTempDir(async (dir) => {
            const shared = join(dir, 'shared')
            await fs.mkdir(shared)
            const a = await person(dir, anna)
            const c = await person(dir, clara)
            const fileA = join(a.dir, 'Старое.branchchat')
            const sa = await DocumentSession.create(fileA, { ctx: makeCtx('a') }, { author: anna })
            const img = sa.stageImage(pngBytes(7))
            const main = mainThread(sa.current.discussion).threadId
            sa.appendMessage(anna, main, simple('до синхронизации'))
            sa.appendMessage(anna, main, {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        content: [
                            { type: 'text', text: 'с картинкой' },
                            { type: 'image', attrs: { assetId: img.assetId } }
                        ]
                    }
                ]
            })
            const source = mainThread(sa.current.discussion).messages[0]!.messageId
            sa.createBranch(anna, { sourceMessageId: source, selectionStart: 0, selectionEnd: 2 })
            await sa.flush()

            const key = (
                await a.onboarding.parseKey(
                    (await import('../../src/main/crypto/identity')).keyBundleToText(
                        await c.onboarding.ownBundle()
                    )
                )
            ).text
            await a.onboarding.create({ root: shared, filePath: fileA, keys: [key], session: sa })
            expect(sa.synced).toBe(true)

            const found = await c.onboarding.findInvitation(shared)
            if (found.state !== 'ready') throw new Error(found.state)
            const fileC = join(c.dir, 'Старое.branchchat')
            await c.onboarding.importInvitation(shared, found.invitationId, fileC)
            const got = await readDocument(fileC)
            expect(texts(got.contents)).toEqual(['до синхронизации', 'с картинкой'])
            expect(got.missingAssetIds).toEqual([])
            expect(got.contents.discussion.threads).toHaveLength(2)
            expect(got.contents.sync!.members.map((m) => m.participantId).sort()).toEqual([
                'p-anna',
                'p-clara'
            ])
            await a.sync.stop()
            await c.sync.stop()
        })
    })

    it('converts and joins a discussion of 5,000 messages in reasonable time (implementation plan, phase 10)', async () => {
        await withTempDir(async (dir) => {
            const shared = join(dir, 'shared')
            await fs.mkdir(shared)
            const a = await person(dir, anna)
            const b = await person(dir, boris)
            const fileA = join(a.dir, 'Большое.branchchat')
            const sa = await DocumentSession.create(fileA, { ctx: makeCtx('a') }, { author: anna })
            const main = mainThread(sa.current.discussion).threadId
            for (let i = 0; i < 5000; i++)
                sa.appendMessage(
                    i % 2 ? anna : boris,
                    main,
                    simple(`Сообщение номер ${i} с текстом.`)
                )
            await sa.flush()
            const started = Date.now()
            const key = (await import('../../src/main/crypto/identity')).keyBundleToText(
                await b.onboarding.ownBundle()
            )
            await a.onboarding.create({ root: shared, filePath: fileA, keys: [key], session: sa })
            const found = await b.onboarding.findInvitation(shared)
            if (found.state !== 'ready') throw new Error(found.state)
            const fileB = join(b.dir, 'Большое.branchchat')
            await b.onboarding.importInvitation(shared, found.invitationId, fileB)
            const elapsed = Date.now() - started
            expect(
                mainThread((await readDocument(fileB)).contents.discussion).messages
            ).toHaveLength(5000)
            expect(elapsed).toBeLessThan(30_000)
            console.log(`convert and join of 5,000 messages: ${elapsed} ms`)
            await a.sync.stop()
            await b.sync.stop()
        })
    }, 120_000)

    it('refuses an invitation that is not for this person, and a key that is the own key', async () => {
        await withTempDir(async (dir) => {
            const shared = join(dir, 'shared')
            await fs.mkdir(shared)
            const a = await person(dir, anna)
            const b = await person(dir, boris)
            const c = await person(dir, clara)
            const bobKey = (await import('../../src/main/crypto/identity')).keyBundleToText(
                await b.onboarding.ownBundle()
            )
            await a.onboarding.create({
                root: shared,
                filePath: join(a.dir, 'x.branchchat'),
                keys: [bobKey]
            })
            // Clara copies Boris's invitation into her own inbox: she cannot open it
            const bobInbox = join(shared, 'inbox', 'p-boris')
            await fs.mkdir(join(shared, 'inbox', 'p-clara'), { recursive: true })
            for (const n of await fs.readdir(bobInbox))
                await fs.copyFile(join(bobInbox, n), join(shared, 'inbox', 'p-clara', n))
            expect(await c.onboarding.findInvitation(shared)).toEqual({ state: 'waiting' })
            await expect(b.onboarding.parseKey(bobKey)).rejects.toMatchObject({ code: 'OWN_KEY' })
            await expect(b.onboarding.parseKey('BRANCHCHAT-KEY-1:garbage')).rejects.toMatchObject({
                code: 'INVALID_KEY'
            })
            // a second discussion cannot use the same shared folder
            await expect(
                a.onboarding.create({
                    root: shared,
                    filePath: join(a.dir, 'y.branchchat'),
                    keys: [bobKey]
                })
            ).rejects.toMatchObject({ code: 'FOLDER_IN_USE' })
            await a.sync.stop()
        })
    })
})
