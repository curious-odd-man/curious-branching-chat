import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { eventsFromChange, withLocalDisplayName, type LoadingMessage } from '@shared/sync'
import type { DocumentContents, Message } from '@shared/validation'
import type { DocumentSession } from '../application/documentSession'
import { pathKey } from '../application/paths'
import type { KeyStore } from '../crypto/keyStore'
import type { SettingsStore } from '../local-state/settings'
import { FolderTransport } from '../transport/folderTransport'
import {
    ConversationSync,
    RETRY_INTERVAL_MS,
    type DocumentPort,
    type SyncHealth
} from './conversationSync'
import type { DocumentView } from '@shared/types/ipc'
import { FilePort } from './filePort'
import type { RegistryEntry, SyncRegistry } from './registry'
import { SyncState, conversationDir } from './syncState'

export interface SyncServiceDeps {
    userData: string
    registry: SyncRegistry
    keys: KeyStore
    settings: SettingsStore
    now: () => string
    newId: () => string
    appVersion: string
    /** How often every conversation is scanned (design 17); watch events only speed this up. */
    scanIntervalMs?: number
    /** Retry rule and cleanup (D-29, D-34): every 30 minutes. */
    maintenanceIntervalMs?: number
    /** Wait for a stable file (protocol 9.6). */
    stableMs?: number
    watch?: boolean
    log?: (message: string) => void
    /** Messages of other members that a scan added (notifications, D-33). */
    onNewMessages?: (arrival: NewMessagesArrival) => void
    /** A sync status changed (the tray menu, D-35). */
    onStatusChange?: () => void
}

export interface NewMessagesArrival {
    conversationId: string
    filePath: string
    messages: Message[]
    contents: DocumentContents
}

/** Sync state of one registered discussion for the tray menu (D-35). */
export interface ConversationStatus {
    conversationId: string
    filePath: string
    health: SyncHealth | null
}

export type AttachResult =
    /** The registered copy: synchronized. */
    | 'synced'
    /** A file with a roster that is not the registered copy (FR-154). */
    | 'detached'
    /** A normal discussion. */
    | 'plain'

interface Conversation {
    entry: RegistryEntry
    sync: ConversationSync
    file: FilePort
    session: DocumentSession | null
    stopWatch: (() => Promise<void>) | null
    viewJson: string
    timer: NodeJS.Timeout | null
}

/**
 * Runs every synchronized discussion of this computer (design sections 10, 13 to 17): while a window shows it,
 * through the window's document session; otherwise through the file.
 */
export class SyncService {
    private readonly conversations = new Map<string, Conversation>()
    private readonly opening = new Map<string, Promise<void>>()
    private interval: NodeJS.Timeout | null = null
    private maintenance: NodeJS.Timeout | null = null

    constructor(private readonly deps: SyncServiceDeps) {}

    private get syncRoot(): string {
        return join(this.deps.userData, 'sync')
    }

    async start(): Promise<void> {
        for (const entry of this.deps.registry.list())
            await this.open(entry).catch((err) => this.fail(entry, err))
        const every = this.deps.scanIntervalMs ?? 5 * 60_000
        this.interval = setInterval(() => void this.scanAll(), every)
        this.interval.unref?.()
        // D-29, D-34: retry rule and cleanup every 30 minutes (and at each start, in ConversationSync.start)
        this.maintenance = setInterval(
            () => void this.maintainAll(),
            this.deps.maintenanceIntervalMs ?? RETRY_INTERVAL_MS
        )
        this.maintenance.unref?.()
    }

    async maintainAll(): Promise<void> {
        for (const c of this.conversations.values())
            await c.sync
                .maintain()
                .catch((err) => this.deps.log?.(`maintenance failed: ${(err as Error).message}`))
    }

    async stop(): Promise<void> {
        if (this.interval) clearInterval(this.interval)
        if (this.maintenance) clearInterval(this.maintenance)
        for (const c of this.conversations.values()) {
            if (c.timer) clearTimeout(c.timer)
            await c.stopWatch?.()
        }
    }

    private fail(entry: RegistryEntry, err: unknown): void {
        this.deps.log?.(`sync of ${entry.conversationId} cannot start: ${(err as Error).message}`)
    }

    /** Starts the sync of one registered discussion (also used by the wizards after `registry.put`). */
    open(entry: RegistryEntry): Promise<void> {
        if (this.conversations.has(entry.conversationId)) return Promise.resolve()
        const running = this.opening.get(entry.conversationId)
        if (running) return running
        const attempt = this.doOpen(entry).finally(() => this.opening.delete(entry.conversationId))
        this.opening.set(entry.conversationId, attempt)
        return attempt
    }

