import { BrowserWindow, type WebContents } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, resolve } from 'node:path'
import type { DomainContext } from '@shared/domain'
import { describeError, ru } from '@shared/i18n/ru'
import type { StagedImage } from '@shared/types/assets'
import {
    IPC,
    type DocumentStatus,
    type DocumentView,
    type FocusRequest,
    type MenuCommand,
    type OpenOutcome
} from '@shared/types/ipc'
import { DocumentError } from '../document'
import type { LibraryService } from '../library'
import { LibraryError } from '../library/schema'
import type { SettingsStore } from '../local-state/settings'
import { DocumentSession } from './documentSession'
import { AppError } from './errors'
import { pathKey } from './paths'
import { recentOrder } from './recentView'
import type { Ui } from './ui'
import type { SyncService } from '../sync/syncService'
import type { SyncRegistry } from '../sync/registry'

export interface WindowEntry {
    readonly id: number
    readonly win: BrowserWindow
    session: DocumentSession | null
    /** Renderer reports whether the composer holds an unsent, non-empty draft (FR-008). */
    hasDraft: boolean
    closeRequested: boolean
    closing: boolean
    /** A message to show once the window's page asks for it (a click on a notification, D-33). */
    pendingFocus: FocusRequest | null
}

export interface ControllerDeps {
    settings: SettingsStore
    /** The discussions of this computer (ADR-003). */
    library: LibraryService
    ui: Ui
    ctx: DomainContext
    appVersion: string
    createWindow: () => BrowserWindow
    /** Synchronized discussions (release 1.2); absent in tests that do not need them. */
    sync?: SyncService
    registry?: SyncRegistry
    /** The person cancelled the close of a window (the app must not quit, release 1.4). */
    onCloseCancelled?: () => void
}

/**
 * Owns the windows and the open discussions: one window per discussion (FR-115), reuse of empty "start" windows,
 * focus instead of duplicates, import and export of files (FR-203, FR-204), and close handling (FR-008).
 */
export class AppController {
    private readonly entries = new Map<number, WindowEntry>()
    private readonly opening = new Map<string, Promise<OpenOutcome>>()
    private readonly importing = new Map<string, Promise<OpenOutcome>>()

    constructor(private readonly deps: ControllerDeps) {}

    // ---- windows ------------------------------------------------------------------------------------------------

    createWindow(): WindowEntry {
        const win = this.deps.createWindow()
        const entry: WindowEntry = {
            id: win.webContents.id,
            win,
            session: null,
            hasDraft: false,
            closeRequested: false,
            closing: false,
            pendingFocus: null
        }
        this.entries.set(entry.id, entry)
        win.on('close', (event) => {
            if (entry.closing) return
            event.preventDefault()
            void this.requestClose(entry)
        })
        win.on('closed', () => {
            this.entries.delete(entry.id)
            const session = entry.session
            if (session)
                void Promise.resolve(this.deps.sync?.detach(session)).then(() => session.close())
        })
        this.updateTitle(entry)
        return entry
    }

    /** The open discussion with this session ID (used to answer image requests). */
    sessionById(sessionId: string): DocumentSession | undefined {
        for (const entry of this.entries.values())
            if (entry.session?.sessionId === sessionId) return entry.session
        return undefined
    }

    /** "Insert image…": lets the person choose a file and adds it to the draft (FR-067). Null if cancelled. */
    async pickImage(entry: WindowEntry | undefined): Promise<StagedImage | null> {
        if (!entry?.session) throw new AppError('NO_DOCUMENT', 'No open discussion')
        const path = await this.deps.ui.pickImagePath(entry.win)
        if (!path) return null
        let data: Buffer
        try {
            data = await fs.readFile(path)
        } catch {
            throw new AppError('IMAGE_READ_FAILED', 'Cannot read the image file')
        }
        return entry.session.stageImage(data)
    }

    entryFor(sender: WebContents): WindowEntry | undefined {
        return this.entries.get(sender.id)
    }

    get windowCount(): number {
        return this.entries.size
    }

    focusAny(): void {
        const first = this.entries.values().next().value as WindowEntry | undefined
        if (first) focusWindow(first.win)
    }

