import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { BranchChatApi } from '@shared/types/api'
import {
    IPC,
    type DocumentStatus,
    type DocumentView,
    type IpcResult,
    type MenuCommand,
    type RecentFileView,
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
    createShared: (root, keys, mode) => invoke(IPC.sharedCreate, { root, keys, mode }),
    getRoster: () => invoke(IPC.sharedRoster),
    findInvitation: (root) => invoke(IPC.joinFind, { root }),
    importInvitation: (root, invitationId) => invoke(IPC.joinImport, { root, invitationId }),
    checkSyncNow: () => invoke(IPC.syncCheckNow),
    getIdentity: () => invoke(IPC.identityGet),
    copyKeyBundle: () => invoke(IPC.identityCopyBundle),
    saveKeyBundle: () => invoke(IPC.identitySaveBundle),
    getSettings: () => invoke(IPC.settingsGet),
    setDisplayName: (displayName) => invoke(IPC.settingsSetName, { displayName }),
    newDocument: () => invoke(IPC.documentNew),
    openDocumentDialog: () => invoke(IPC.documentOpenDialog),
    openPath: (path) => invoke(IPC.documentOpenPath, { path }),
    getDocumentState: () => invoke(IPC.documentGetState),
    appendMessage: (threadId, content) => invoke(IPC.documentAppendMessage, { threadId, content }),
    retrySave: () => invoke(IPC.documentRetrySave),
    setDraftState: (hasDraft) => invoke(IPC.draftSet, { hasDraft }),
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
    takeFocusRequest: () => invoke(IPC.focusTake),
    getRecentFiles: () => invoke(IPC.recentGet),
    removeRecentFile: (path) => invoke(IPC.recentRemove, { path }),
    clearRecentFiles: () => invoke(IPC.recentClear),
    onRecentFilesChanged: (callback) => subscribe<RecentFileView[]>(IPC.recentChanged, callback),
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
    getPathForFile: (file) => webUtils.getPathForFile(file as File)
}

contextBridge.exposeInMainWorld('branchchat', api)
