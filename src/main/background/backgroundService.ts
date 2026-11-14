import { planNotifications, type NewMessage } from '@shared/domain'
import { ru } from '@shared/i18n/ru'
import type { BackgroundFlag, SettingsView } from '@shared/types/ipc'
import type { SettingsStore } from '../local-state/settings'
import type { NewMessagesArrival, SyncService } from '../sync/syncService'
import type { LoginItemPort, NotifierPort, TrayPort } from './ports'
import { discussionName, trayMenuModel, type TrayDiscussion } from './trayMenu'

/** What the background service needs from the window controller. */
export interface WindowsPort {
    readonly windowCount: number
    /** True if a window shows this file and that window is active (D-42: then no notification). */
    isActive(filePath: string): boolean
    /** "Открыть": shows a window; with no window, opens the most recently used synchronized discussion. */
    showAny(): Promise<void>
    openPath(filePath: string): Promise<void>
    /** Opens the discussion and shows this message (a click on a notification). */
    showMessage(filePath: string, threadId: string, messageId: string): Promise<void>
}

export interface BackgroundDeps {
    settings: SettingsStore
    sync: SyncService
    windows: WindowsPort
    tray: TrayPort
    notifier: NotifierPort
    loginItem: LoginItemPort
    fileExists(path: string): Promise<boolean>
    /** "Найти файл…" (D-27): the chosen file, or null. */
    pickDiscussionFile(): Promise<string | null>
    /** The `documentId` of a discussion file, or null if it cannot be read. */
    readDocumentId(path: string): Promise<string | null>
    showError(message: string): Promise<void>
    /** Ends the application (a normal close: a downloaded update installs, FR-141). */
    quit(): void
    log?: (message: string) => void
}

/**
 * Release 1.4 (D-16, D-27, D-33, D-35, D-36, D-38, D-42): the tray, the life cycle without windows, notifications for
 * new messages, and "Запускать вместе с Windows".
 */
export class BackgroundService {
    private quitting = false
    private refreshing: Promise<void> = Promise.resolve()

    constructor(private readonly deps: BackgroundDeps) {}

    async start(): Promise<void> {
        this.deps.loginItem.set(this.deps.settings.get().startWithWindows)
        await this.refresh()
    }

    /** True if the app must stay in the tray when no window is open (D-33). */
    get keepsRunning(): boolean {
        return this.deps.sync.count > 0
    }

    /** Builds the tray menu again (discussions, missing files, sync state). */
    refresh(): Promise<void> {
        this.refreshing = this.refreshing.then(() => this.doRefresh()).catch(() => undefined)
        return this.refreshing
    }

    private async doRefresh(): Promise<void> {
        const statuses = this.deps.sync.statusList()
        if (statuses.length === 0) {
            this.deps.tray.hide()
            return
        }
        const discussions: TrayDiscussion[] = []
        for (const s of statuses)
            discussions.push({
                conversationId: s.conversationId,
                filePath: s.filePath,
                exists: await this.deps.fileExists(s.filePath),
                health: s.health
            })
        this.deps.tray.show(
            trayMenuModel(discussions),
            (id) => void this.onAction(id),
            () => void this.deps.windows.showAny()
        )
    }

    /** The last window closed: stay in the tray, or quit (D-33). */
    async windowsGone(): Promise<void> {
        if (this.quitting || !this.keepsRunning) {
            this.deps.quit()
            return
        }
        await this.refresh()
        if (await this.deps.settings.takeTrayNotice())
            this.deps.notifier.show({
                title: ru.tray.noticeTitle,
                body: ru.tray.noticeText,
                onClick: () => void this.deps.windows.showAny()
            })
    }

    /** "Выход": every window closes (with the usual questions), then the app quits. */
    requestQuit(): void {
        this.quitting = true
        // with windows open, each window closes first; the last one ends in windowsGone(), which quits
        this.deps.quit()
    }

    /**
     * Any request to quit (`before-quit`: "Выход", Windows sign-out, an update): the windows close and the app ends;
     * it does not stay in the tray.
     */
    quitStarted(): void {
        this.quitting = true
    }

    /** The person cancelled the close of a window (an unsent draft): the app does not quit. */
    closeCancelled(): void {
        this.quitting = false
    }

    get isQuitting(): boolean {
        return this.quitting
    }

    /** A synchronized discussion was created or joined (FR-174): turn on "start with Windows" once. */
    async discussionAdded(): Promise<void> {
        if (await this.deps.settings.settleStartWithWindows()) this.deps.loginItem.set(true)
        await this.refresh()
    }

    async setFlag(flag: BackgroundFlag, enabled: boolean): Promise<SettingsView> {
        const view = await this.deps.settings.setFlag(flag, enabled)
        if (flag === 'startWithWindows') this.deps.loginItem.set(enabled)
        return view
    }

    /** New messages of other members (D-33, D-38, D-42). */
    newMessages(arrival: NewMessagesArrival): void {
        const settings = this.deps.settings.get()
        if (!settings.notifyNewMessages) return
        if (this.deps.windows.isActive(arrival.filePath)) return
        const names = new Map(
            arrival.contents.discussion.participants.map((p) => [p.participantId, p.displayName])
        )
        const messages: NewMessage[] = arrival.messages.map((m) => ({
            messageId: m.messageId,
            threadId: m.threadId,
            authorName: names.get(m.authorId) ?? m.authorDisplayName,
            content: m.content
        }))
        for (const n of planNotifications(
            discussionName(arrival.filePath),
            messages,
            settings.notifyShowText
        ))
            this.deps.notifier.show({
                title: n.title,
                body: n.body,
                onClick: () =>
                    void this.deps.windows.showMessage(arrival.filePath, n.threadId, n.messageId)
            })
    }

    private async onAction(id: string): Promise<void> {
        try {
            if (id === 'open') await this.deps.windows.showAny()
            else if (id === 'check') {
                await this.deps.sync.checkAll()
                await this.refresh()
            } else if (id === 'exit') this.requestQuit()
            else if (id.startsWith('open:')) {
                const s = this.find(id.slice('open:'.length))
                if (s) await this.deps.windows.openPath(s.filePath)
            } else if (id.startsWith('find:')) await this.findFile(id.slice('find:'.length))
        } catch (err) {
            this.deps.log?.(`tray action ${id} failed: ${(err as Error).message}`)
        }
    }

    private find(conversationId: string): { filePath: string } | undefined {
        return this.deps.sync.statusList().find((s) => s.conversationId === conversationId)
    }

    /** D-27: the registered file is missing; the person shows where it is now. */
    private async findFile(conversationId: string): Promise<void> {
        const chosen = await this.deps.pickDiscussionFile()
        if (!chosen) return
        if ((await this.deps.readDocumentId(chosen)) !== conversationId) {
            await this.deps.showError(ru.tray.wrongFile)
            return
        }
        await this.deps.sync.adoptMovedFile(conversationId, chosen)
        await this.refresh()
        await this.deps.windows.openPath(chosen)
    }
}
