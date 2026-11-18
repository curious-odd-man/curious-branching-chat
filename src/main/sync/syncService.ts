import { join } from 'node:path'
import {
    eventsFromChange,
    withLocalDisplayName,
    type LoadingMessage,
    type NewMemberKeys
} from '@shared/sync'
import type { DocumentContents, Message, RosterMember } from '@shared/validation'
import type { DocumentSession } from '../application/documentSession'
import type { KeyStore } from '../crypto/keyStore'
import type { SettingsStore } from '../local-state/settings'
import { FolderTransport } from '../transport/folderTransport'
import { ConversationSync, RETRY_INTERVAL_MS, type SyncHealth } from './conversationSync'
import type { DocumentView, SyncStatusView } from '@shared/types/ipc'
import { groupFingerprint } from '../crypto/identity'
import type { DiscussionStore, LibraryService } from '../library'
import type { RegistryEntry, SyncRegistry } from './registry'
import { SyncState, conversationDir } from './syncState'

export interface SyncServiceDeps {
    userData: string
    /** Where the discussions are (ADR-003): open and closed ones are written the same way. */
    library: LibraryService
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
    title: string
    messages: Message[]
    contents: DocumentContents
}

/** Sync state of one registered discussion for the tray menu (D-35). */
export interface ConversationStatus {
    conversationId: string
    title: string
    health: SyncHealth | null
}

export type AttachResult =
    /** A registered discussion: synchronized. */
    | 'synced'
    /** A discussion with a member list that is not registered on this computer (another identity, FR-154). */
    | 'detached'
    /** A normal discussion. */
    | 'plain'

interface Conversation {
    entry: RegistryEntry
    sync: ConversationSync
    store: DiscussionStore
    session: DocumentSession | null
    stopWatch: (() => Promise<void>) | null
    viewJson: string
    timer: NodeJS.Timeout | null
}

