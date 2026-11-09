import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { BranchChatApi } from '@shared/types/api'
import {
  IPC,
  type DocumentStatus,
  type DocumentView,
  type IpcResult,
  type MenuCommand,
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
  getPathForFile: (file) => webUtils.getPathForFile(file as File)
}

contextBridge.exposeInMainWorld('branchchat', api)
