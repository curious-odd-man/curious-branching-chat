import type { DiscussionData, Participant, ReadState } from '../validation/schemas'
import type { LoadingMessage } from '../sync/loading'

/** IPC channel names shared by main and preload. */
export const IPC = {
    appInfo: 'app:info',
    settingsGet: 'settings:get',
    settingsSetName: 'settings:set-name',
    documentNew: 'document:new',
    documentOpenDialog: 'document:open-dialog',
    documentOpenPath: 'document:open-path',
    documentGetState: 'document:get-state',
    documentAppendMessage: 'document:append-message',
    documentRetrySave: 'document:retry-save',
    draftSet: 'draft:set',
    linkOpen: 'link:open',
    readMarkMessage: 'read:mark-message',
    readMarkThread: 'read:mark-thread',
    readMarkAll: 'read:mark-all',
    settingsAckReadNotice: 'settings:ack-read-notice',
    settingsSetAutoUpdate: 'settings:set-auto-update',
    settingsSetRecentLimit: 'settings:set-recent-limit',
    settingsSetOpenLast: 'settings:set-open-last',
    settingsSetFileSizeLimit: 'settings:set-file-size-limit',
    recentGet: 'recent:get',
    recentRemove: 'recent:remove',
    recentClear: 'recent:clear',
    updateGetState: 'update:get-state',
    updateCheck: 'update:check',
    updateDownload: 'update:download',
    updateInstall: 'update:install',
    updateShowDialog: 'update:show-dialog',
    updateDismiss: 'update:dismiss',
    updateOpenReleasePage: 'update:open-release-page',
    associationGet: 'association:get',
    associationSet: 'association:set',
    imageStage: 'image:stage',
    imagePick: 'image:pick',
    branchCreate: 'branch:create',
    branchSetStatus: 'branch:set-status',
    branchSetTitle: 'branch:set-title',
    /** main -> renderer */
    documentChanged: 'document:changed',
    /** main -> renderer: only the save status changed (a save finished); sent instead of the whole discussion. */
    documentStatusChanged: 'document:status-changed',
    sharedPickFolder: 'shared:pick-folder',
    sharedPublishKey: 'shared:publish-key',
    sharedCandidates: 'shared:candidates',
    sharedParseKey: 'shared:parse-key',
    sharedPickKeyFile: 'shared:pick-key-file',
    sharedCreate: 'shared:create',
    sharedRoster: 'shared:roster',
    joinFind: 'join:find',
    joinImport: 'join:import',
    syncCheckNow: 'sync:check-now',
    identityGet: 'identity:get',
    identityCopyBundle: 'identity:copy-bundle',
    identitySaveBundle: 'identity:save-bundle',
    menuCommand: 'menu:command',
    /** main -> renderer: the recent files list changed. */
    recentChanged: 'recent:changed',
    updateChanged: 'update:changed'
} as const

export interface AppInfo {
    name: string
    version: string
}

export interface SettingsView {
    participantId: string
    displayName: string | null
    /** The one-time notice about visible read status has been shown (FR-125). */
    readNoticeAcknowledged: boolean
    /** The question about opening .branchchat files in BranchChat has been settled (installer or app, FR-136). */
    associationAsked: boolean
    /** Check for updates in the background (FR-097). On by default. */
    autoUpdateCheck: boolean
    /** How many recently opened files are remembered. 0 turns the list off. Default 10. */
    recentFilesLimit: number
    /** Open the most recently used discussion when the application starts without a file. On by default. */
    openLastFileOnStartup: boolean
    /** Largest file read from a shared folder, in MB (FR-166). */
    fileSizeLimitMb: number
}

/** A recently opened discussion, as shown on the start screen and in menus. */
export interface RecentFileView {
    path: string
    /** File name without the extension. */
    name: string
    /** Folder that contains the file. */
    directory: string
    /** False when the file is no longer where it was (moved, deleted, drive not connected). */
    exists: boolean
}

/**
 * Whether double-clicking a `.branchchat` file opens BranchChat.
 * - `on`: registered for BranchChat
 * - `off`: not registered, and free to register
 * - `other-app`: another program holds the type, or the person chose another program in Windows (never taken over)
 * - `unsupported`: not a Windows installation of BranchChat (development run, other platform)
 */
export type AssociationState = 'on' | 'off' | 'other-app' | 'unsupported'

export interface AssociationInfo {
    state: AssociationState
}

