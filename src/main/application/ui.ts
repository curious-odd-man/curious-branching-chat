import { app, dialog, type BrowserWindow, type MessageBoxOptions } from 'electron'
import { join } from 'node:path'
import { ru } from '@shared/i18n/ru'

export interface CloseProblems {
    unsentDraft: boolean
    saveFailed: boolean
}

/** Everything the controller needs to ask the user. Kept behind an interface so tests can replace it. */
export interface Ui {
    pickSavePath(parent: BrowserWindow | undefined): Promise<string | null>
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
}

const filters = [{ name: ru.dialogs.fileFilter, extensions: ['branchchat'] }]

async function messageBox(parent: BrowserWindow | undefined, options: MessageBoxOptions) {
    return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options)
}

export const electronUi: Ui = {
    async pickSavePath(parent) {
        const options = {
            title: ru.dialogs.saveTitle,
            defaultPath: join(app.getPath('documents'), `${ru.dialogs.defaultFileName}.branchchat`),
            filters
        }
        const result = parent
            ? await dialog.showSaveDialog(parent, options)
            : await dialog.showSaveDialog(options)
        return result.canceled || !result.filePath ? null : result.filePath
    },

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
