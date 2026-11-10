import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KEY_BUNDLE_TEXT_PREFIX, keyBundleSchema } from '@shared/sync'
import {
    KeyBundleError,
    b64,
    fingerprintOf,
    groupFingerprint,
    keyBundleToFile,
    keyBundleToText,
    makeKeyBundle,
    parseKeyBundle,
    verifyKeyBundle
} from '../../src/main/crypto/identity'
import { KeyStore, type KeyProtector } from '../../src/main/crypto/keyStore'
import { getSodium } from '../../src/main/crypto/sodium'
import { withTempDir } from '../helpers/fixtures'

/** Stand-in for DPAPI: reversible, and recognizably not the plain secret. */
function fakeProtector(available = true): KeyProtector & { calls: number } {
    const tag = Buffer.from('TEST:')
    const p = {
        calls: 0,
        isAvailable: () => available,
        encrypt: (plain: Buffer) => {
            p.calls++
            return Buffer.concat([tag, Buffer.from(Buffer.from(plain).map((b) => b ^ 0x5a))])
        },
        decrypt: (sealed: Buffer) => {
            if (!sealed.subarray(0, tag.length).equals(tag)) throw new Error('not ours')
            return Buffer.from(Buffer.from(sealed.subarray(tag.length)).map((b) => b ^ 0x5a))
        }
    }
    return p
}

const now = (): string => '2026-11-10T10:00:00.000Z'

describe('fingerprint (sync-protocol.md 4.1)', () => {
    it('matches the test vector computed independently', () => {
        const signing = new Uint8Array(Array.from({ length: 32 }, (_, i) => i))
        const encryption = new Uint8Array(32).fill(0xff)
        expect(fingerprintOf(signing, encryption)).toBe('EF6A82BA85F244AFC0DC27A21DB584C1')
    })

    it('is shown in 8 groups of 4 (FR-157)', () => {
        expect(groupFingerprint('EF6A82BA85F244AFC0DC27A21DB584C1')).toBe(
            'EF6A 82BA 85F2 44AF C0DC 27A2 1DB5 84C1'
        )
    })
})

describe('key store (FR-155, FR-156)', () => {
    it('creates the keys on first use and loads the same keys later', async () => {
        await withTempDir(async (dir) => {
            const first = await new KeyStore(dir, fakeProtector(), now).ensure('p-anna')
            expect(first.replaced).toBeNull()
            expect(first.identity.state).toBe('ready')
            const second = await new KeyStore(dir, fakeProtector(), now).ensure('p-anna')
            if (first.identity.state !== 'ready' || second.identity.state !== 'ready')
                throw new Error('not ready')
            expect(second.identity.fingerprint).toBe(first.identity.fingerprint)
            expect(second.replaced).toBeNull()
        })
    })

    it('never writes the private keys in clear text', async () => {
        await withTempDir(async (dir) => {
            const store = new KeyStore(dir, fakeProtector(), now)
            const { identity } = await store.ensure('p-anna')
            if (identity.state !== 'ready') throw new Error('not ready')
            const text = await fs.readFile(join(dir, 'identity.json'), 'utf8')
            const file = JSON.parse(text) as Record<string, string>
            expect(Object.keys(file).sort()).toEqual(
                [
                    'createdAt',
                    'encryptionPublicKey',
                    'format',
                    'participantId',
                    'protectedSecret',
                    'signingPublicKey',
                    'version'
                ].sort()
            )
            // The Ed25519 secret key ends with the public key; it must not appear unprotected.
            const sodium = await getSodium()
            const data = new TextEncoder().encode('x')
            const signature = await store.sign('p-anna', data)
            expect(
                sodium.crypto_sign_verify_detached(
                    signature,
                    data,
                    identity.identity.signingPublicKey
                )
            ).toBe(true)
            const sealed = Buffer.from(file['protectedSecret']!, 'base64')
            expect(sealed.subarray(0, 5).toString()).toBe('TEST:')
            expect(sealed.includes(Buffer.from(identity.identity.signingPublicKey))).toBe(false)
        })
    })

    it('creates no keys when Windows data protection is not available', async () => {
        await withTempDir(async (dir) => {
            const result = await new KeyStore(dir, fakeProtector(false), now).ensure('p-anna')
            expect(result.identity.state).toBe('unavailable')
            await expect(fs.access(join(dir, 'identity.json'))).rejects.toThrow()
        })
    })

    it('replaces an unreadable key file and keeps it as a backup', async () => {
        await withTempDir(async (dir) => {
            const first = await new KeyStore(dir, fakeProtector(), now).ensure('p-anna')
            const file = join(dir, 'identity.json')
            const content = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, string>
            // e.g. DPAPI cannot decrypt after the Windows profile moved
            await fs.writeFile(file, JSON.stringify({ ...content, protectedSecret: 'AAAA' }))
            const second = await new KeyStore(dir, fakeProtector(), now).ensure('p-anna')
            expect(second.replaced).toBe('unreadable')
            if (first.identity.state !== 'ready' || second.identity.state !== 'ready')
                throw new Error('not ready')
            expect(second.identity.fingerprint).not.toBe(first.identity.fingerprint)
            expect(
                (await fs.readdir(dir)).some((n) => n.startsWith('identity.json.unreadable-'))
            ).toBe(true)
        })
    })

    it('replaces a key file whose secret does not match the public keys', async () => {
        await withTempDir(async (dir) => {
            await new KeyStore(dir, fakeProtector(), now).ensure('p-anna')
            const file = join(dir, 'identity.json')
            const content = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, string>
            const sodium = await getSodium()
            const other = sodium.crypto_sign_keypair()
            await fs.writeFile(
                file,
                JSON.stringify({ ...content, signingPublicKey: b64(other.publicKey) })
            )
            expect((await new KeyStore(dir, fakeProtector(), now).ensure('p-anna')).replaced).toBe(
                'unreadable'
            )
        })
    })

    it('makes new keys when the participant ID changed (settings created again)', async () => {
        await withTempDir(async (dir) => {
            await new KeyStore(dir, fakeProtector(), now).ensure('p-old')
            const result = await new KeyStore(dir, fakeProtector(), now).ensure('p-new')
            expect(result.replaced).toBe('other-participant')
            expect(
                JSON.parse(await fs.readFile(join(dir, 'identity.json'), 'utf8')).participantId
            ).toBe('p-new')
        })
    })
})

