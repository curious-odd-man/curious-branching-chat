import { app, dialog, type BrowserWindow, type MessageBoxOptions } from 'electron'
import { join } from 'node:path'
import { ru } from '@shared/i18n/ru'

export interface CloseProblems {
    unsentDraft: boolean
    saveFailed: boolean
}

/** Everything the controller needs to ask the user. Kept behind an interface so tests can replace it. */
export interface Ui {
    /** The local path of the shared folder (design 12.3, step 5), or another folder with its own title. */
    pickFolder(parent: BrowserWindow | undefined, title?: string): Promise<string | null>
    /** A yes/no question; resolves true for yes (the first button). */
    confirm(
        parent: BrowserWindow | undefined,
        q: { title: string; message: string; detail?: string; yes: string; no: string }
    ): Promise<boolean>
    /** A `.bckey` file of another person (D-21). */
    pickKeyFile(parent: BrowserWindow | undefined): Promise<string | null>
    pickOpenPath(parent: BrowserWindow | undefined): Promise<string | null>
    /** Lets the person choose an image file (FR-067). */
    pickImagePath(parent: BrowserWindow | undefined): Promise<string | null>
    showError(
        parent: BrowserWindow | undefined,
        title: string,
        message: string,
        detail?: string
    ): Promise<void>
    /** Asks once whether .branchchat files should open in BranchChat (FR-136). Resolves true for yes. */
    confirmAssociation(parent: BrowserWindow | undefined): Promise<boolean>
    /** Resolves true if the user chose to close anyway. */
    confirmClose(parent: BrowserWindow | undefined, problems: CloseProblems): Promise<boolean>
    /** "Экспортировать…": where to save the file (FR-204). */
    pickCopyPath(parent: BrowserWindow | undefined, defaultName: string): Promise<string | null>
}

const filters = [{ name: ru.dialogs.fileFilter, extensions: ['branchchat'] }]

async function messageBox(parent: BrowserWindow | undefined, options: MessageBoxOptions) {
    return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options)
}

export const electronUi: Ui = {
    async pickOpenPath(parent) {
        const options = {
            title: ru.dialogs.openTitle,
            defaultPath: app.getPath('documents'),
            properties: ['openFile' as const],
            filters
        }
        const result = parent
            ? await dialog.showOpenDialog(parent, options)
            : await dialog.showOpenDialog(options)
        return result.canceled || result.filePaths.length === 0
            ? null
            : (result.filePaths[0] ?? null)
    },

    async confirm(parent, q) {
        const result = await messageBox(parent, {
            type: 'warning',
            title: q.title,
            message: q.message,
            ...(q.detail ? { detail: q.detail } : {}),
            buttons: [q.yes, q.no],
            defaultId: 0,
            cancelId: 1,
            noLink: true
        })
        return result.response === 0
    },

    async pickFolder(parent, title) {
        const options = {
            title: title ?? ru.shared.folderTitle,
            properties: ['openDirectory' as const, 'createDirectory' as const]
        }
        const result = parent
            ? await dialog.showOpenDialog(parent, options)
            : await dialog.showOpenDialog(options)
        return result.canceled || result.filePaths.length === 0
            ? null
            : (result.filePaths[0] ?? null)
    },

    async pickKeyFile(parent) {
        const options = {
            title: ru.shared.keyFileTitle,
            defaultPath: app.getPath('downloads'),
            properties: ['openFile' as const],
            filters: [{ name: ru.identity.fileFilter, extensions: ['bckey'] }]
        }
        const result = parent
            ? await dialog.showOpenDialog(parent, options)
            : await dialog.showOpenDialog(options)
        return result.canceled || result.filePaths.length === 0
            ? null
            : (result.filePaths[0] ?? null)
    },

    async pickImagePath(parent) {
        const options = {
            title: ru.images.pickTitle,
            defaultPath: app.getPath('pictures'),
            properties: ['openFile' as const],
            filters: [
                { name: ru.images.pickFilter, extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }
            ]
        }
        const result = parent
            ? await dialog.showOpenDialog(parent, options)
            : await dialog.showOpenDialog(options)
        return result.canceled || result.filePaths.length === 0
            ? null
            : (result.filePaths[0] ?? null)
    },

    async showError(parent, title, message, detail) {
        await messageBox(parent, {
            type: 'error',
            title,
            message: title,
            detail: detail ? `${message}\n\n${detail}` : message,
            buttons: ['OK'],
            noLink: true
        })
    },

    async confirmAssociation(parent) {
        const result = await messageBox(parent, {
            type: 'question',
            title: ru.association.askTitle,
            message: ru.association.askTitle,
            detail: ru.association.askText,
            buttons: [ru.association.askYes, ru.association.askNo],
            defaultId: 0,
            cancelId: 1,
            noLink: true
        })
        return result.response === 0
    },

    async pickCopyPath(parent, defaultName) {
        const options = {
            title: ru.dialogs.exportTitle,
            message: ru.dialogs.exportHint,
            defaultPath: join(app.getPath('documents'), defaultName),
            filters
        }
        const result = parent
            ? await dialog.showSaveDialog(parent, options)
            : await dialog.showSaveDialog(options)
        return result.canceled || !result.filePath ? null : result.filePath
    },

    async confirmClose(parent, problems) {
        const lines: string[] = []
        if (problems.unsentDraft) lines.push(ru.dialogs.closeUnsentDraft)
        if (problems.saveFailed) lines.push(ru.dialogs.closeSaveFailed)
        const result = await messageBox(parent, {
            type: 'warning',
            title: ru.dialogs.closeTitle,
            message: ru.dialogs.closeTitle,
            detail: lines.join('\n\n'),
            buttons: [ru.dialogs.closeConfirm, ru.dialogs.closeCancel],
            defaultId: 1,
            cancelId: 1,
            noLink: true
        })
        return result.response === 0
    }
}
