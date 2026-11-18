import { locale, texts } from '@shared/i18n'
import { IPC } from '@shared/types/ipc'
import {
    backupRestoreSchema,
    draftSaveSchema,
    draftsFlushedSchema,
    migrationRunSchema,
    noPayloadSchema,
    openAtSchema,
    searchSchema
} from '@shared/validation'
import { AppError } from '../application/errors'
import { search } from '../library'
import type { IpcContext } from './context'

/** Library: list, backups, search, migration, drafts (ADR-003). */
export function registerLibraryHandlers(ctx: IpcContext): void {
    const { handle, controller, settings, library, sync, shared, backups } = ctx
    handle(IPC.libraryList, noPayloadSchema, () => library.listItems(settings.get().participantId))
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
        const folder = await shared?.ui.pickFolder(entry?.win, texts().backup.folderTitle)
        if (!folder) return null
        // FR-209: once, a warning that a cloud folder stores the messages readable for the provider
        if (await settings.takeBackupFolderWarning()) {
            const ok = await shared!.ui.confirm(entry?.win, {
                title: texts().backup.cloudWarningTitle,
                message: texts().backup.cloudWarning,
                yes: texts().backup.cloudContinue,
                no: texts().backup.cloudCancel
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
            title: texts().backup.restoreTitle,
            message: texts().backup.restoreQuestion,
            detail: texts().backup.restoreDetail(
                new Intl.DateTimeFormat(locale(), { dateStyle: 'long', timeStyle: 'short' }).format(
                    new Date(chosen.createdAt)
                )
            ),
            yes: texts().backup.restoreConfirm,
            no: texts().backup.restoreCancel
        })
        if (!ok) return false
        await backups().scheduleRestore(chosen.path)
        setTimeout(() => shared?.relaunch?.(), 100)
        return true
    })
    handle(IPC.searchDiscussion, searchSchema, async (entry, p) => {
        const session = entry?.session
        if (!session) return []
        await session.flush() // the newest messages are in the index
        return search(library.lib.db, p.query, { discussionId: session.documentId })
    })
    handle(IPC.searchAll, searchSchema, (_entry, p) => search(library.lib.db, p.query))
    handle(IPC.documentOpenAt, openAtSchema, (entry, p) =>
        controller.openAt(entry, p.id, p.threadId, p.messageId)
    )
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
    handle(IPC.draftSave, draftSaveSchema, async (entry, p) => {
        await controller.saveDraft(entry, p.threadId, p.content ?? null, p.attachments ?? [])
        return null
    })

    handle(IPC.draftsGet, noPayloadSchema, (entry) => controller.drafts(entry))
    handle(IPC.draftsFlushed, draftsFlushedSchema, (_entry, p) => {
        controller.draftsFlushed(p.token)
        return null
    })
}
