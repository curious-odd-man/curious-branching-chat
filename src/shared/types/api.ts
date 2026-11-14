import type { RichDoc } from '../validation/richText'
import type { StagedImage } from './assets'
import type {
    AppInfo,
    AssociationInfo,
    BackgroundFlag,
    FocusRequest,
    DocumentStatus,
    CandidateView,
    DocumentView,
    IdentityView,
    InvitationView,
    RosterView,
    SharedFolderChoice,
    IpcResult,
    MenuCommand,
    OpenOutcome,
    RecentFileView,
    SettingsView,
    UpdateView
} from './ipc'

/** The only surface the renderer can reach (exposed by the preload script as `window.branchchat`). */
export interface BranchChatApi {
    getAppInfo(): Promise<IpcResult<AppInfo>>
    /** Wizards of synchronized discussions (FR-158, FR-162). */
    pickSharedFolder(): Promise<IpcResult<SharedFolderChoice | null>>
    publishOwnKey(root: string): Promise<IpcResult<null>>
    listCandidates(root: string): Promise<IpcResult<CandidateView[]>>
    parseKey(text: string): Promise<IpcResult<CandidateView>>
    pickKeyFile(): Promise<IpcResult<CandidateView | null>>
    createShared(root: string, keys: string[], mode: 'new' | 'convert'): Promise<IpcResult<boolean>>
    getRoster(): Promise<IpcResult<RosterView | null>>
    findInvitation(root: string): Promise<IpcResult<InvitationView>>
    importInvitation(root: string, invitationId: string): Promise<IpcResult<boolean>>
    /** "Проверить папки": scan the shared folder now (FR-172). */
    checkSyncNow(): Promise<IpcResult<null>>
    /** Encryption key: created on first use; only the fingerprint is returned (FR-155 to FR-157). */
    getIdentity(): Promise<IpcResult<IdentityView>>
    /** Copies the public-key bundle as text to the clipboard. */
    copyKeyBundle(): Promise<IpcResult<null>>
    /** Saves the public-key bundle as a .bckey file; false if the person cancelled. */
    saveKeyBundle(): Promise<IpcResult<boolean>>
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
    setAutoUpdateCheck(enabled: boolean): Promise<IpcResult<SettingsView>>
    /** How many recent files are remembered (0 = none). Lowering it forgets the oldest entries. */
    setRecentFilesLimit(limit: number): Promise<IpcResult<SettingsView>>
    setOpenLastFileOnStartup(enabled: boolean): Promise<IpcResult<SettingsView>>
    /** Largest file read from a shared folder, 5 to 1 000 MB (FR-166). */
    setFileSizeLimit(mb: number): Promise<IpcResult<SettingsView>>
    /** Notifications and start with Windows (release 1.4). */
    setBackgroundFlag(flag: BackgroundFlag, enabled: boolean): Promise<IpcResult<SettingsView>>
    /** The message this window must show (a click on a notification), once. */
    takeFocusRequest(): Promise<IpcResult<FocusRequest | null>>
    getRecentFiles(): Promise<IpcResult<RecentFileView[]>>
    removeRecentFile(path: string): Promise<IpcResult<null>>
    clearRecentFiles(): Promise<IpcResult<null>>
    onRecentFilesChanged(callback: (files: RecentFileView[]) => void): () => void
    getUpdateState(): Promise<IpcResult<UpdateView>>
    /** Manual check (Help > Check for updates); opens the update dialog. */
    checkForUpdates(): Promise<IpcResult<null>>
    downloadUpdate(): Promise<IpcResult<null>>
    /** Closes the application and installs the downloaded update (FR-106). */
    installUpdate(): Promise<IpcResult<null>>
    showUpdateDialog(): Promise<IpcResult<null>>
    dismissUpdateDialog(): Promise<IpcResult<null>>
    openReleasePage(): Promise<IpcResult<boolean>>
    onUpdateChanged(callback: (view: UpdateView) => void): () => void
    getAssociation(): Promise<IpcResult<AssociationInfo>>
    /** Turns the .branchchat file association on or off. Refused if another program holds the type (FR-090). */
    setAssociation(enabled: boolean): Promise<IpcResult<AssociationInfo>>
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
    /** The save status changed (without any change to the discussion itself). */
    onDocumentStatusChanged(callback: (status: DocumentStatus) => void): () => void
    onMenuCommand(callback: (command: MenuCommand) => void): () => void
    /** A message waits to be shown: call takeFocusRequest(). */
    onFocusRequest(callback: () => void): () => void
    /** Absolute path of a file dropped onto the window. */
    getPathForFile(file: object): string
}