    /** True if a window shows this discussion and that window is active (D-42: then no notification). */
    isActive(documentId: string): boolean {
        const entry = this.findByDocumentId(documentId)
        if (!entry || entry.win.isDestroyed()) return false
        return entry.win.isFocused() && entry.win.isVisible() && !entry.win.isMinimized()
    }

    /**
     * "Открыть" in the tray and a left click on the tray icon (D-42): shows a window; with no window, opens the most
     * recently used synchronized discussion, or the start screen.
     */
    async showAny(): Promise<void> {
        if (this.entries.size > 0) return this.focusAny()
        const ownId = this.deps.settings.get().participantId
        const registered = new Set(
            (this.deps.registry?.list() ?? [])
                .filter((e) => e.ownId === ownId)
                .map((e) => e.conversationId)
        )
        const candidates = recentOrder(this.deps.library.list()).filter((d) => registered.has(d.id))
        for (const d of candidates) {
            const outcome = await this.openDiscussion(d.id, undefined)
            if (outcome.status === 'opened' || outcome.status === 'focused') return
        }
        if (this.entries.size === 0) focusWindow(this.createWindow().win)
    }

    /** A click on a notification (D-33): opens the discussion and shows the message. */
    async showMessage(documentId: string, threadId: string, messageId: string): Promise<void> {
        const outcome = await this.openDiscussion(documentId, undefined)
        if (outcome.status !== 'opened' && outcome.status !== 'focused') return
        const entry = this.findByDocumentId(documentId)
        if (!entry?.session || entry.win.isDestroyed()) return
        entry.pendingFocus = { documentId, threadId, messageId }
        entry.win.webContents.send(IPC.focusRequest)
    }

    /** The page takes the waiting message to show (once). */
    takeFocusRequest(entry: WindowEntry | undefined): FocusRequest | null {
        if (!entry) return null
        const request = entry.pendingFocus
        entry.pendingFocus = null
        return request
    }

    sendMenuCommand(command: MenuCommand): void {
        const win = BrowserWindow.getFocusedWindow() ?? this.entries.values().next().value?.win
        if (win && !win.isDestroyed()) win.webContents.send(IPC.menuCommand, command)
    }

    /** Sends a message to every open window (e.g. update state). */
    broadcast(channel: string, payload: unknown): void {
        for (const entry of this.entries.values())
            if (!entry.win.isDestroyed()) entry.win.webContents.send(channel, payload)
    }

    // ---- opening, importing, creating ---------------------------------------------------------------------------

    /**
     * Launch arguments: files are imported and opened, `discussions` (jump list) are opened by ID. Makes sure at
     * least one window exists afterwards.
     */
    async openPaths(paths: readonly string[], discussions: readonly string[] = []): Promise<void> {
        for (const path of paths) await this.openPath(path, undefined)
        for (const id of discussions) await this.openDiscussion(id, undefined)
        if (this.entries.size === 0) this.createWindow()
        else if (paths.length === 0 && discussions.length === 0) this.focusAny()
    }

    /** A `.branchchat` file (double-click, drag and drop, "Импортировать…"): imported, then opened (FR-203). */
    openPath(rawPath: string, from: WindowEntry | undefined): Promise<OpenOutcome> {
        const path = resolve(rawPath)
        const key = pathKey(path)
        // a repeated request for a file that is still being imported (e.g. double-click spam) shares the attempt
        const inFlight = this.importing.get(key)
        if (inFlight) return inFlight
        const attempt = this.doImport(path, from).finally(() => this.importing.delete(key))
        this.importing.set(key, attempt)
        return attempt
    }

    /** Opens a discussion of the library; a window that shows it already gets the focus. */
    openDiscussion(documentId: string, from: WindowEntry | undefined): Promise<OpenOutcome> {
        const existing = this.findByDocumentId(documentId)
        if (existing) {
            focusWindow(existing.win)
            return Promise.resolve({ status: 'focused' })
        }
        const inFlight = this.opening.get(documentId)
        if (inFlight) return inFlight
        const attempt = this.doOpen(documentId, from).finally(() => this.opening.delete(documentId))
        this.opening.set(documentId, attempt)
        return attempt
    }

