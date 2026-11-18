import type { Author } from '@shared/domain'
import type { DocumentContents } from '@shared/types'
import { normalizeSynced } from '@shared/sync'
import type { SyncInfo } from '@shared/validation'
import { b64, fingerprintOf } from '../../src/main/crypto/identity'
import { getSodium } from '../../src/main/crypto/sodium'
import { newDocumentContents } from '../../src/main/document/factory'
import { makeCtx } from './fixtures'

/** Test keys of one member: the key pairs, and the sign/open functions that a key store gives the sync engine. */
export async function makeKeys() {
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

export type TestKeys = Awaited<ReturnType<typeof makeKeys>>

/**
 * The first state of a synchronized discussion that all `people` share: a roster with their keys (added by the first
 * person) and the document ID `documentId`.
 */
export function sharedStart(
    people: readonly Author[],
    keys: readonly TestKeys[],
    documentId: string,
    addedAt: string
): DocumentContents {
    const roster: SyncInfo = {
        protocolVersion: 1,
        members: people.map((a, i) => ({
            participantId: a.participantId,
            displayName: a.displayName,
            signingPublicKey: b64(keys[i]!.sign.publicKey),
            encryptionPublicKey: b64(keys[i]!.box.publicKey),
            fingerprint: fingerprintOf(keys[i]!.sign.publicKey, keys[i]!.box.publicKey),
            addedBy: people[0]!.participantId,
            addedAt
        }))
    }
    const start = normalizeSynced({
        ...newDocumentContents(makeCtx('s'), { title: 'Общее', author: people[0]! }),
        sync: roster
    })
    start.manifest.documentId = documentId
    return start
}
