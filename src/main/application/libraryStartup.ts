import { join } from 'node:path'
import { ru } from '@shared/i18n/ru'
import {
    APP_BACKUP_DIR,
    BackupService,
    BlobStore,
    FOLDER_BACKUP_DIR,
    LibraryRepository,
    applyPendingRestore,
    checkLibrary,
    newestBackup,
    openLibrary,
    replaceDamagedLibrary,
    type Library
} from '../library'
import { LibraryError } from '../library/schema'

export interface LibraryStartupDeps {
    /** %APPDATA%\BranchChat */
    appDir: string
    /** The backup folder of the person (Settings), or null. */
    folder: () => string | null
    appVersion: string
    /** Shows a question; resolves with the index of the chosen button. */
    ask: (message: string, detail: string, buttons: string[]) => Promise<number>
    log: { info(m: string): void; warn(m: string): void; error(m: string, e?: unknown): void }
    formatDate: (iso: string) => string
}

/**
 * Opens the library at start (FR-207, FR-208): a restore that the person asked for comes first; a backup is made
 * before a change of the library schema; a damaged library is never deleted: the person chooses the newest backup or
 * an empty library, and the damaged file is kept next to it. Resolves null when the app must quit.
 */
export async function startLibrary(deps: LibraryStartupDeps): Promise<Library | null> {
    if (await applyPendingRestore(deps.appDir, (m) => deps.log.info(m)))
        deps.log.info('the library was restored from a backup')

    const open = (): Promise<Library> =>
        openLibrary(deps.appDir, {
            beforeMigration: async (db, from) => {
                deps.log.info(`library schema ${from}: backup before the migration`)
                const blobs = new BlobStore(join(deps.appDir, 'blobs'))
                const lib = {
                    dir: deps.appDir,
                    db,
                    blobs,
                    repo: new LibraryRepository(db, blobs),
                    close: () => undefined
                }
                await new BackupService(lib, {
                    appDir: deps.appDir,
                    folder: deps.folder,
                    appVersion: deps.appVersion
                }).make('migration')
            }
        })

    let problem: unknown
    try {
        const lib = await open()
        const check = await checkLibrary(lib)
        if (check.ok) {
            if (check.missingImages > 0)
                deps.log.warn(`${check.missingImages} image files of the library are missing`)
            return lib
        }
        lib.close()
        problem = new Error(check.problems.slice(0, 5).join('; '))
    } catch (err) {
        if (err instanceof LibraryError && err.code === 'NEWER_LIBRARY') {
            await deps.ask(ru.errors['NEWER_LIBRARY']!, '', [ru.library.quit])
            return null
        }
        problem = err
    }

    deps.log.error('the library is damaged', problem)
    const roots = [join(deps.appDir, APP_BACKUP_DIR)]
    const folder = deps.folder()
    if (folder) roots.push(join(folder, FOLDER_BACKUP_DIR))
    const backup = await newestBackup(roots)
    const buttons = backup
        ? [ru.library.restoreLast, ru.library.startEmpty, ru.library.quit]
        : [ru.library.startEmpty, ru.library.quit]
    const choice = await deps.ask(
        ru.library.damaged,
        backup
            ? ru.library.damagedWithBackup(deps.formatDate(backup.createdAt))
            : ru.library.damagedNoBackup,
        buttons
    )
    const action = buttons[choice]
    if (action !== ru.library.restoreLast && action !== ru.library.startEmpty) return null
    const kept = await replaceDamagedLibrary(
        deps.appDir,
        action === ru.library.restoreLast ? backup!.path : null
    )
    deps.log.info(`the damaged library was kept as ${kept}`)
    try {
        const lib = await open()
        if ((await checkLibrary(lib)).ok) return lib
        lib.close()
    } catch (err) {
        deps.log.error('the library cannot be opened after the replacement', err)
    }
    await deps.ask(ru.library.openFailed, '', [ru.library.quit])
    return null
}
