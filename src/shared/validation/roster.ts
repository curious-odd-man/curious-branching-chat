import { z } from 'zod'

/**
 * Roster of a synchronized discussion (ZIP entry `sync.json`, sync-protocol.md section 3.3, FR-154).
 * Only public keys are stored here, never private keys.
 */

export const SYNC_PROTOCOL_VERSION = 1

const isoUtc = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, 'timestamp must be ISO-8601 UTC (…Z)')

/** Standard base64 with padding of exactly 32 bytes (an Ed25519 or X25519 public key). */
export const publicKeySchema = z.string().regex(/^[A-Za-z0-9+/]{43}=$/, 'invalid public key')

/** 32 upper-case hex characters (sync-protocol.md section 4.1). */
export const fingerprintSchema = z.string().regex(/^[0-9A-F]{32}$/, 'invalid fingerprint')

export const previousKeySchema = z
    .object({
        signingPublicKey: publicKeySchema,
        encryptionPublicKey: publicKeySchema,
        fingerprint: fingerprintSchema,
        replacedAt: isoUtc
    })
    .passthrough()
export type PreviousKey = z.infer<typeof previousKeySchema>

export const rosterMemberSchema = z
    .object({
        participantId: z.string().min(1),
        displayName: z.string().min(1),
        signingPublicKey: publicKeySchema,
        encryptionPublicKey: publicKeySchema,
        fingerprint: fingerprintSchema,
        addedBy: z.string().min(1),
        addedAt: isoUtc,
        previousKeys: z.array(previousKeySchema).optional()
    })
    .passthrough()
export type RosterMember = z.infer<typeof rosterMemberSchema>

export const syncInfoSchema = z
    .object({
        protocolVersion: z.number().int().positive(),
        members: z.array(rosterMemberSchema)
    })
    .passthrough()
export type SyncInfo = z.infer<typeof syncInfoSchema>

/** Cross-reference checks for a roster. Returns a list of problems (empty = valid). */
export function checkRosterIntegrity(sync: SyncInfo): string[] {
    const problems: string[] = []
    const ids = new Set<string>()
    for (const m of sync.members) {
        if (ids.has(m.participantId)) problems.push(`duplicate member ${m.participantId}`)
        ids.add(m.participantId)
    }
    for (const m of sync.members) {
        if (!ids.has(m.addedBy)) problems.push(`member ${m.participantId}: unknown addedBy`)
    }
    return problems
}