    private async doOpen(entry: RegistryEntry): Promise<void> {
        if (entry.ownId !== this.deps.settings.get().participantId) return // another identity on this computer
        const state = await SyncState.open(
            conversationDir(this.syncRoot, entry.conversationId),
            entry.conversationId,
            entry.ownId
        )
        const transport = new FolderTransport(entry.sharedRoot, state.stagingDir)
        const file = new FilePort(entry.filePath)
        const conv: Conversation = {
            entry,
            sync: null as unknown as ConversationSync,
            file,
            session: null,
            stopWatch: null,
            viewJson: '',
            timer: null
        }
        const port: DocumentPort = {
            read: async () => (conv.session ? conv.session.current : file.read()),
            update: async (change) => {
                if (conv.session) conv.session.applyRemote(change)
                else await file.update(change)
            },
            imageBytes: async (assetId) => {
                if (conv.session) {
                    const r = await conv.session.readAssetBytes(assetId)
                    return r ? new Uint8Array(r.data) : null
                }
                return file.imageBytes(assetId)
            }
        }
        conv.sync = new ConversationSync({
            conversationId: entry.conversationId,
            ownId: entry.ownId,
            transport,
            state,
            keys: {
                sign: (d) => this.deps.keys.sign(entry.ownId, d),
                open: (s) => this.deps.keys.openSealed(entry.ownId, s)
            },
            document: port,
            now: this.deps.now,
            newId: this.deps.newId,
            maxFileBytes: () => this.deps.settings.get().fileSizeLimitMb * 1024 * 1024,
            appVersion: this.deps.appVersion,
            ...(this.deps.stableMs !== undefined ? { stableMs: this.deps.stableMs } : {}),
            onChange: () => {
                void this.refreshView(conv)
                this.statusChanged(conv)
            },
            onNewMessages: (messages, contents) =>
                this.deps.onNewMessages?.({
                    conversationId: entry.conversationId,
                    filePath: conv.entry.filePath,
                    messages,
                    contents
                }),
            ...(this.deps.log ? { log: this.deps.log } : {})
        })
        this.conversations.set(entry.conversationId, conv)
        await conv.sync.start()
        if (this.deps.watch !== false) {
            try {
                conv.stopWatch = transport.watchInbox(
                    entry.ownId,
                    () => this.scanSoon(conv),
                    () => this.scanSoon(conv)
                )
            } catch {
                conv.stopWatch = null // the periodic scan still works
            }
        }
        await this.scan(entry.conversationId)
    }

    /** A watch event: scan after the stable time, and once more for files that were still growing. */
    private scanSoon(conv: Conversation): void {
        if (conv.timer) return
        const wait = (this.deps.stableMs ?? 2000) + 500
        conv.timer = setTimeout(() => {
            conv.timer = null
            void this.scan(conv.entry.conversationId).then(() => {
                conv.timer = setTimeout(() => {
                    conv.timer = null
                    void this.scan(conv.entry.conversationId)
                }, wait)
            })
        }, wait)
    }

    async scan(conversationId: string): Promise<void> {
        const conv = this.conversations.get(conversationId)
        if (!conv) return
        try {
            await conv.sync.flush()
            await conv.sync.scan()
        } catch (err) {
            this.deps.log?.(`scan of ${conversationId} failed: ${(err as Error).message}`)
        }
    }

    async scanAll(): Promise<void> {
        for (const id of this.conversations.keys()) await this.scan(id)
    }

    /** "Проверить папки" in the tray menu: scan and maintain every discussion. */
    async checkAll(): Promise<void> {
        for (const c of this.conversations.values()) {
            await this.scan(c.entry.conversationId)
            await c.sync
                .maintain()
                .catch((err) => this.deps.log?.(`maintenance failed: ${(err as Error).message}`))
            await this.refreshView(c)
        }
    }

    /** Every registered discussion of this identity, with its sync state (null: the sync did not start). */
    statusList(): ConversationStatus[] {
        const ownId = this.deps.settings.get().participantId
        return this.deps.registry
            .list()
            .filter((e) => e.ownId === ownId)
            .map((e) => ({
                conversationId: e.conversationId,
                filePath: e.filePath,
                health: this.conversations.get(e.conversationId)?.sync.health() ?? null
            }))
    }

    private readonly lastStatus = new Map<string, string>()

    private statusChanged(conv: Conversation): void {
        const h = conv.sync.health()
        const key = `${h.folder}|${h.quarantined}|${h.needsUpdate}`
        if (this.lastStatus.get(conv.entry.conversationId) === key) return
        this.lastStatus.set(conv.entry.conversationId, key)
        this.deps.onStatusChange?.()
    }

    /** Loading messages, own copy states, and the status line of the window (D-37, FR-169, FR-172). */
    private async refreshView(conv: Conversation): Promise<void> {
        const session = conv.session
        if (!session) return
        const loading: LoadingMessage[] = await conv.sync.loadingMessages()
        const copies: DocumentView['copies'] = {}
        for (const [messageId, d] of Object.entries(conv.sync.deliveries()))
            copies[messageId] = d.members
        const health = conv.sync.health()
        const syncStatus = { ...health, folderPath: conv.entry.sharedRoot }
        const json = JSON.stringify({
            loading,
            copies,
            syncStatus: { ...syncStatus, lastScanAt: null }
        })
        session.syncStatus = syncStatus
        if (json === conv.viewJson) return
        conv.viewJson = json
        session.loading = loading
        session.copies = copies
        session.onChange()
    }

