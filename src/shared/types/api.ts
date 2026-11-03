import type { RichDoc } from '../validation/richText'
import type {
  AppInfo,
  DocumentView,
  IpcResult,
  MenuCommand,
  OpenOutcome,
  SettingsView
} from './ipc'

/** The only surface the renderer can reach (exposed by the preload script as `window.branchchat`). */
export interface BranchChatApi {
  getAppInfo(): Promise<IpcResult<AppInfo>>
  getSettings(): Promise<IpcResult<SettingsView>>
  setDisplayName(displayName: string): Promise<IpcResult<SettingsView>>
  newDocument(): Promise<IpcResult<OpenOutcome>>
  openDocumentDialog(): Promise<IpcResult<OpenOutcome>>
  openPath(path: string): Promise<IpcResult<OpenOutcome>>
  getDocumentState(): Promise<IpcResult<DocumentView | null>>
  appendMessage(threadId: string, content: RichDoc): Promise<IpcResult<null>>
  retrySave(): Promise<IpcResult<null>>
  setDraftState(hasDraft: boolean): Promise<IpcResult<null>>
  /** Subscribe to state changes of this window's discussion. Returns an unsubscribe function. */
  onDocumentChanged(callback: (view: DocumentView | null) => void): () => void
  onMenuCommand(callback: (command: MenuCommand) => void): () => void
  /** Absolute path of a file dropped onto the window. */
  getPathForFile(file: object): string
}
