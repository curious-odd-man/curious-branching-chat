import type { Attachment, DiscussionData, Participant, ReadState } from '../validation/schemas'
import type { Language } from '../i18n'
import type { LoadingMessage } from '../sync/loading'

/** IPC channel names shared by main and preload. */
export const IPC = {
    appInfo: 'app:info',
    settingsGet: 'settings:get',
    settingsSetName: 'settings:set-name',
    documentNew: 'document:new',
    documentOpenDialog: 'document:open-dialog',
    documentOpenPath: 'document:open-path',
    documentOpenId: 'document:open-id',
    documentOpenIdNewWindow: 'document:open-id-new-window',
    documentExport: 'document:export',
    documentGetState: 'document:get-state',
    documentAppendMessage: 'document:append-message',
    documentRetrySave: 'document:retry-save',
    draftSave: 'draft:save',
    draftsGet: 'drafts:get',
    draftsFlushed: 'drafts:flushed',
    /** main -> renderer: save the waiting drafts now (the window closes or shows another discussion). */
    draftsFlushRequest: 'drafts:flush-request',
    linkOpen: 'link:open',
    readMarkMessage: 'read:mark-message',
    readMarkThread: 'read:mark-thread',
    readMarkAll: 'read:mark-all',
    settingsAckReadNotice: 'settings:ack-read-notice',
    settingsSetAutoUpdate: 'settings:set-auto-update',
    settingsSetRecentLimit: 'settings:set-recent-limit',
    settingsSetOpenLast: 'settings:set-open-last',
    settingsSetFileSizeLimit: 'settings:set-file-size-limit',
    settingsSetBackgroundFlag: 'settings:set-background-flag',
    settingsSetSidebar: 'settings:set-sidebar',
    settingsSetTextSize: 'settings:set-text-size',
    zoomChange: 'zoom:change',
    focusTake: 'focus:take',
    libraryList: 'library:list',
    searchDiscussion: 'search:discussion',
    searchAll: 'search:all',
    documentOpenAt: 'document:open-at',
    backupGet: 'backup:get',
    backupNow: 'backup:now',
    backupPickFolder: 'backup:pick-folder',
    backupClearFolder: 'backup:clear-folder',
    backupRestore: 'backup:restore',
    migrationGet: 'migration:get',
    migrationRun: 'migration:run',
    migrationSkip: 'migration:skip',
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
    reactionToggle: 'reaction:toggle',
    attachmentPick: 'attachment:pick',
    attachmentAddPaths: 'attachment:add-paths',
    attachmentAddBytes: 'attachment:add-bytes',
    attachmentSave: 'attachment:save',
    attachmentOpen: 'attachment:open',
    attachmentReceivers: 'attachment:receivers',
    settingsSetAttachmentLimit: 'settings:set-attachment-limit',
    settingsSetLanguage: 'settings:set-language',
    /** Synchronous: the language that this process runs with (the preload script reads it once). */
    languageGet: 'language:get',
    appRelaunch: 'app:relaunch',

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
    sharedInvite: 'shared:invite',
    sharedReinvite: 'shared:reinvite',
    syncDecideKeys: 'sync:decide-keys',
    sharedRoster: 'shared:roster',
    joinFind: 'join:find',
    joinImport: 'join:import',
    syncCheckNow: 'sync:check-now',
    identityGet: 'identity:get',
    identityCopyBundle: 'identity:copy-bundle',
    identitySaveBundle: 'identity:save-bundle',
    menuCommand: 'menu:command',
    focusRequest: 'focus:request',
    settingsChanged: 'settings:changed',
    /** main -> renderer: the list of discussions in the library changed. */
    libraryChanged: 'library:changed',
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
    /** How many recently opened discussions the File menu and the jump list show. 0 turns them off. Default 10. */
    recentFilesLimit: number
    /** Open the most recently used discussion when the application starts without a file. On by default. */
    openLastFileOnStartup: boolean
    /** Largest file read from a shared folder, in MB (FR-166). */
    fileSizeLimitMb: number
    /** Windows notifications for new messages of other members (FR-175). On by default. */
    notifyNewMessages: boolean
    /** The message text in those notifications (D-38). On by default. */
    notifyShowText: boolean
    /** Start with Windows, in the tray (FR-174). Turned on with the first synchronized discussion. */
    startWithWindows: boolean
    /** The first synchronized discussion (or the person) has decided it; the wizard then says nothing (FR-174). */
    startWithWindowsSettled: boolean
    /** FR-301: text size of all windows, in percent (80–200). */
    textSize: number
    /** FR-222, FR-223: the discussion list of the windows. */
    sidebar: SidebarSettings
    /** FR-207: the folder for backups that the person chose, or null. */
    backupFolder: string | null
    /** FR-265: the largest file that can be attached, in MB (default 100). */
    attachmentLimitMb: number
    /** FR-292: the language of the interface (the one that runs now may differ until a restart, FR-293). */
    language: Language
}

/** FR-261: the result of adding files to a draft; refused files are named with the reason. */
export interface AttachResult {
    added: Attachment[]
    refused: Array<{ name: string; reason: 'too-large' | 'unreadable' | 'too-many' }>
    limitMb: number
}

/** FR-251: a kept draft of a branch: editor JSON and attached files. */
export interface DraftView {
    content: unknown
    attachments: Attachment[]
}

/** FR-268: members that will not get a file because their limit is smaller. */
export interface SmallLimit {
    displayName: string
    maxFileMb: number
}

