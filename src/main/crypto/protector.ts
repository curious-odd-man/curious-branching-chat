import { safeStorage } from 'electron'
import type { KeyProtector } from './keyStore'

/**
 * Electron `safeStorage` (FR-156): on Windows this is DPAPI, bound to the Windows user account. On Linux the
 * "basic_text" backend is not real protection, so it counts as not available.
 * safeStorage works on strings; the secret is passed as base64 text.
 */
export const safeStorageProtector: KeyProtector = {
    isAvailable() {
        if (!safeStorage.isEncryptionAvailable()) return false
        if (
            process.platform === 'linux' &&
            safeStorage.getSelectedStorageBackend() === 'basic_text'
        )
            return false
        return true
    },
    encrypt(plain) {
        return safeStorage.encryptString(plain.toString('base64'))
    },
    decrypt(sealed) {
        return Buffer.from(safeStorage.decryptString(sealed), 'base64')
    }
}
