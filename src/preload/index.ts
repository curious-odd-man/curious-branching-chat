import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { BranchChatApi } from '@shared/types/api'
import { IPC, type DocumentView, type IpcResult, type MenuCommand } from '@shared/types/ipc'

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
  onDocumentChanged: (callback) => subscribe<DocumentView | null>(IPC.documentChanged, callback),
  onMenuCommand: (callback) => subscribe<MenuCommand>(IPC.menuCommand, callback),
  getPathForFile: (file) => webUtils.getPathForFile(file as File)
}

contextBridge.exposeInMainWorld('branchchat', api)
