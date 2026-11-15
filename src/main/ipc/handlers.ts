import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { ZodError, type ZodType } from 'zod'
import { DomainError } from '@shared/domain'
import { describeError, ru } from '@shared/i18n/ru'
import { IPC, type IpcResult } from '@shared/types/ipc'
import {
    appendMessageSchema,
    createBranchSchema,
    draftSchema,
    markMessageSchema,
    markThreadSchema,
    noPayloadSchema,
    openLinkSchema,
    openPathSchema,
    openDiscussionSchema,
    migrationRunSchema,
    backupRestoreSchema,
    newDocumentSchema,
    setAssociationSchema,
    setAutoUpdateSchema,
    setOpenLastSchema,
    setFileSizeLimitSchema,
    setBackgroundFlagSchema,
    setTextSizeSchema,
    zoomChangeSchema,
    sharedRootSchema,
    sharedParseKeySchema,
    sharedCreateSchema,
    sharedInviteSchema,
    sharedReinviteSchema,
    decideKeysSchema,
    joinImportSchema,
    setRecentLimitSchema,
    setNameSchema,
    stageImageSchema,
    setStatusSchema,
    setTitleSchema
} from '@shared/validation'
import type { AppController, WindowEntry } from '../application/appController'
import { AppError } from '../application/errors'
import type { ReadAction } from '../application/documentSession'
import { DocumentError } from '../document'
import { openExternalLink } from '../windows/security'
import { describeDiscussions } from '../application/recentView'
import type { BackupService, LibraryService, Migration } from '../library'
import { LibraryError } from '../library/schema'
import type { SettingsStore } from '../local-state/settings'
import type { UpdateService } from '../updates/updateService'
import type { AssociationService } from '../windows/associationService'
import type { IdentityService } from '../crypto/identityService'
import type { SyncService } from '../sync/syncService'
import type { Onboarding } from '../sync/onboarding'
import { groupFingerprint } from '../crypto/identity'
import type { Ui } from '../application/ui'
import type { RosterView } from '@shared/types/ipc'
import type { BackgroundService } from '../background/backgroundService'
import type { ZoomService } from '../windows/zoom'

/** Only the application's own page may call the main process: the packaged `file:` page, or the dev server. */
function isAppPage(url: string): boolean {
    const dev = process.env['ELECTRON_RENDERER_URL']
    return url.startsWith('file://') || (dev !== undefined && url.startsWith(dev))
}

function toError(err: unknown): { code: string; message: string } {
    if (
        err instanceof AppError ||
        err instanceof DocumentError ||
        err instanceof DomainError ||
        err instanceof LibraryError
    )
        return {
            code: err.code,
            message: err instanceof DomainError ? err.message : describeError(err.code)
        }
    if (err instanceof ZodError) return { code: 'INVALID_REQUEST', message: 'Invalid request.' }
    return { code: 'UNKNOWN', message: describeError('UNKNOWN') }
}

