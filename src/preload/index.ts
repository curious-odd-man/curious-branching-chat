import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { BranchChatApi } from '@shared/types/api'
import {
    IPC,
    type DocumentStatus,
    type DocumentView,
    type IpcResult,
    type MenuCommand,
    type DiscussionListItem,
    type SettingsView,
    type UpdateView
} from '@shared/types/ipc'

const invoke = <T>(channel: string, payload?: unknown): Promise<IpcResult<T>> =>
    ipcRenderer.invoke(channel, payload) as Promise<IpcResult<T>>

function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
    // The Electron event object is never handed to the page.
    const listener = (_event: unknown, value: T): void => callback(value)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
}

const api: BranchChatApi = {
    getAppInfo: () => invoke(IPC.appInfo),
    pickSharedFolder: () => invoke(IPC.sharedPickFolder),
    publishOwnKey: (root) => invoke(IPC.sharedPublishKey, { root }),
    listCandidates: (root) => invoke(IPC.sharedCandidates, { root }),
    parseKey: (text) => invoke(IPC.sharedParseKey, { text }),
    pickKeyFile: () => invoke(IPC.sharedPickKeyFile),
    createShared: (root, keys, mode, title) =>
        invoke(IPC.sharedCreate, { root, keys, mode, ...(title !== undefined ? { title } : {}) }),
    inviteMembers: (keys) => invoke(IPC.sharedInvite, { keys }),
    reinviteMember: (participantId, key) => invoke(IPC.sharedReinvite, { participantId, key }),
    decideKeys: (participantId, accept) => invoke(IPC.syncDecideKeys, { participantId, accept }),
    getRoster: () => invoke(IPC.sharedRoster),
    findInvitation: (root) => invoke(IPC.joinFind, { root }),
    importInvitation: (root, invitationId) => invoke(IPC.joinImport, { root, invitationId }),
    checkSyncNow: () => invoke(IPC.syncCheckNow),
    getIdentity: () => invoke(IPC.identityGet),
    copyKeyBundle: () => invoke(IPC.identityCopyBundle),
    saveKeyBundle: () => invoke(IPC.identitySaveBundle),
    getSettings: () => invoke(IPC.settingsGet),
    setDisplayName: (displayName) => invoke(IPC.settingsSetName, { displayName }),
    newDocument: (title) => invoke(IPC.documentNew, { title }),
    openDocumentDialog: () => invoke(IPC.documentOpenDialog),
    openPath: (path) => invoke(IPC.documentOpenPath, { path }),
    openDiscussion: (id) => invoke(IPC.documentOpenId, { id }),
    openDiscussionInNewWindow: (id) => invoke(IPC.documentOpenIdNewWindow, { id }),
    deleteDiscussion: (id) => invoke(IPC.documentDelete, { id }),
    searchDiscussion: (query) => invoke(IPC.searchDiscussion, { query }),
    searchAll: (query) => invoke(IPC.searchAll, { query }),
    openAt: (id, threadId, messageId) => invoke(IPC.documentOpenAt, { id, threadId, messageId }),
    exportDiscussion: () => invoke(IPC.documentExport),
    getDocumentState: () => invoke(IPC.documentGetState),
    appendMessage: (threadId, content, attachments) =>
        invoke(IPC.documentAppendMessage, {
            threadId,
            content,
            ...(attachments && attachments.length > 0 ? { attachments } : {})
        }),
    toggleReaction: (messageId, emoji) => invoke(IPC.reactionToggle, { messageId, emoji }),
    pickAttachments: () => invoke(IPC.attachmentPick),
    addAttachmentPaths: (paths) => invoke(IPC.attachmentAddPaths, { paths }),
    addAttachmentBytes: (name, type, data) => invoke(IPC.attachmentAddBytes, { name, type, data }),
    saveAttachment: (messageId, index) => invoke(IPC.attachmentSave, { messageId, index }),
    openAttachment: (messageId, index) => invoke(IPC.attachmentOpen, { messageId, index }),
    attachmentReceivers: (size) => invoke(IPC.attachmentReceivers, { size }),
    setAttachmentLimit: (mb) => invoke(IPC.settingsSetAttachmentLimit, { mb }),
    setLanguage: (language) => invoke(IPC.settingsSetLanguage, { language }),
    relaunch: () => invoke(IPC.appRelaunch),
    // read once, synchronously, so the first render already has the right texts (FR-293: no live switch)
    language: ipcRenderer.sendSync(IPC.languageGet) === 'en' ? 'en' : 'ru',
    retrySave: () => invoke(IPC.documentRetrySave),
    saveDraft: (threadId, content, attachments) =>
        invoke(IPC.draftSave, {
            threadId,
            content,
            ...(attachments && attachments.length > 0 ? { attachments } : {})
        }),
    getDrafts: () => invoke(IPC.draftsGet),
    onDraftsFlushRequest: (callback) => subscribe<string>(IPC.draftsFlushRequest, callback),
    draftsFlushed: (token) => invoke(IPC.draftsFlushed, { token }),
    openLink: (url) => invoke(IPC.linkOpen, { url }),
    stageImage: (data) => invoke(IPC.imageStage, { data }),
    pickImage: () => invoke(IPC.imagePick),
    markMessageRead: (messageId) => invoke(IPC.readMarkMessage, { messageId }),
    markThreadRead: (threadId) => invoke(IPC.readMarkThread, { threadId }),
    markAllRead: () => invoke(IPC.readMarkAll),
    acknowledgeReadNotice: () => invoke(IPC.settingsAckReadNotice),
    setAutoUpdateCheck: (enabled) => invoke(IPC.settingsSetAutoUpdate, { enabled }),
    setRecentFilesLimit: (limit) => invoke(IPC.settingsSetRecentLimit, { limit }),
    setOpenLastFileOnStartup: (enabled) => invoke(IPC.settingsSetOpenLast, { enabled }),
    setFileSizeLimit: (mb) => invoke(IPC.settingsSetFileSizeLimit, { mb }),
    setBackgroundFlag: (flag, enabled) => invoke(IPC.settingsSetBackgroundFlag, { flag, enabled }),
    setTextSize: (percent) => invoke(IPC.settingsSetTextSize, { percent }),
    setSidebar: (change) => invoke(IPC.settingsSetSidebar, change),
    setArchived: (id, archived) => invoke(IPC.settingsSetArchived, { id, archived }),
    zoom: (direction) => invoke(IPC.zoomChange, { direction }),
    takeFocusRequest: () => invoke(IPC.focusTake),
    getDiscussions: () => invoke(IPC.libraryList),
    getBackups: () => invoke(IPC.backupGet),
    backupNow: () => invoke(IPC.backupNow),
    pickBackupFolder: () => invoke(IPC.backupPickFolder),
    clearBackupFolder: () => invoke(IPC.backupClearFolder),
    restoreBackup: (path) => invoke(IPC.backupRestore, { path }),
    getMigration: () => invoke(IPC.migrationGet),
    runMigration: (paths) => invoke(IPC.migrationRun, { paths }),
    skipMigration: () => invoke(IPC.migrationSkip),
    onDiscussionsChanged: (callback) =>
        subscribe<DiscussionListItem[]>(IPC.libraryChanged, callback),
    getUpdateState: () => invoke(IPC.updateGetState),
    checkForUpdates: () => invoke(IPC.updateCheck),
    downloadUpdate: () => invoke(IPC.updateDownload),
    installUpdate: () => invoke(IPC.updateInstall),
    showUpdateDialog: () => invoke(IPC.updateShowDialog),
    dismissUpdateDialog: () => invoke(IPC.updateDismiss),
    openReleasePage: () => invoke(IPC.updateOpenReleasePage),
    onUpdateChanged: (callback) => subscribe<UpdateView>(IPC.updateChanged, callback),
    getAssociation: () => invoke(IPC.associationGet),
    setAssociation: (enabled) => invoke(IPC.associationSet, { enabled }),
    createBranch: (sourceMessageId, selectionStart, selectionEnd) =>
        invoke(IPC.branchCreate, { sourceMessageId, selectionStart, selectionEnd }),
    setBranchStatus: (threadId, status) => invoke(IPC.branchSetStatus, { threadId, status }),
    setBranchTitle: (threadId, title) => invoke(IPC.branchSetTitle, { threadId, title }),
    onDocumentChanged: (callback) => subscribe<DocumentView | null>(IPC.documentChanged, callback),
    onDocumentStatusChanged: (callback) =>
        subscribe<DocumentStatus>(IPC.documentStatusChanged, callback),
    onMenuCommand: (callback) => subscribe<MenuCommand>(IPC.menuCommand, callback),
    onFocusRequest: (callback) => subscribe<undefined>(IPC.focusRequest, () => callback()),
    onSettingsChanged: (callback) => subscribe<SettingsView>(IPC.settingsChanged, callback),
    getPathForFile: (file) => webUtils.getPathForFile(file as File)
}

contextBridge.exposeInMainWorld('branchchat', api)