/**
 * Runs every synchronized discussion of this computer (design sections 10, 13 to 17): through the discussion's store
 * in the library, which hands the change to the window's session while a window shows it.
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
        if (!this.deps.library.has(entry.conversationId))
            throw new Error('the discussion is not in the library')
        const state = await SyncState.open(
            conversationDir(this.syncRoot, entry.conversationId),
            entry.conversationId,
            entry.ownId
        )
        const transport = new FolderTransport(entry.sharedRoot, state.stagingDir)
        const store = this.deps.library.store(entry.conversationId)
        // the callbacks run only after start(), when the conversation exists (code review Y-2)
        const ref: { conv?: Conversation } = {}
        const sync = new ConversationSync({
            conversationId: entry.conversationId,
            ownId: entry.ownId,
            transport,
            state,
            keys: {
                sign: (d) => this.deps.keys.sign(entry.ownId, d),
                open: (s) => this.deps.keys.openSealed(entry.ownId, s)
            },
            document: store,
            now: this.deps.now,
            newId: this.deps.newId,
            maxFileBytes: () => this.deps.settings.get().fileSizeLimitMb * 1024 * 1024,
            appVersion: this.deps.appVersion,
            ...(this.deps.stableMs !== undefined ? { stableMs: this.deps.stableMs } : {}),
            onChange: () => {
                if (!ref.conv) return
                void this.refreshView(ref.conv)
                this.statusChanged(ref.conv)
            },
            onAttachments: () => ref.conv?.session?.onChange(),
            onNewMessages: (messages, contents) =>
                this.deps.onNewMessages?.({
                    conversationId: entry.conversationId,
                    title: contents.discussion.title,
                    messages,
                    contents
                }),
            ...(this.deps.log ? { log: this.deps.log } : {})
        })
        const conv: Conversation = {
            entry,
            sync,
            store,
            session: null,
            stopWatch: null,
            viewJson: '',
            timer: null
        }
        ref.conv = conv
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
            .filter((e) => e.ownId === ownId && this.deps.library.has(e.conversationId))
            .map((e) => ({
                conversationId: e.conversationId,
                title: this.deps.library.summary(e.conversationId)?.title ?? e.conversationId,
                health: this.conversations.get(e.conversationId)?.sync.health() ?? null
            }))
    }

    private readonly lastStatus = new Map<string, string>()

    private statusChanged(conv: Conversation): void {
        const h = conv.sync.health()
        const key = `${h.folder}|${h.quarantined}|${h.needsUpdate}|${h.keyRequests.length}`
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
        const members = session.current.sync?.members ?? []
        const nameOf = (id: string): string =>
            members.find((m) => m.participantId === id)?.displayName ?? id
        const { keyRequests, rejoinHeardFrom, ...rest } = health
        const syncStatus: SyncStatusView = {
            ...rest,
            folderPath: conv.entry.sharedRoot,
            keyRequests: keyRequests.map((r) => ({
                participantId: r.participantId,
                displayName: nameOf(r.participantId),
                fingerprint: groupFingerprint(r.fingerprint),
                state: r.state
            })),
            notAccepted: rejoinHeardFrom
                ? members
                      .filter(
                          (m) =>
                              m.participantId !== conv.entry.ownId &&
                              !rejoinHeardFrom.includes(m.participantId)
                      )
                      .map((m) => m.displayName)
                : []
        }
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

    /** Starts the sync of a registered discussion that came into the library later (the migration, FR-206). */
    async startRegistered(conversationId: string): Promise<void> {
        const entry = this.deps.registry.get(conversationId)
        if (entry) await this.open(entry).catch((err) => this.fail(entry, err))
    }

    /** Starts the sync of a discussion again (D-32: the own ID and keys changed with a re-invitation). */
    async restart(entry: RegistryEntry): Promise<void> {
        const conv = this.conversations.get(entry.conversationId)
        if (conv) {
            if (conv.timer) clearTimeout(conv.timer)
            await conv.stopWatch?.()
            this.conversations.delete(entry.conversationId)
        }
        await this.open(entry)
    }

    /** Connects a window's session: a registered discussion is synchronized. */
    async attach(session: DocumentSession): Promise<AttachResult> {
        if (!session.current.sync) return 'plain'
        const entry = this.deps.registry.get(session.documentId)
        if (!entry) return 'detached'
        if (!this.conversations.has(entry.conversationId))
            await this.open(entry).catch((err) => this.fail(entry, err))
        const conv = this.conversations.get(entry.conversationId)
        if (!conv) return 'detached'
        conv.session = session
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

    /** The window closed: from now on the sync service writes into the library directly. */
    async detach(session: DocumentSession): Promise<void> {
        for (const c of this.conversations.values())
            if (c.session === session) {
                await session.flush()
                c.session = null
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
            await c.store.update((contents) => {
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

    /**
     * FR-176: adds members to an active discussion and tells the earlier members; returns the discussion as it is now
     * saved (the snapshot for the invitations is made from it).
     */
    async addMembers(
        conversationId: string,
        members: readonly RosterMember[]
    ): Promise<DocumentContents> {
        const conv = this.conversations.get(conversationId)
        if (!conv) throw new Error('conversation is not running')
        const after = await conv.sync.addMembers(members)
        if (conv.session) await conv.session.flush()
        await conv.store.idle()
        return after
    }

    /** FR-177: re-invite a person who lost the keys (see ConversationSync.replaceKeys). */
    async replaceKeys(
        conversationId: string,
        participantId: string,
        keys: NewMemberKeys
    ): Promise<DocumentContents> {
        const conv = this.conversations.get(conversationId)
        if (!conv) throw new Error('conversation is not running')
        const after = await conv.sync.replaceKeys(participantId, keys)
        if (conv.session) await conv.session.flush()
        await conv.store.idle()
        return after
    }

    /** D-32: the decision of this member about new keys of another member (status line). */
    async decideKeys(
        conversationId: string,
        participantId: string,
        accept: boolean
    ): Promise<void> {
        const conv = this.conversations.get(conversationId)
        if (!conv) return
        await conv.sync.decideKeys(participantId, accept)
        if (accept) await this.scan(conversationId)
        await this.refreshView(conv)
    }

    /** D-32: after importing a re-invitation. */
    async startRejoin(conversationId: string, inviterId: string): Promise<void> {
        await this.conversations.get(conversationId)?.sync.startRejoin(inviterId)
    }

    /** The registry entry (shared folder) of a running discussion. */
    entryOf(conversationId: string): RegistryEntry | null {
        return this.conversations.get(conversationId)?.entry ?? null
    }

    async invite(
        conversationId: string,
        recipientId: string,
        snapshot: Uint8Array,
        contents: DocumentContents,
        rejoin?: { inboxId: string }
    ): Promise<void> {
        const conv = this.conversations.get(conversationId)
        if (!conv) throw new Error('conversation is not running')
        await conv.sync.invite(recipientId, snapshot, contents, rejoin)
    }

    async confirmInvitation(
        conversationId: string,
        inviterId: string,
        ids: readonly string[],
        fileNames: readonly string[],
        /** The inbox that holds the invitation files (the person's ID before a re-invitation, D-32). */
        inboxId?: string
    ): Promise<void> {
        const conv = this.conversations.get(conversationId)
        if (!conv) throw new Error('conversation is not running')
        await conv.sync.confirmInvitation(inviterId, ids, fileNames, inboxId)
        await this.scan(conversationId)
    }

    /** Roster of a discussion with the state of each invitation (design 12.3, step 8). */
    invitationStatus(conversationId: string): Record<string, 'invited' | 'joined'> {
        return this.conversations.get(conversationId)?.sync.invitationStatus() ?? {}
    }

    /** FR-268: the file size limit changed in Settings: tell the other members, and read files that waited. */
    async limitChanged(): Promise<void> {
        for (const c of this.conversations.values())
            await c.sync
                .announceLimits()
                .catch((err) => this.deps.log?.(`limits failed: ${(err as Error).message}`))
        await this.scanAll()
    }

    /** FR-268: members of a discussion that will not get a file of `bytes` (their limit is smaller), with names. */
    async receiversBelow(
        conversationId: string,
        bytes: number
    ): Promise<Array<{ displayName: string; maxFileMb: number }>> {
        const conv = this.conversations.get(conversationId)
        if (!conv) return []
        const contents = await conv.store.read()
        const nameOf = (id: string): string =>
            contents.sync?.members.find((m) => m.participantId === id)?.displayName ?? id
        return (await conv.sync.receiversBelow(bytes)).map((r) => ({
            displayName: nameOf(r.participantId),
            maxFileMb: r.maxFileMb
        }))
    }

    /** The number of registered discussions of this identity: the app stays in the tray if it is not 0 (D-33). */
    get count(): number {
        return this.statusList().length
    }
}