    /** A choice from the File > recent menu or the start screen: opens in the focused window. */
    openFromMenu(documentId: string): Promise<OpenOutcome> {
        const focused = BrowserWindow.getFocusedWindow()
        const from = focused ? this.entries.get(focused.webContents.id) : undefined
        return this.openDiscussion(documentId, from)
    }

    /** "Импортировать…" (FR-203). */
    async openWithDialog(from: WindowEntry | undefined): Promise<OpenOutcome> {
        const chosen = await this.deps.ui.pickOpenPath(from?.win)
        if (!chosen) return { status: 'cancelled' }
        return this.openPath(chosen, from)
    }

    /** "Новое обсуждение": a new discussion in the library, named in the window (FR-202). */
    async newDocument(from: WindowEntry | undefined, title: string): Promise<OpenOutcome> {
        const settings = this.deps.settings.get()
        if (!settings.displayName) throw new AppError('NAME_REQUIRED', ru.dialogs.nameRequired)
        const name = title.trim()
        if (!name) throw new AppError('TITLE_REQUIRED', 'a title is required')
        const contents = DocumentSession.newContents(
            { ctx: this.deps.ctx },
            {
                title: name,
                author: {
                    participantId: settings.participantId,
                    displayName: settings.displayName
                },
                generator: { name: 'BranchChat', version: this.deps.appVersion }
            }
        )
        try {
            await this.deps.library.create(contents)
        } catch {
            await this.deps.ui.showError(
                from?.win,
                ru.dialogs.createFailedTitle,
                describeError('SAVE_FAILED')
            )
            return { status: 'failed', errorCode: 'SAVE_FAILED' }
        }
        return this.openDiscussion(contents.manifest.documentId, from)
    }

    private async doImport(path: string, from: WindowEntry | undefined): Promise<OpenOutcome> {
        let result: Awaited<ReturnType<LibraryService['importFile']>>
        try {
            result = await this.deps.library.importFile(path)
        } catch (err) {
            const code =
                err instanceof DocumentError || err instanceof LibraryError ? err.code : 'UNKNOWN'
            const detail =
                err instanceof DocumentError && err.details.length > 0
                    ? err.details.join('\n')
                    : undefined
            await this.deps.ui.showError(
                from?.win,
                ru.dialogs.openFailedTitle,
                `${basename(path)}\n${describeError(code)}`,
                detail
            )
            return { status: 'failed', errorCode: code }
        }
        const notice =
            result.status === 'merged'
                ? ru.notices.merged(basename(path), result.addedMessages)
                : result.status === 'unchanged'
                  ? ru.notices.nothingNew(basename(path))
                  : null
        const open = this.findByDocumentId(result.id)
        if (open?.session && notice) {
            open.session.notices.push(notice)
            this.push(open)
        }
        const outcome = await this.openDiscussion(result.id, from)
        if (!open && notice) {
            const entry = this.findByDocumentId(result.id)
            if (entry?.session) {
                entry.session.notices.push(notice)
                this.push(entry)
            }
        }
        return outcome
    }

    private async doOpen(documentId: string, from: WindowEntry | undefined): Promise<OpenOutcome> {
        let session: DocumentSession
        try {
            const store = this.deps.library.store(documentId)
            session = DocumentSession.open(store, await store.load(), { ctx: this.deps.ctx })
        } catch (err) {
            const code = err instanceof LibraryError ? err.code : 'UNKNOWN'
            await this.deps.ui.showError(from?.win, ru.dialogs.openFailedTitle, describeError(code))
            return { status: 'failed', errorCode: code }
        }
        const entry = this.targetFor(from)
        if (this.deps.sync && session.current.sync) {
            const result = await this.deps.sync.attach(session)
            if (result === 'detached') session.notices.push(ru.notices.detached)
        }
        this.bind(entry, session)
        return { status: 'opened' }
    }

