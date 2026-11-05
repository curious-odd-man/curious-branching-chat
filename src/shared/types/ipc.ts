import type { DiscussionData, ReadState } from '../validation/schemas'

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
  branchCreate: 'branch:create',
  branchSetStatus: 'branch:set-status',
  branchSetTitle: 'branch:set-title',
  /** main -> renderer */
  documentChanged: 'document:changed',
  menuCommand: 'menu:command'
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
}

/** Everything a window needs to show its discussion. */
export interface DocumentView {
  documentId: string
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
}

export type IpcResult<T> =
  { ok: true; data: T } | { ok: false; error: { code: string; message: string } }

export type OpenStatus = 'opened' | 'focused' | 'cancelled' | 'failed'
export interface OpenOutcome {
  status: OpenStatus
  /** Set when status is 'failed'. The user has already been told (dialog); this is for the caller. */
  errorCode?: string
}

export type MenuCommand = 'new' | 'open'
