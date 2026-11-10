import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { writeFileAtomically } from '../document/atomicWrite'
import { b64, fingerprintOf, fromB64, type PublicIdentity } from './identity'
import { getSodium } from './sodium'

/**
 * Protects the private keys at rest. In the application this is Electron `safeStorage` (Windows DPAPI for the user
 * account, FR-156); tests use a replacement.
 */
export interface KeyProtector {
    isAvailable(): boolean
    encrypt(plain: Buffer): Buffer
    decrypt(sealed: Buffer): Buffer
}

const IDENTITY_FILE = 'identity.json'

const identityFileSchema = z
    .object({
        format: z.literal('branchchat-identity'),
        version: z.literal(1),
        participantId: z.string().min(1),
        createdAt: z.string(),
        signingPublicKey: z.string(),
        encryptionPublicKey: z.string(),
        /** protector.encrypt(Ed25519 secret key (64 bytes) || X25519 secret key (32 bytes)), base64 */
        protectedSecret: z.string().min(1)
    })
    .strict()
type IdentityFile = z.infer<typeof identityFileSchema>

export type IdentityState =
    | { state: 'ready'; identity: PublicIdentity; fingerprint: string; createdAt: string }
    /** Windows data protection is not available: no keys are created (FR-156). */
    | { state: 'unavailable' }

export interface EnsureResult {
    identity: IdentityState
    /** An earlier key file could not be used (unreadable, or for another participant ID); it was kept as a backup. */
    replaced: 'unreadable' | 'other-participant' | null
}

interface Secrets {
    signingSecretKey: Uint8Array
    encryptionSecretKey: Uint8Array
}

/**
 * The encryption identity of this Windows user (FR-155, FR-156): an Ed25519 signing key pair and an X25519
 * encryption key pair, bound to the participant ID from the settings. Private keys exist in clear text only in
 * memory of the main process, for the time of one operation; on disk they are protected by the KeyProtector.
 */
export class KeyStore {
    private cached: { file: IdentityFile; identity: PublicIdentity } | null = null

    constructor(
        private readonly dir: string,
        private readonly protector: KeyProtector,
        private readonly now: () => string
    ) {}

    private get path(): string {
        return join(this.dir, IDENTITY_FILE)
    }

    /** The identity for this participant; created on first use (FR-155). */
    async ensure(participantId: string): Promise<EnsureResult> {
        if (!this.protector.isAvailable())
            return { identity: { state: 'unavailable' }, replaced: null }
        if (this.cached?.identity.participantId === participantId)
            return {
                identity: this.readyState(this.cached.file, this.cached.identity),
                replaced: null
            }

        let replaced: EnsureResult['replaced'] = null
        const existing = await this.readFile()
        if (existing.kind === 'ok') {
            if (existing.file.participantId === participantId) {
                const identity = await this.check(existing.file)
                if (identity) {
                    this.cached = { file: existing.file, identity }
                    return { identity: this.readyState(existing.file, identity), replaced: null }
                }
                replaced = 'unreadable'
            } else replaced = 'other-participant'
        } else if (existing.kind === 'damaged') replaced = 'unreadable'

        if (replaced) await this.backUp(replaced)
        const file = await this.create(participantId)
        const identity = toPublic(file)
        this.cached = { file, identity }
        return { identity: this.readyState(file, identity), replaced }
    }

    /**
     * Signs data with the private signing key. The secret is decrypted for this call only and wiped afterwards.
     * Throws if the identity does not exist yet (call `ensure` first).
     */
    async sign(participantId: string, data: Uint8Array): Promise<Uint8Array> {
        const sodium = await getSodium()
        return this.withSecrets(participantId, (s) =>
            sodium.crypto_sign_detached(data, s.signingSecretKey)
        )
    }

    private async withSecrets<T>(participantId: string, fn: (s: Secrets) => T): Promise<T> {
        const { identity } = await this.ensure(participantId)
        if (identity.state !== 'ready') throw new Error('encryption keys are not available')
        if (!this.cached) throw new Error('identity is not loaded')
        const secrets = this.unprotect(this.cached.file)
        try {
            return fn(secrets)
        } finally {
            const sodium = await getSodium()
            sodium.memzero(secrets.signingSecretKey)
            sodium.memzero(secrets.encryptionSecretKey)
        }
    }

