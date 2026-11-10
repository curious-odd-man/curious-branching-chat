import { promises as fs } from 'node:fs'
import type { BrowserWindow } from 'electron'
import type { KeyBundle } from '@shared/sync'
import type { IdentityView } from '@shared/types/ipc'
import { AppError } from '../application/errors'
import type { SettingsStore } from '../local-state/settings'
import { groupFingerprint, keyBundleToFile, keyBundleToText, makeKeyBundle } from './identity'
import type { KeyStore } from './keyStore'

export interface IdentityServiceDeps {
    keys: KeyStore
    settings: SettingsStore
    now: () => string
    writeClipboard(text: string): void
    /** Save dialog for a `.bckey` file; null if cancelled. */
    pickBundlePath(parent: BrowserWindow | undefined, defaultName: string): Promise<string | null>
}

/** The "Ключ шифрования" section of Settings (FR-155 to FR-157). */
export class IdentityService {
    constructor(private readonly deps: IdentityServiceDeps) {}

    /** Creates the keys on first use (FR-155). */
    async view(): Promise<IdentityView> {
        const { participantId } = this.deps.settings.get()
        const { identity, replaced } = await this.deps.keys.ensure(participantId)
        if (identity.state !== 'ready') return { state: 'unavailable' }
        return {
            state: 'ready',
            fingerprint: groupFingerprint(identity.fingerprint),
            replaced
        }
    }

    /** The signed public-key bundle; needs a participant name, because the bundle carries it. */
    async bundle(): Promise<KeyBundle> {
        const { participantId, displayName } = this.deps.settings.get()
        if (!displayName) throw new AppError('NAME_REQUIRED', 'A participant name is required')
        const { identity } = await this.deps.keys.ensure(participantId)
        if (identity.state !== 'ready')
            throw new AppError('KEYS_UNAVAILABLE', 'Windows data protection is not available')
        return makeKeyBundle(identity.identity, displayName, this.deps.now(), (data) =>
            this.deps.keys.sign(participantId, data)
        )
    }

    /** "Скопировать мой ключ": the text form goes to the clipboard (FR-157). */
    async copyBundle(): Promise<void> {
        this.deps.writeClipboard(keyBundleToText(await this.bundle()))
    }

    /** "Сохранить мой ключ…": writes a `.bckey` file. Resolves false if the person cancelled (FR-157). */
    async saveBundle(parent: BrowserWindow | undefined): Promise<boolean> {
        const bundle = await this.bundle()
        const safeName = bundle.displayName.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'key'
        const path = await this.deps.pickBundlePath(parent, `${safeName}.bckey`)
        if (!path) return false
        try {
            await fs.writeFile(path, keyBundleToFile(bundle), 'utf8')
        } catch {
            throw new AppError('WRITE_FAILED', 'Cannot write the key file')
        }
        return true
    }
}