export interface SidebarSettings {
    hidden: boolean
    /** Width in pixels (180 to 480). */
    width: number
    sort: 'activity' | 'name'
}

/** FR-207: the backup section of Settings. */
export interface BackupState {
    lastBackupAt: string | null
    folder: string | null
    backups: BackupView[]
}

/** The result of "Резервная копия сейчас". */
export interface BackupResult {
    createdAt: string
    /** The folder of the person could not be written (the app folder was). */
    folderError: string | null
}

/** On/off settings of the background section. */
export type BackgroundFlag = 'notifyNewMessages' | 'notifyShowText' | 'startWithWindows'

/** FR-211 to FR-215: one search result (a message, or a branch whose title matches). */
export interface SearchHit {
    kind: 'message' | 'branch'
    discussionId: string
    discussionTitle: string
    threadId: string
    /** The branch name; empty for the main thread. */
    threadLabel: string
    /** Null for a branch title. */
    messageId: string | null
    authorName: string
    createdAt: string
    /** The text around the match. */
    snippet: string
    /** The matches in `snippet`, as [start, end). */
    marks: Array<[number, number]>
}

/** FR-207: one backup of the library. */
export interface BackupView {
    /** The backup folder (passed back to restore it). */
    path: string
    /** app: %APPDATA%\BranchChat\backups; folder: the folder chosen in Settings. */
    place: 'app' | 'folder'
    createdAt: string
    reason: 'daily' | 'manual' | 'migration' | 'restore'
    /** The database and the images, in bytes. */
    size: number
    discussions: number
    messages: number
}

/** FR-206: a discussion file of the earlier storage, offered for the library at the first start. */
export interface MigrationCandidate {
    path: string
    /** File name without the extension. */
    name: string
    /** False: the file is not where the recent list or the registry says (shown, not selectable). */
    exists: boolean
    /** A synchronized discussion of this computer (registered). */
    synced: boolean
}

export interface MigrationResult {
    path: string
    name: string
    status: 'imported' | 'merged' | 'failed'
    synced: boolean
    id?: string
    errorCode?: string
}

/** A discussion of the library, as shown on the start screen and in menus (most recently used first). */
export interface DiscussionListItem {
    id: string
    title: string
    /** Time of the newest message, or null for a discussion without messages. */
    lastMessageAt: string | null
    messageCount: number
    synced: boolean
    /** Messages of others that this person has not read (FR-221). */
    unreadCount: number
    /** An unsent draft in some branch (FR-253). */
    hasDraft: boolean
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
type FolderTestView =
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
          /** D-15: a re-invitation after key loss. */
          rejoin: boolean
      }
    | { state: 'already'; conversationId: string }

export interface RosterView {
    /** The shared folder of this discussion on this computer (the invite wizard reads keys there). */
    sharedRoot: string
    members: Array<{
        participantId: string
        displayName: string
        fingerprint: string
        state: 'self' | 'invited' | 'joined' | 'member'
        /** Who added this member (FR-176); null for the person who created the discussion. */
        addedByName: string | null
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
    discussion: DiscussionData
    readState: ReadState
    localParticipantId: string
    /** Assets listed in the discussion whose data is missing from the file (placeholders, FR-075). */
    missingAssetIds: string[]
    /** Attachments (hashes) whose bytes are not here: loading, too large (FR-268a), or missing. */
    missingAttachments: string[]
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
    /** Own outbox: the copy state per recipient, by message ID (FR-169); empty for a normal discussion. */
    copies: Record<string, Record<string, CopyStateView>>
    /** Which messages each member has received (`delivery.json`, D-41); empty for a normal discussion. */
    deliveryState: ReadState
    /** Sync health for the status line (FR-172); null for a normal discussion. */
    syncStatus: SyncStatusView | null
}

type CopyStateView = 'pending' | 'written' | 'delivered'

export interface SyncStatusView {
    folder: 'ok' | 'missing' | 'no-permission'
    folderPath: string
    quarantined: number
    needsUpdate: boolean
    lastScanAt: string | null
    /** D-32: another member re-invited this person with new keys; this member checks the fingerprint and decides. */
    keyRequests: Array<{
        participantId: string
        displayName: string
        /** 8 groups of 4 */
        fingerprint: string
        state: 'pending' | 'rejected'
    }>
    /** D-32: this member was re-invited; these members have not accepted the new keys yet (names). */
    notAccepted: string[]
}

/** The part of a DocumentView that changes when a save finishes. */
export interface DocumentStatus {
    saving: boolean
    saveError: string | null
}

export type IpcResult<T> =
    { ok: true; data: T } | { ok: false; error: { code: string; message: string } }

type OpenStatus = 'opened' | 'focused' | 'cancelled' | 'failed'
export interface OpenOutcome {
    status: OpenStatus
    /** Set when status is 'failed'. The user has already been told (dialog); this is for the caller. */
    errorCode?: string
}

/** A message the window must show (a click on a notification, D-33). */
export interface FocusRequest {
    documentId: string
    threadId: string
    messageId: string
}

export type MenuCommand =
    | 'new'
    | 'open'
    | 'settings'
    | 'new-shared'
    | 'join-shared'
    | 'make-shared'
    | 'invite-member'
    | 'shortcuts'
    | 'jump-to-date'
    | 'restore'
    | 'find'
    | 'find-all'
    | 'branch-map'

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

type UpdatePhase =
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