    private readyState(file: IdentityFile, identity: PublicIdentity): IdentityState {
        return {
            state: 'ready',
            identity,
            fingerprint: fingerprintOf(identity.signingPublicKey, identity.encryptionPublicKey),
            createdAt: file.createdAt
        }
    }

    private async readFile(): Promise<
        { kind: 'missing' } | { kind: 'damaged' } | { kind: 'ok'; file: IdentityFile }
    > {
        let raw: string
        try {
            raw = await fs.readFile(this.path, 'utf8')
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
            return { kind: 'damaged' }
        }
        try {
            return { kind: 'ok', file: identityFileSchema.parse(JSON.parse(raw)) }
        } catch {
            return { kind: 'damaged' }
        }
    }

    private unprotect(file: IdentityFile): Secrets {
        const plain = this.protector.decrypt(Buffer.from(file.protectedSecret, 'base64'))
        try {
            if (plain.length !== 96) throw new Error('wrong secret length')
            return {
                signingSecretKey: new Uint8Array(plain.subarray(0, 64)),
                encryptionSecretKey: new Uint8Array(plain.subarray(64, 96))
            }
        } finally {
            plain.fill(0)
        }
    }

    /** The stored secrets decrypt and belong to the stored public keys; otherwise the file is not usable. */
    private async check(file: IdentityFile): Promise<PublicIdentity | null> {
        const sodium = await getSodium()
        let secrets: Secrets
        try {
            secrets = this.unprotect(file)
        } catch {
            return null
        }
        try {
            const identity = toPublic(file)
            // libsodium's Ed25519 secret key is seed (32 bytes) || public key (32 bytes)
            const signingPk = secrets.signingSecretKey.subarray(32, 64)
            const encryptionPk = sodium.crypto_scalarmult_base(secrets.encryptionSecretKey)
            if (
                !sodium.memcmp(signingPk, identity.signingPublicKey) ||
                !sodium.memcmp(encryptionPk, identity.encryptionPublicKey)
            )
                return null
            return identity
        } catch {
            return null
        } finally {
            sodium.memzero(secrets.signingSecretKey)
            sodium.memzero(secrets.encryptionSecretKey)
        }
    }

    private async create(participantId: string): Promise<IdentityFile> {
        const sodium = await getSodium()
        const signing = sodium.crypto_sign_keypair()
        const encryption = sodium.crypto_box_keypair()
        const secret = Buffer.alloc(96)
        secret.set(signing.privateKey, 0)
        secret.set(encryption.privateKey, 64)
        try {
            const file: IdentityFile = {
                format: 'branchchat-identity',
                version: 1,
                participantId,
                createdAt: this.now(),
                signingPublicKey: b64(signing.publicKey),
                encryptionPublicKey: b64(encryption.publicKey),
                protectedSecret: this.protector.encrypt(secret).toString('base64')
            }
            await fs.mkdir(this.dir, { recursive: true })
            const text = JSON.stringify(file, null, 2)
            await writeFileAtomically(this.path, (tmp) => fs.writeFile(tmp, text, 'utf8'))
            return file
        } finally {
            secret.fill(0)
            sodium.memzero(signing.privateKey)
            sodium.memzero(encryption.privateKey)
        }
    }

    private async backUp(reason: 'unreadable' | 'other-participant'): Promise<void> {
        const stamp = this.now().replace(/[^0-9]/g, '')
        await fs.rename(this.path, `${this.path}.${reason}-${stamp}`).catch(() => undefined)
    }
}

function toPublic(file: IdentityFile): PublicIdentity {
    const signingPublicKey = fromB64(file.signingPublicKey)
    const encryptionPublicKey = fromB64(file.encryptionPublicKey)
    if (signingPublicKey.length !== 32 || encryptionPublicKey.length !== 32)
        throw new Error('wrong public key length')
    return { participantId: file.participantId, signingPublicKey, encryptionPublicKey }
}