describe('public-key bundle (sync-protocol.md section 4, FR-157)', () => {
    async function bundleFor(dir: string, name = 'Анна') {
        const store = new KeyStore(dir, fakeProtector(), now)
        const { identity } = await store.ensure('p-anna')
        if (identity.state !== 'ready') throw new Error('not ready')
        return makeKeyBundle(identity.identity, name, now(), (d) => store.sign('p-anna', d))
    }

    it('is signed by its own key and survives the text and file forms', async () => {
        await withTempDir(async (dir) => {
            const bundle = await bundleFor(dir)
            expect(keyBundleSchema.parse(bundle)).toEqual(bundle)
            await expect(verifyKeyBundle(bundle)).resolves.toEqual(bundle)
            const text = keyBundleToText(bundle)
            expect(text.startsWith(KEY_BUNDLE_TEXT_PREFIX)).toBe(true)
            expect(text).not.toMatch(/\s/)
            await expect(parseKeyBundle(`  ${text}\n`)).resolves.toEqual(bundle)
            await expect(parseKeyBundle(keyBundleToFile(bundle))).resolves.toEqual(bundle)
        })
    })

    it('refuses a changed name, changed keys, a wrong fingerprint, and garbage', async () => {
        await withTempDir(async (dir) => {
            const bundle = await bundleFor(dir)
            const sodium = await getSodium()
            const other = sodium.crypto_box_keypair()
            const otherKey = b64(other.publicKey)
            const swapped = {
                ...bundle,
                encryptionPublicKey: otherKey,
                fingerprint: fingerprintOf(
                    Buffer.from(bundle.signingPublicKey, 'base64'),
                    other.publicKey
                )
            }
            for (const bad of [
                { ...bundle, displayName: 'Мошенник' },
                swapped,
                { ...bundle, fingerprint: '0'.repeat(32) },
                { ...bundle, extra: 1 }
            ])
                await expect(verifyKeyBundle(bad)).rejects.toBeInstanceOf(KeyBundleError)
            for (const text of ['', 'hello', `${KEY_BUNDLE_TEXT_PREFIX}!!!`, '{"format":1}'])
                await expect(parseKeyBundle(text)).rejects.toBeInstanceOf(KeyBundleError)
        })
    })
})