    /** "Экспортировать…": the discussion as a `.branchchat` file, without the member list (FR-204, FR-167). */
    async exportDiscussion(from: WindowEntry | undefined): Promise<boolean> {
        const session = from?.session
        if (!session) throw new AppError('NO_DOCUMENT', 'No open discussion')
        const chosen = await this.deps.ui.pickCopyPath(
            from.win,
            ru.dialogs.exportDefaultName(safeFileName(session.title))
        )
        if (!chosen) return false
        const target = resolve(/\.branchchat$/i.test(chosen) ? chosen : `${chosen}.branchchat`)
        try {
            await session.flush()
            await this.deps.library.exportTo(session.current, target)
            return true
        } catch (err) {
            const code = err instanceof DocumentError ? err.code : 'WRITE_FAILED'
            await this.deps.ui.showError(
                from.win,
                ru.dialogs.exportFailedTitle,
                describeError(code),
                target
            )
            return false
        }
    }

    /** The focused window's discussion (menu commands handled in the main process). */
    focusedEntry(): WindowEntry | undefined {
        const focused = BrowserWindow.getFocusedWindow()
        return focused
            ? this.entries.get(focused.webContents.id)
            : this.entries.values().next().value
    }

    // ---- state shown to windows ---------------------------------------------------------------------------------

    viewOf(entry: WindowEntry): DocumentView | null {
        return entry.session ? entry.session.view(this.deps.settings.get().participantId) : null
    }

    private bind(entry: WindowEntry, session: DocumentSession): void {
        entry.session = session
        // Every discussion that was opened or created becomes the most recent one.
        try {
            this.deps.library.markOpened(session.documentId)
        } catch {
            // the order of the list is a convenience; a failed write must not disturb opening
        }
        session.onChange = () => this.push(entry)
        session.onStatusChange = () => this.pushStatus(entry, session)
        this.push(entry)
        focusWindow(entry.win)
    }

    private push(entry: WindowEntry): void {
        if (entry.win.isDestroyed()) return
        this.updateTitle(entry)
        entry.win.webContents.send(IPC.documentChanged, this.viewOf(entry))
    }

    /** A save finished: only the status is sent, not the whole discussion (a large discussion is several MB). */
    private pushStatus(entry: WindowEntry, session: DocumentSession): void {
        if (entry.win.isDestroyed()) return
        const status: DocumentStatus = { saving: session.saving, saveError: session.saveError }
        entry.win.webContents.send(IPC.documentStatusChanged, status)
    }

    private updateTitle(entry: WindowEntry): void {
        if (entry.win.isDestroyed()) return
        if (!entry.session) return entry.win.setTitle(ru.app.name)
        const unread = entry.session.unreadTotal(this.deps.settings.get().participantId)
        entry.win.setTitle(ru.discussion.windowTitle(entry.session.title, unread))
    }

    /** An empty start window is reused; otherwise a new window is created (one window per document). */
    private targetFor(from: WindowEntry | undefined): WindowEntry {
        if (from && !from.session && !from.win.isDestroyed()) return from
        for (const entry of this.entries.values())
            if (!entry.session && !entry.win.isDestroyed()) return entry
        return this.createWindow()
    }

    private findByDocumentId(documentId: string): WindowEntry | undefined {
        for (const entry of this.entries.values())
            if (entry.session?.documentId === documentId) return entry
        return undefined
    }

    // ---- closing ------------------------------------------------------------------------------------------------

    /** Saves pending changes first, and warns only about an unsent draft or a failed last write (FR-008). */
    private async requestClose(entry: WindowEntry): Promise<void> {
        if (entry.closeRequested) return
        entry.closeRequested = true
        try {
            if (entry.session) await entry.session.flush()
            const problems = {
                unsentDraft: entry.hasDraft,
                saveFailed: entry.session?.saveError != null
            }
            if (problems.unsentDraft || problems.saveFailed) {
                const closeAnyway = await this.deps.ui.confirmClose(entry.win, problems)
                if (!closeAnyway) {
                    this.deps.onCloseCancelled?.()
                    return
                }
            }
            entry.closing = true
            if (!entry.win.isDestroyed()) entry.win.close()
        } finally {
            entry.closeRequested = false
        }
    }
}

/** A file name from a discussion name: characters Windows does not allow become "_". */
export function safeFileName(title: string): string {
    const name = [...title]
        .map((ch) => (ch.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(ch) ? '_' : ch))
        .join('')
        .replace(/[. ]+$/, '')
        .trim()
    return (name || ru.dialogs.defaultFileName).slice(0, 120)
}

function focusWindow(win: BrowserWindow): void {
    if (win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
}