/** Result of the folder test (design 12.3, step 5). */
export type FolderTestView =
    { ok: true } | { ok: false; step: 'root' | 'write' | 'read' | 'delete'; code: string }

export interface SharedFolderChoice {
    path: string
    test: FolderTestView
}

/** A public key that could become a member: name and fingerprint to check (FR-162). */
export interface CandidateView {
    participantId: string
    displayName: string
    fingerprint: string
    /** The bundle in text form; sent back when the person accepts the candidate. */
    text: string
}

export type InvitationView =
    | { state: 'waiting' }
    | { state: 'incomplete'; received: number; total: number }
    | {
          state: 'ready'
          invitationId: string
          conversationId: string
          title: string
          inviterName: string
          inviterFingerprint: string
      }
    | { state: 'already'; conversationId: string }

export interface RosterView {
    members: Array<{
        participantId: string
        displayName: string
        fingerprint: string
        state: 'self' | 'invited' | 'joined' | 'member'
    }>
}

/** The encryption key section of Settings (FR-155 to FR-157). Never contains private keys. */
export type IdentityView =
    | {
          state: 'ready'
          /** 8 groups of 4 characters */
          fingerprint: string
          /** An earlier key could not be used and was replaced by a new one. */
          replaced: 'unreadable' | 'other-participant' | null
      }
    /** Windows data protection is not available, so no keys are created (FR-156). */
    | { state: 'unavailable' }

/** Everything a window needs to show its discussion. */
export interface DocumentView {
    documentId: string
    /** Identifies this open window's discussion in image URLs (see assets.ts). */
    sessionId: string
    filePath: string
    fileName: string
    discussion: DiscussionData
    readState: ReadState
    localParticipantId: string
    /** Assets listed in the discussion whose data is missing from the file (placeholders, FR-075). */
    missingAssetIds: string[]
    /** Set when the last write to the file failed (FR-008). */
    saveError: string | null
    /** True while a write is pending or running. */
    saving: boolean
    notices: string[]
    /** This window's file is the registered copy of a synchronized discussion (FR-158 to FR-168). */
    synced: boolean
    /** Participants who count for the read indicator; roster members in a synchronized discussion (FR-163). */
    knownParticipants: Participant[]
    /** Messages whose header arrived but some parts not yet (FR-165, D-37). */
    loading: LoadingMessage[]
    /** Delivery of the own messages, by message ID (FR-169); empty for a normal discussion. */
    delivery: Record<string, DeliveryView>
    /** Sync health for the status line (FR-172); null for a normal discussion. */
    syncStatus: SyncStatusView | null
}

export type CopyStateView = 'pending' | 'written' | 'delivered'

export interface DeliveryView {
    state: CopyStateView
    members: Array<{ participantId: string; displayName: string; state: CopyStateView }>
}

export interface SyncStatusView {
    folder: 'ok' | 'missing' | 'no-permission'
    folderPath: string
    quarantined: number
    needsUpdate: boolean
    lastScanAt: string | null
}

/** The part of a DocumentView that changes when a save finishes. */
export interface DocumentStatus {
    saving: boolean
    saveError: string | null
}

export type IpcResult<T> =
    { ok: true; data: T } | { ok: false; error: { code: string; message: string } }

export type OpenStatus = 'opened' | 'focused' | 'cancelled' | 'failed'
export interface OpenOutcome {
    status: OpenStatus
    /** Set when status is 'failed'. The user has already been told (dialog); this is for the caller. */
    errorCode?: string
}

export type MenuCommand = 'new' | 'open' | 'settings' | 'new-shared' | 'join-shared' | 'make-shared'

/** What the person is told about an available update (FR-098). Notes are plain text. */
export interface UpdateInfoView {
    version: string
    /** ISO timestamp of the release, if published. */
    releaseDate: string | null
    notes: string | null
    sizeBytes: number | null
    /** True when the release page on GitHub can be opened (FR-099). */
    hasReleasePage: boolean
}

export type UpdatePhase =
    'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'error'

export interface UpdateView {
    phase: UpdatePhase
    info: UpdateInfoView | null
    /** Download progress, 0 to 100. */
    percent: number
    /** Set when phase is 'error'. */
    errorCode: string | null
    /** The update dialog is open. Automatic checks do not open it; they only show a small banner. */
    dialogOpen: boolean
    currentVersion: string
}
