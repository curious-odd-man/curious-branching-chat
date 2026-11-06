import type { RichDoc } from '../validation/richText'
import type { StagedImage } from './assets'
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
  /** Adds image bytes (pasted, dropped) to the draft. Nothing is saved until a message containing it is sent. */
  stageImage(data: Uint8Array): Promise<IpcResult<StagedImage>>
  /** Lets the person choose an image file; resolves with null if they cancel. */
  pickImage(): Promise<IpcResult<StagedImage | null>>
  markMessageRead(messageId: string): Promise<IpcResult<null>>
  markThreadRead(threadId: string): Promise<IpcResult<null>>
  markAllRead(): Promise<IpcResult<null>>
  /** The person has seen the notice that read status is visible to other participants (FR-125). */
  acknowledgeReadNotice(): Promise<IpcResult<SettingsView>>
  /** "Reply to this": creates a branch from a selected passage; resolves with the new branch's ID. */
  createBranch(
    sourceMessageId: string,
    selectionStart: number,
    selectionEnd: number
  ): Promise<IpcResult<{ threadId: string }>>
  setBranchStatus(threadId: string, status: 'open' | 'closed'): Promise<IpcResult<null>>
  setBranchTitle(threadId: string, title: string): Promise<IpcResult<null>>
  /** Opens a link in the system browser. Only http, https and mailto links are opened; call only after a click. */
  openLink(url: string): Promise<IpcResult<boolean>>
  /** Subscribe to state changes of this window's discussion. Returns an unsubscribe function. */
  onDocumentChanged(callback: (view: DocumentView | null) => void): () => void
  onMenuCommand(callback: (command: MenuCommand) => void): () => void
  /** Absolute path of a file dropped onto the window. */
  getPathForFile(file: object): string
}