/** Every channel validates its payload and its sender; the renderer is never trusted. */
export function registerIpcHandlers(
    controller: AppController,
    settings: SettingsStore,
    library: LibraryService,
    association: AssociationService,
    updates: UpdateService,
    identity: IdentityService,
    sync?: SyncService,
    shared?: {
        onboarding: Onboarding
        ui: Ui
        background?: BackgroundService
        zoom?: ZoomService
        migration?: Migration
        backups?: BackupService
        /** Restarts the application (after a restore was scheduled). */
        relaunch?: () => void
    }
): void {
    function handle<P, R>(
        channel: string,
        schema: ZodType<P>,
        fn: (
            entry: WindowEntry | undefined,
            payload: P,
            event: IpcMainInvokeEvent
        ) => Promise<R> | R
    ): void {
        ipcMain.handle(channel, async (event, raw: unknown): Promise<IpcResult<R>> => {
            try {
                if (
                    event.senderFrame !== event.sender.mainFrame ||
                    !isAppPage(event.senderFrame.url)
                )
                    throw new AppError('FORBIDDEN', 'Forbidden')
                const payload = schema.parse(raw)
                return {
                    ok: true,
                    data: await fn(controller.entryFor(event.sender), payload, event)
                }
            } catch (err) {
                return { ok: false, error: toError(err) }
            }
        })
    }

    const requireSession = (entry: WindowEntry | undefined) => {
        if (!entry?.session) throw new AppError('NO_DOCUMENT', 'No open discussion')
        return entry.session
    }

    handle(IPC.appInfo, noPayloadSchema, () => ({ name: app.getName(), version: app.getVersion() }))
    handle(IPC.identityGet, noPayloadSchema, () => identity.view())

    // ---- synchronized discussions: wizards (FR-158, FR-162) ----
    const onboarding = (): Onboarding => {
        if (!shared) throw new AppError('NO_DOCUMENT', 'not available')
        return shared.onboarding
    }
    handle(IPC.sharedPickFolder, noPayloadSchema, async (entry) => {
        const path = await shared?.ui.pickFolder(entry?.win)
        if (!path) return null
        return { path, test: await onboarding().testFolder(path) }
    })
    handle(IPC.sharedPublishKey, sharedRootSchema, async (_e, p) => {
        await onboarding().publishOwnKey(p.root)
        return null
    })
    handle(IPC.sharedCandidates, sharedRootSchema, (_e, p) => onboarding().candidates(p.root))
    handle(IPC.sharedParseKey, sharedParseKeySchema, (_e, p) => onboarding().parseKey(p.text))
    handle(IPC.sharedPickKeyFile, noPayloadSchema, async (entry) => {
        const path = await shared?.ui.pickKeyFile(entry?.win)
        return path ? onboarding().readKeyFile(path) : null
    })
    handle(IPC.sharedCreate, sharedCreateSchema, async (entry, p) => {
        if (p.mode === 'convert') {
            const session = requireSession(entry)
            if (session.current.sync) throw new AppError('FOLDER_IN_USE', 'already shared')
            await onboarding().create({ root: p.root, keys: p.keys, session })
            await shared?.background?.discussionAdded()
            session.onChange()
            return true
        }
        const id = await onboarding().create({
            root: p.root,
            title: p.title ?? ru.shared.defaultFileName,
            keys: p.keys
        })
        await shared?.background?.discussionAdded()
        await controller.openDiscussion(id, entry)
        return true
    })
    handle(IPC.sharedInvite, sharedInviteSchema, async (entry, p) => {
        const count = await onboarding().inviteMembers({
            session: requireSession(entry),
            keys: p.keys
        })
        entry?.session?.onChange()
        return count
    })
    handle(IPC.sharedReinvite, sharedReinviteSchema, async (entry, p) => {
        await onboarding().reinviteMember({
            session: requireSession(entry),
            participantId: p.participantId,
            key: p.key
        })
        entry?.session?.onChange()
        return null
    })
    handle(IPC.syncDecideKeys, decideKeysSchema, async (entry, p) => {
        const session = requireSession(entry)
        await sync?.decideKeys(session.documentId, p.participantId, p.accept)
        return null
    })
    handle(IPC.sharedRoster, noPayloadSchema, (entry): RosterView | null => {
        const session = entry?.session
        const roster = session?.current.sync
        const running = session ? sync?.entryOf(session.documentId) : null
        if (!session || !roster || !session.synced || !running) return null
        const states = sync?.invitationStatus(session.documentId) ?? {}
        const me = settings.get().participantId
        const names = new Map(roster.members.map((m) => [m.participantId, m.displayName]))
        return {
            sharedRoot: running.sharedRoot,
            members: roster.members.map((m) => ({
                participantId: m.participantId,
                displayName: m.displayName,
                fingerprint: groupFingerprint(m.fingerprint),
                state: m.participantId === me ? 'self' : (states[m.participantId] ?? 'member'),
                addedByName:
                    m.addedBy === m.participantId ? null : (names.get(m.addedBy) ?? m.addedBy)
            }))
        }
    })
    handle(IPC.syncCheckNow, noPayloadSchema, async (entry) => {
        const session = requireSession(entry)
        await sync?.checkNow(session)
        return null
    })
    handle(IPC.joinFind, sharedRootSchema, (_e, p) => onboarding().findInvitation(p.root))
    handle(IPC.joinImport, joinImportSchema, async (entry, p) => {
        const found = await onboarding().findInvitation(p.root)
        if (found.state !== 'ready' || found.invitationId !== p.invitationId)
            throw new AppError('INVITATION_GONE', 'the invitation is not available')
        const id = await onboarding().importInvitation(p.root, p.invitationId)
        await shared?.background?.discussionAdded()
        await controller.openDiscussion(id, entry)
        return true
    })
    handle(IPC.identityCopyBundle, noPayloadSchema, async () => {
        await identity.copyBundle()
        return null
    })
    handle(IPC.identitySaveBundle, noPayloadSchema, (entry) => identity.saveBundle(entry?.win))
    handle(IPC.settingsGet, noPayloadSchema, () => settings.get())
    handle(IPC.settingsSetName, setNameSchema, async (_e, p) => {
        const view = await settings.setDisplayName(p.displayName)
        // D-12: synchronized discussions send the new name to the other members
        if (view.displayName) await sync?.nameChanged(view.displayName)
        return view
    })

    handle(IPC.settingsSetAutoUpdate, setAutoUpdateSchema, (_e, p) =>
        settings.setAutoUpdateCheck(p.enabled)
    )
    handle(IPC.settingsSetRecentLimit, setRecentLimitSchema, async (_e, p) => {
        const updated = await settings.setRecentFilesLimit(p.limit)
        library.changed() // the File menu and the jump list show a different number
        return updated
    })
    handle(IPC.settingsSetBackgroundFlag, setBackgroundFlagSchema, (_e, p) =>
        shared?.background
            ? shared.background.setFlag(p.flag, p.enabled)
            : settings.setFlag(p.flag, p.enabled)
    )
    handle(IPC.settingsSetTextSize, setTextSizeSchema, (_e, p) =>
        shared?.zoom ? shared.zoom.set(p.percent) : settings.setTextSize(p.percent)
    )
    handle(IPC.zoomChange, zoomChangeSchema, async (_e, p) => {
        await shared?.zoom?.change(p.direction)
        return null
    })
    handle(IPC.focusTake, noPayloadSchema, (entry) => controller.takeFocusRequest(entry))
    handle(IPC.settingsSetFileSizeLimit, setFileSizeLimitSchema, (_e, p) =>
        settings.setFileSizeLimit(p.mb)
    )
    handle(IPC.settingsSetOpenLast, setOpenLastSchema, (_e, p) =>
        settings.setOpenLastFileOnStartup(p.enabled)
    )
    handle(IPC.libraryList, noPayloadSchema, () => describeDiscussions(library.list()))
    const backups = (): BackupService => {
        if (!shared?.backups) throw new AppError('NO_DOCUMENT', 'not available')
        return shared.backups
    }
    handle(IPC.backupGet, noPayloadSchema, async () => ({
        lastBackupAt: backups().lastBackupAt(),
        folder: settings.get().backupFolder,
        backups: await backups().list()
    }))
    handle(IPC.backupNow, noPayloadSchema, async () => {
        const r = await backups().make('manual')
        return { createdAt: r.backups[0]!.createdAt, folderError: r.folderError }
    })
    handle(IPC.backupPickFolder, noPayloadSchema, async (entry) => {
        const folder = await shared?.ui.pickFolder(entry?.win, ru.backup.folderTitle)
        if (!folder) return null
        // FR-209: once, a warning that a cloud folder stores the messages readable for the provider
        if (await settings.takeBackupFolderWarning()) {
            const ok = await shared!.ui.confirm(entry?.win, {
                title: ru.backup.cloudWarningTitle,
                message: ru.backup.cloudWarning,
                yes: ru.backup.cloudContinue,
                no: ru.backup.cloudCancel
            })
            if (!ok) return null
        }
        return settings.setBackupFolder(folder)
    })
    handle(IPC.backupClearFolder, noPayloadSchema, () => settings.setBackupFolder(null))
    handle(IPC.backupRestore, backupRestoreSchema, async (entry, p) => {
        const chosen = (await backups().list()).find((b) => b.path === p.path)
        if (!chosen) throw new AppError('INVALID_REQUEST', 'unknown backup')
        const ok = await shared!.ui.confirm(entry?.win, {
            title: ru.backup.restoreTitle,
            message: ru.backup.restoreQuestion,
            detail: ru.backup.restoreDetail(
                new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short' }).format(
                    new Date(chosen.createdAt)
                )
            ),
            yes: ru.backup.restoreConfirm,
            no: ru.backup.restoreCancel
        })
        if (!ok) return false
        await backups().scheduleRestore(chosen.path)
        setTimeout(() => shared?.relaunch?.(), 100)
        return true
    })
    handle(IPC.migrationGet, noPayloadSchema, () => shared?.migration?.candidates() ?? [])
    handle(IPC.migrationRun, migrationRunSchema, async (_e, p) => {
        const migration = shared?.migration
        if (!migration) return []
        // only files that were offered (the page is not trusted with paths)
        const offered = new Set((await migration.candidates()).map((c) => c.path))
        const results = await migration.run(p.paths.filter((path) => offered.has(path)))
        for (const r of results) if (r.synced && r.id) await sync?.startRegistered(r.id)
        if (results.some((r) => r.synced && r.id)) await shared?.background?.discussionAdded()
        library.changed()
        return results
    })
    handle(IPC.migrationSkip, noPayloadSchema, () => {
        shared?.migration?.skip()
        return null
    })
    handle(IPC.updateGetState, noPayloadSchema, () => updates.get())
    // The work continues in the background; progress and results arrive as state changes (FR-095).
    handle(IPC.updateCheck, noPayloadSchema, () => {
        void updates.checkManually()
        return null
    })
    handle(IPC.updateDownload, noPayloadSchema, () => {
        void updates.download()
        return null
    })
    handle(IPC.updateInstall, noPayloadSchema, () => {
        updates.install()
        return null
    })
    handle(IPC.updateShowDialog, noPayloadSchema, () => {
        updates.showDialog()
        return null
    })
    handle(IPC.updateDismiss, noPayloadSchema, () => {
        updates.dismissDialog()
        return null
    })
    handle(IPC.updateOpenReleasePage, noPayloadSchema, () => updates.openReleasePage())
    handle(IPC.associationGet, noPayloadSchema, () => association.info())
    handle(IPC.associationSet, setAssociationSchema, (_e, p) => association.set(p.enabled))

    handle(IPC.documentNew, newDocumentSchema, (entry, p) => controller.newDocument(entry, p.title))
    handle(IPC.documentOpenDialog, noPayloadSchema, (entry) => controller.openWithDialog(entry))
    handle(IPC.documentOpenPath, openPathSchema, (entry, p) => controller.openPath(p.path, entry))
    handle(IPC.documentOpenId, openDiscussionSchema, (entry, p) =>
        controller.openDiscussion(p.id, entry)
    )
    handle(IPC.documentExport, noPayloadSchema, (entry) => controller.exportDiscussion(entry))
    handle(IPC.documentGetState, noPayloadSchema, (entry) =>
        entry ? controller.viewOf(entry) : null
    )

    const requireName = (): { participantId: string; displayName: string } => {
        const me = settings.get()
        if (!me.displayName) throw new AppError('NAME_REQUIRED', 'Name required')
        return { participantId: me.participantId, displayName: me.displayName }
    }
    /**
     * Before the first change to the person's read state on this computer, the window must have shown the notice that
     * read status is visible to other participants (FR-125). Nothing is changed until it was acknowledged.
     */
    const withReadNotice = (entry: WindowEntry | undefined, action: ReadAction) => {
        const session = requireSession(entry)
        const me = requireName()
        if (
            !settings.get().readNoticeAcknowledged &&
            session.readStateChangeFor(me.participantId, action)
        )
            throw new AppError('READ_NOTICE_REQUIRED', 'Read notice required')
        return { session, me }
    }

    handle(IPC.documentAppendMessage, appendMessageSchema, (entry, p) => {
        const { session, me } = withReadNotice(entry, { type: 'send', threadId: p.threadId })
        session.appendMessage(me, p.threadId, p.content)
    })
    handle(IPC.readMarkMessage, markMessageSchema, (entry, p) => {
        const { session, me } = withReadNotice(entry, { type: 'message', messageId: p.messageId })
        session.markMessageRead(me, p.messageId)
        return null
    })
    handle(IPC.readMarkThread, markThreadSchema, (entry, p) => {
        const { session, me } = withReadNotice(entry, { type: 'thread', threadId: p.threadId })
        session.markThreadRead(me, p.threadId)
        return null
    })
    handle(IPC.readMarkAll, noPayloadSchema, (entry) => {
        const { session, me } = withReadNotice(entry, { type: 'all' })
        session.markAllRead(me)
        return null
    })
    handle(IPC.settingsAckReadNotice, noPayloadSchema, () => settings.acknowledgeReadNotice())
    handle(IPC.branchCreate, createBranchSchema, (entry, p) => {
        const { session, me } = withReadNotice(entry, {
            type: 'branch',
            messageId: p.sourceMessageId
        })
        return { threadId: session.createBranch(me, p) }
    })
    handle(IPC.branchSetStatus, setStatusSchema, (entry, p) => {
        requireSession(entry).setThreadStatus(settings.get().participantId, p.threadId, p.status)
        return null
    })
    handle(IPC.branchSetTitle, setTitleSchema, (entry, p) => {
        requireSession(entry).setThreadTitle(settings.get().participantId, p.threadId, p.title)
        return null
    })
    handle(IPC.documentRetrySave, noPayloadSchema, async (entry) => {
        await requireSession(entry).retrySave()
    })
    handle(IPC.imageStage, stageImageSchema, (entry, p) =>
        requireSession(entry).stageImage(
            Buffer.from(p.data.buffer, p.data.byteOffset, p.data.byteLength)
        )
    )
    handle(IPC.imagePick, noPayloadSchema, (entry) => controller.pickImage(entry))
    handle(IPC.linkOpen, openLinkSchema, (_entry, p) => openExternalLink(p.url))
    handle(IPC.draftSet, draftSchema, (entry, p) => {
        if (entry) entry.hasDraft = p.hasDraft
    })
}
