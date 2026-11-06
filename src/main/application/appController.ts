import { BrowserWindow, type WebContents } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, resolve } from 'node:path'
import type { DomainContext } from '@shared/domain'
import { describeError, ru } from '@shared/i18n/ru'
import type { StagedImage } from '@shared/types/assets'
import { IPC, type DocumentView, type MenuCommand, type OpenOutcome } from '@shared/types/ipc'
import { DocumentError } from '../document'
import type { SettingsStore } from '../local-state/settings'
import { DocumentSession } from './documentSession'
import { AppError } from './errors'
import { pathKey } from './paths'
import type { Ui } from './ui'

export interface WindowEntry {
  readonly id: number
  readonly win: BrowserWindow
  session: DocumentSession | null
  /** Renderer reports whether the composer holds an unsent, non-empty draft (FR-008). */
  hasDraft: boolean
  closeRequested: boolean
  closing: boolean
}

export interface ControllerDeps {
  settings: SettingsStore
  ui: Ui
  ctx: DomainContext
  appVersion: string
  createWindow: () => BrowserWindow
}

/**
 * Owns the windows and the open discussions: one window per document (FR-115), reuse of empty "start" windows,
 * focus instead of duplicates, the two-copies notice (FR-117), and close handling (FR-008).
 */
export class AppController {
  private readonly entries = new Map<number, WindowEntry>()
  private readonly opening = new Map<string, Promise<OpenOutcome>>()

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
      closing: false
    }
    this.entries.set(entry.id, entry)
    win.on('close', (event) => {
      if (entry.closing) return
      event.preventDefault()
      void this.requestClose(entry)
    })
    win.on('closed', () => this.entries.delete(entry.id))
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

  sendMenuCommand(command: MenuCommand): void {
    const win = BrowserWindow.getFocusedWindow() ?? this.entries.values().next().value?.win
    if (win && !win.isDestroyed()) win.webContents.send(IPC.menuCommand, command)
  }

  // ---- opening and creating -----------------------------------------------------------------------------------

  /** Opens every path (launch arguments); makes sure at least one window exists afterwards. */
  async openPaths(paths: readonly string[]): Promise<void> {
    for (const path of paths) await this.openPath(path, undefined)
    if (this.entries.size === 0) this.createWindow()
    else if (paths.length === 0) this.focusAny()
  }

  openPath(rawPath: string, from: WindowEntry | undefined): Promise<OpenOutcome> {
    const path = resolve(rawPath)
    const key = pathKey(path)
    const existing = this.findByKey(key)
    if (existing) {
      focusWindow(existing.win)
      return Promise.resolve({ status: 'focused' })
    }
    // A repeated request for a file that is still being opened (e.g. double-click spam) shares the same attempt.
    const inFlight = this.opening.get(key)
    if (inFlight) return inFlight
    const attempt = this.doOpen(path, key, from).finally(() => this.opening.delete(key))
    this.opening.set(key, attempt)
    return attempt
  }

  async openWithDialog(from: WindowEntry | undefined): Promise<OpenOutcome> {
    const chosen = await this.deps.ui.pickOpenPath(from?.win)
    if (!chosen) return { status: 'cancelled' }
    return this.openPath(chosen, from)
  }

  async newDocument(from: WindowEntry | undefined): Promise<OpenOutcome> {
    const settings = this.deps.settings.get()
    if (!settings.displayName) throw new AppError('NAME_REQUIRED', ru.dialogs.nameRequired)
    const chosen = await this.deps.ui.pickSavePath(from?.win)
    if (!chosen) return { status: 'cancelled' }
    const path = resolve(/\.branchchat$/i.test(chosen) ? chosen : `${chosen}.branchchat`)

    if (this.findByKey(pathKey(path))) {
      await this.deps.ui.showError(
        from?.win,
        ru.dialogs.createFailedTitle,
        ru.dialogs.fileAlreadyOpen
      )
      return { status: 'failed', errorCode: 'ALREADY_OPEN' }
    }
    try {
      const session = await DocumentSession.create(
        path,
        { ctx: this.deps.ctx },
        {
          author: { participantId: settings.participantId, displayName: settings.displayName },
          generator: { name: 'BranchChat', version: this.deps.appVersion }
        }
      )
      this.bind(this.targetFor(from), session)
      return { status: 'opened' }
    } catch (err) {
      const code = err instanceof DocumentError ? err.code : 'WRITE_FAILED'
      await this.deps.ui.showError(
        from?.win,
        ru.dialogs.createFailedTitle,
        describeError(code),
        path
      )
      return { status: 'failed', errorCode: code }
    }
  }

  private async doOpen(
    path: string,
    key: string,
    from: WindowEntry | undefined
  ): Promise<OpenOutcome> {
    let session: DocumentSession
    try {
      session = await DocumentSession.open(path, { ctx: this.deps.ctx })
    } catch (err) {
      const code = err instanceof DocumentError ? err.code : 'UNKNOWN'
      const detail =
        err instanceof DocumentError && err.details.length > 0 ? err.details.join('\n') : undefined
      await this.deps.ui.showError(
        from?.win,
        ru.dialogs.openFailedTitle,
        `${basename(path)}\n${describeError(code)}`,
        detail
      )
      return { status: 'failed', errorCode: code }
    }
    const sameDocument = this.findByDocumentId(session.documentId)
    if (sameDocument?.session && pathKey(sameDocument.session.path) !== key) {
      session.notices.push(ru.notices.twoCopies(sameDocument.session.path, path))
    }
    this.bind(this.targetFor(from), session)
    return { status: 'opened' }
  }

  // ---- state shown to windows ---------------------------------------------------------------------------------

  viewOf(entry: WindowEntry): DocumentView | null {
    return entry.session ? entry.session.view(this.deps.settings.get().participantId) : null
  }

  private bind(entry: WindowEntry, session: DocumentSession): void {
    entry.session = session
    session.onChange = () => this.push(entry)
    this.push(entry)
    focusWindow(entry.win)
  }

  private push(entry: WindowEntry): void {
    if (entry.win.isDestroyed()) return
    this.updateTitle(entry)
    entry.win.webContents.send(IPC.documentChanged, this.viewOf(entry))
  }

  private updateTitle(entry: WindowEntry): void {
    if (entry.win.isDestroyed()) return
    if (!entry.session) return entry.win.setTitle(ru.app.name)
    const unread = entry.session.unreadTotal(this.deps.settings.get().participantId)
    entry.win.setTitle(ru.discussion.windowTitle(entry.session.fileName, unread))
  }

  /** An empty start window is reused; otherwise a new window is created (one window per document). */
  private targetFor(from: WindowEntry | undefined): WindowEntry {
    if (from && !from.session && !from.win.isDestroyed()) return from
    for (const entry of this.entries.values())
      if (!entry.session && !entry.win.isDestroyed()) return entry
    return this.createWindow()
  }

  private findByKey(key: string): WindowEntry | undefined {
    for (const entry of this.entries.values())
      if (entry.session && pathKey(entry.session.path) === key) return entry
    return undefined
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
      const problems = { unsentDraft: entry.hasDraft, saveFailed: entry.session?.saveError != null }
      if (problems.unsentDraft || problems.saveFailed) {
        const closeAnyway = await this.deps.ui.confirmClose(entry.win, problems)
        if (!closeAnyway) return
      }
      entry.closing = true
      if (!entry.win.isDestroyed()) entry.win.close()
    } finally {
      entry.closeRequested = false
    }
  }
}

function focusWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}