    /** "Проверить папки" in the window (FR-172): scan now. */
    async checkNow(session: DocumentSession): Promise<void> {
        for (const c of this.conversations.values())
            if (c.session === session) {
                await this.scan(c.entry.conversationId)
                await c.sync.maintain()
                await this.refreshView(c)
            }
    }

    /** A window that opens a registered file waits until no write to that file is running. */
    async beforeOpen(path: string): Promise<void> {
        for (const c of this.conversations.values())
            if (pathKey(c.entry.filePath) === pathKey(path)) {
                await c.file.idle()
                c.file.invalidate()
            }
    }

    /** True if the registered file of this conversation is missing (it was moved or renamed, FR-168). */
    async registeredFileMissing(conversationId: string): Promise<boolean> {
        const entry = this.deps.registry.get(conversationId)
        if (!entry) return false
        try {
            await fs.access(entry.filePath)
            return false
        } catch {
            return true
        }
    }

    /** The person confirmed that this file is the moved discussion (FR-168). */
    async adoptMovedFile(conversationId: string, path: string): Promise<void> {
        await this.deps.registry.updatePath(conversationId, path)
        const conv = this.conversations.get(conversationId)
        if (conv) {
            await conv.stopWatch?.()
            this.conversations.delete(conversationId)
        }
        const entry = this.deps.registry.get(conversationId)
        if (entry) await this.open(entry)
    }

    /** Connects a window's session: the registered copy is synchronized; any other copy is detached. */
    async attach(session: DocumentSession): Promise<AttachResult> {
        if (!session.current.sync) return 'plain'
        const entry = this.deps.registry.get(session.documentId)
        if (!entry || pathKey(entry.filePath) !== pathKey(session.path)) return 'detached'
        if (!this.conversations.has(entry.conversationId))
            await this.open(entry).catch((err) => this.fail(entry, err))
        const conv = this.conversations.get(entry.conversationId)
        if (!conv) return 'detached'
        conv.session = session
        conv.file.invalidate()
        session.syncHook = (before: DocumentContents, after: DocumentContents) => {
            const events = eventsFromChange(before, after, entry.ownId, this.deps.now())
            if (events.length > 0)
                void conv.sync
                    .send(events, after)
                    .then(() => this.refreshView(conv))
                    .catch((err) => this.deps.log?.(`send failed: ${(err as Error).message}`))
        }
        // the name may have changed in Settings while this discussion was closed
        const { displayName, participantId } = this.deps.settings.get()
        if (displayName) session.renameLocal({ participantId, displayName })
        conv.viewJson = ''
        await this.refreshView(conv)
        void this.scan(entry.conversationId)
        return 'synced'
    }

    /** The window closed: from now on the sync service uses the file. */
    async detach(session: DocumentSession): Promise<void> {
        for (const c of this.conversations.values())
            if (c.session === session) {
                await session.flush()
                c.session = null
                c.file.invalidate()
                session.syncHook = null
            }
    }

    /** The name changed in Settings: every synchronized discussion sends `profile.updated` (D-12). */
    async nameChanged(displayName: string): Promise<void> {
        const participantId = this.deps.settings.get().participantId
        for (const c of this.conversations.values()) {
            if (c.session) {
                c.session.renameLocal({ participantId, displayName })
                continue
            }
            let before: DocumentContents | null = null
            let after: DocumentContents | null = null
            await c.file.update((contents) => {
                const next = withLocalDisplayName(contents, participantId, displayName)
                if (next === contents) return null
                before = contents
                after = next
                return { contents: next, images: [] }
            })
            if (before && after)
                await c.sync.send(
                    eventsFromChange(before, after, participantId, this.deps.now()),
                    after
                )
        }
    }

    async invite(
        conversationId: string,
        recipientId: string,
        snapshot: Uint8Array,
        contents: DocumentContents
    ): Promise<void> {
        const conv = this.conversations.get(conversationId)
        if (!conv) throw new Error('conversation is not running')
        await conv.sync.invite(recipientId, snapshot, contents)
    }

    async confirmInvitation(
        conversationId: string,
        inviterId: string,
        ids: readonly string[],
        fileNames: readonly string[]
    ): Promise<void> {
        const conv = this.conversations.get(conversationId)
        if (!conv) throw new Error('conversation is not running')
        await conv.sync.confirmInvitation(inviterId, ids, fileNames)
        await this.scan(conversationId)
    }

    /** Roster of a discussion with the state of each invitation (design 12.3, step 8). */
    invitationStatus(conversationId: string): Record<string, 'invited' | 'joined'> {
        return this.conversations.get(conversationId)?.sync.invitationStatus() ?? {}
    }

    /** The number of registered discussions of this identity: the app stays in the tray if it is not 0 (D-33). */
    get count(): number {
        return this.statusList().length
    }
}
