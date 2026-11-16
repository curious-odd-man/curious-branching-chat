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
    DiscussionListItem,
    SidebarSettings,
    MigrationCandidate,
    SearchHit,
    BackupResult,
    BackupState,
    MigrationResult,
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
    createShared(
        root: string,
        keys: string[],
        mode: 'new' | 'convert',
        title?: string
    ): Promise<IpcResult<boolean>>
    /** FR-176: invite new members into the open synchronized discussion; returns how many were added. */
    inviteMembers(keys: string[]): Promise<IpcResult<number>>
    /** FR-177: re-invite a member who lost the keys, with the person's new key. */
    reinviteMember(participantId: string, key: string): Promise<IpcResult<null>>
    /** D-32: accept or reject the new keys of a member (status line). */
    decideKeys(participantId: string, accept: boolean): Promise<IpcResult<null>>
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
    /** "Новое обсуждение" with the name the person gave (FR-202). */
    newDocument(title: string): Promise<IpcResult<OpenOutcome>>
    /** "Импортировать…": a file dialog, then import and open (FR-203). */
    openDocumentDialog(): Promise<IpcResult<OpenOutcome>>
    /** A dropped `.branchchat` file: import and open (FR-203). */
    openPath(path: string): Promise<IpcResult<OpenOutcome>>
    /** Opens a discussion of the library in this window (FR-221). */
    openDiscussion(id: string): Promise<IpcResult<OpenOutcome>>
    /** FR-211: search in the shown discussion. */
    searchDiscussion(query: string): Promise<IpcResult<SearchHit[]>>
    /** FR-215: search in all discussions. */
    searchAll(query: string): Promise<IpcResult<SearchHit[]>>
    /** A search result: the discussion, the branch, and the message (empty: only the branch). */
    openAt(id: string, threadId: string, messageId: string): Promise<IpcResult<OpenOutcome>>
    /** "Открыть в новом окне" (FR-225). */
    openDiscussionInNewWindow(id: string): Promise<IpcResult<OpenOutcome>>
    /** "Экспортировать…" (FR-204); false if the person cancelled. */
    exportDiscussion(): Promise<IpcResult<boolean>>
    getDocumentState(): Promise<IpcResult<DocumentView | null>>
    appendMessage(threadId: string, content: RichDoc): Promise<IpcResult<null>>
    retrySave(): Promise<IpcResult<null>>
    /** FR-251: the draft of a branch (editor JSON), or null to remove it. */
    saveDraft(threadId: string, content: unknown): Promise<IpcResult<null>>
    /** FR-251: the drafts of the shown discussion, by branch. */
    getDrafts(): Promise<IpcResult<Record<string, unknown>>>
    /** The main process asks to save waiting drafts now; answer with `draftsFlushed(token)`. */
    onDraftsFlushRequest(callback: (token: string) => void): () => void
    draftsFlushed(token: string): Promise<IpcResult<null>>
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
    /** How many recent discussions the File menu and the jump list show (0 = none). */
    setRecentFilesLimit(limit: number): Promise<IpcResult<SettingsView>>
    setOpenLastFileOnStartup(enabled: boolean): Promise<IpcResult<SettingsView>>
    /** Largest file read from a shared folder, 5 to 1 000 MB (FR-166). */
    setFileSizeLimit(mb: number): Promise<IpcResult<SettingsView>>
    /** Notifications and start with Windows (release 1.4). */
    setBackgroundFlag(flag: BackgroundFlag, enabled: boolean): Promise<IpcResult<SettingsView>>
    /** FR-301: text size of all windows, in percent. */
    setTextSize(percent: number): Promise<IpcResult<SettingsView>>
    /** FR-222, FR-223: the discussion list (hidden, width, sort). */
    setSidebar(change: Partial<SidebarSettings>): Promise<IpcResult<SettingsView>>
    /** FR-301: one step of the text size (keys and Ctrl+mouse wheel in the page). */
    zoom(direction: 'in' | 'out' | 'reset'): Promise<IpcResult<null>>
    /** The message this window must show (a click on a notification), once. */
    takeFocusRequest(): Promise<IpcResult<FocusRequest | null>>
    /** The discussions of the library, most recently used first. */
    getDiscussions(): Promise<IpcResult<DiscussionListItem[]>>
    onDiscussionsChanged(callback: (list: DiscussionListItem[]) => void): () => void
    /** FR-207: the backups, the last backup, and the folder of the person. */
    getBackups(): Promise<IpcResult<BackupState>>
    /** FR-207: "Резервная копия сейчас". */
    backupNow(): Promise<IpcResult<BackupResult>>
    /** FR-207, FR-209: chooses the folder for backups (warns once about cloud folders); null if cancelled. */
    pickBackupFolder(): Promise<IpcResult<SettingsView | null>>
    clearBackupFolder(): Promise<IpcResult<SettingsView>>
    /** FR-207: restores a backup after a confirmation; false if the person cancelled. The app restarts. */
    restoreBackup(path: string): Promise<IpcResult<boolean>>
    /** FR-206: the files of release 1.x to offer (empty: nothing to ask). */
    getMigration(): Promise<IpcResult<MigrationCandidate[]>>
    /** FR-206: imports the chosen files. */
    runMigration(paths: string[]): Promise<IpcResult<MigrationResult[]>>
    /** FR-206: "Не переносить". */
    skipMigration(): Promise<IpcResult<null>>
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
    /** The settings changed in the main process (for example the text size from the keyboard). */
    onSettingsChanged(callback: (settings: SettingsView) => void): () => void
    /** Absolute path of a file dropped onto the window. */
    getPathForFile(file: object): string
}
