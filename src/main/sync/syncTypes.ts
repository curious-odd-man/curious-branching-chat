import type { EventType, VerifiedEvent } from '@shared/sync'
import type { DocumentContents, Message } from '@shared/validation'
import type { FolderTransport } from '../transport/folderTransport'
import type { OutboxKind, SyncState } from './syncState'

/** Types and constants of the sync engine (code review 4.1: the engine is split into units). */
/** What the sync service needs from the discussion: the open window's session, or the file (design section 10). */
export interface DocumentPort {
    read(): Promise<DocumentContents>
    /**
     * Applies a change in the same write queue as local changes. `images` are image bytes to write into the file
     * (assets that the change registers). Returning null means "no change".
     */
    update(
        change: (contents: DocumentContents) => {
            contents: DocumentContents
            images: Array<{ assetId: string; data: Uint8Array }>
        } | null
    ): Promise<void>
    /** Bytes of an image of the discussion (for sending it as parts). */
    imageBytes(assetId: string): Promise<Uint8Array | null>
    /** Bytes of an attachment (by hash), for sending it as parts. */
    blobBytes?(sha256: string): Promise<Uint8Array | null>
    /** True if the bytes of an attachment are here. */
    hasBlob?(sha256: string): Promise<boolean>
    /** Stores the checked bytes of an attachment of another member. */
    storeBlob?(sha256: string, data: Uint8Array, type: string): Promise<void>
}

export interface OwnKeys {
    sign(data: Uint8Array): Promise<Uint8Array>
    open(sealed: Uint8Array): Promise<Uint8Array | null>
}

export interface ConversationSyncDeps {
    conversationId: string
    ownId: string
    transport: FolderTransport
    state: SyncState
    keys: OwnKeys
    document: DocumentPort
    now: () => string
    newId: () => string
    maxFileBytes: () => number
    appVersion: string
    /** Wait before a file counts as stable (sync-protocol.md 9.6); 0 in tests. */
    stableMs?: number
    /** Called when the loading messages or the sync status change (for the window). */
    onChange?: () => void
    /**
     * Messages of other members that a scan added to the discussion (complete, with all parts), in the order of
     * the discussion (D-33, D-38). Not called for the history of an invitation.
     */
    onNewMessages?: (messages: Message[], contents: DocumentContents) => void
    /** Bytes of attachments of others arrived (the window shows them). */
    onAttachments?: () => void
    log?: (message: string) => void
}

/** Folder state for the status line (D-35, FR-172). */
export type FolderHealth = 'ok' | 'missing' | 'no-permission'

export interface SyncHealth {
    folder: FolderHealth
    /** Files in the own inbox that could not be used (damaged, not from a member, too large). */
    quarantined: number
    /** Files that need a newer version of the application (sync-protocol.md section 10). */
    needsUpdate: boolean
    /** D-32: new keys of other members that wait for this member's decision (or that it rejected). */
    keyRequests: Array<{
        participantId: string
        fingerprint: string
        state: 'pending' | 'rejected'
    }>
    /** D-32: after a re-invitation, the members from whom nothing opened yet (null: not re-invited). */
    rejoinHeardFrom: string[] | null
    lastScanAt: string | null
}

export type CopyState = 'pending' | 'written' | 'delivered'

/** Delivery of one own message (D-09, FR-169): per recipient and for all recipients together. */
export interface MessageDelivery {
    state: CopyState
    members: Record<string, CopyState>
}

/** The retry rule and age-based cleanup (D-29, D-34). */
export const RETRY_INTERVAL_MS = 30 * 60_000
export const RECEIPT_MAX_AGE_MS = 7 * 24 * 60 * 60_000
export const UNCONFIRMED_MAX_AGE_MS = 30 * 24 * 60 * 60_000

export interface MaintenanceReport {
    rewritten: number
    receiptsDeleted: number
    abandoned: number
}

export interface ScanReport {
    applied: number
    receipts: number
    held: number
    quarantined: number
    needsUpdate: number
}

export const EXTENSION: Record<OutboxKind, string> = {
    event: 'bcmsg',
    part: 'bcpart',
    receipt: 'bcrcpt',
    invitation: 'bcinv',
    'invitation.part': 'bcpart'
}

export const DOCUMENT_TYPES = new Set<EventType>([
    'reaction.set',
    'message.attachments',
    'message.sent',
    'branch.created',
    'branch.status.set',
    'branch.title.set',
    'readstate.added',
    'delivery.added',
    'member.added',
    'profile.updated'
])

export const eventKey = (e: VerifiedEvent): string => `${e.senderId}:${e.eventId}`
/** File in the parts store for the bytes of a complete image that waits (no ':' in Windows file names). */
export const imageFile = (assetId: string): string => `image-${assetId}`
