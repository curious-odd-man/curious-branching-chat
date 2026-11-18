import type { IpcMainInvokeEvent } from 'electron'
import type { ZodType } from 'zod'
import type { AttachmentService } from '../application/attachments'
import type { AppController, WindowEntry } from '../application/appController'
import type { DocumentSession, ReadAction } from '../application/documentSession'
import { AppError } from '../application/errors'
import type { Ui } from '../application/ui'
import type { BackgroundService } from '../background/backgroundService'
import type { IdentityService } from '../crypto/identityService'
import type { BackupService, LibraryService, Migration } from '../library'
import type { SettingsStore } from '../local-state/settings'
import type { Onboarding } from '../sync/onboarding'
import type { SyncService } from '../sync/syncService'
import type { UpdateService } from '../updates/updateService'
import type { AssociationService } from '../windows/associationService'
import type { ZoomService } from '../windows/zoom'

/** What the IPC handlers use (code review 4.2: one typed object instead of positional parameters). */
export interface IpcDeps {
    controller: AppController
    settings: SettingsStore
    library: LibraryService
    association: AssociationService
    updates: UpdateService
    identity: IdentityService
    /** Synchronized discussions; absent in tests that do not need them. */
    sync?: SyncService
    shared?: {
        onboarding: Onboarding
        ui: Ui
        background?: BackgroundService
        zoom?: ZoomService
        migration?: Migration
        backups?: BackupService
        /** Restarts the application (after a restore was scheduled). */
        relaunch?: () => void
        /** FR-293: restarts the application the normal way (windows close, drafts are saved). */
        restart?: () => void
        attachments?: AttachmentService
        /** Errors without a code (programming errors) go to the log. */
        log?: (message: string, err: unknown) => void
    }
}

/** Registers one channel: the sender is checked and the payload validated before `fn` runs. */
export type Handle = <P, R>(
    channel: string,
    schema: ZodType<P>,
    fn: (entry: WindowEntry | undefined, payload: P, event: IpcMainInvokeEvent) => Promise<R> | R
) => void

/** The dependencies and the checks that several handler modules use. */
export interface IpcContext extends IpcDeps {
    handle: Handle
    requireSession(entry: WindowEntry | undefined): DocumentSession
    requireName(): { participantId: string; displayName: string }
    /**
     * Before the first change to the person's read state on this computer, the window must have shown the notice that
     * read status is visible to other participants (FR-125). Nothing is changed until it was acknowledged.
     */
    withReadNotice(
        entry: WindowEntry | undefined,
        action: ReadAction
    ): { session: DocumentSession; me: { participantId: string; displayName: string } }
    onboarding(): Onboarding
    backups(): BackupService
    requireAttachments(): AttachmentService
}

export function makeContext(deps: IpcDeps, handle: Handle): IpcContext {
    const { settings, shared } = deps
    const requireSession = (entry: WindowEntry | undefined): DocumentSession => {
        if (!entry?.session) throw new AppError('NO_DOCUMENT', 'No open discussion')
        return entry.session
    }
    const requireName = (): { participantId: string; displayName: string } => {
        const me = settings.get()
        if (!me.displayName) throw new AppError('NAME_REQUIRED', 'Name required')
        return { participantId: me.participantId, displayName: me.displayName }
    }
    return {
        ...deps,
        handle,
        requireSession,
        requireName,
        withReadNotice: (entry, action) => {
            const session = requireSession(entry)
            const me = requireName()
            if (
                !settings.get().readNoticeAcknowledged &&
                session.readStateChangeFor(me.participantId, action)
            )
                throw new AppError('READ_NOTICE_REQUIRED', 'Read notice required')
            return { session, me }
        },
        onboarding: () => {
            if (!shared) throw new AppError('NO_DOCUMENT', 'not available')
            return shared.onboarding
        },
        backups: () => {
            if (!shared?.backups) throw new AppError('NO_DOCUMENT', 'not available')
            return shared.backups
        },
        requireAttachments: () => {
            if (!shared?.attachments)
                throw new AppError('INVALID_REQUEST', 'attachments are not available')
            return shared.attachments
        }
    }
}
