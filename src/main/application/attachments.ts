import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { extensionOf, isRiskyAttachment, safeAttachmentName } from '@shared/domain'
import { texts } from '@shared/i18n'
import type { AttachResult } from '@shared/types/ipc'
import { MAX_ATTACHMENTS_PER_MESSAGE, type Attachment, type Message } from '@shared/validation'
import type { LibraryService } from '../library'
import { AppError } from './errors'
import type { Ui } from './ui'

/**
 * File attachments in the main process (FR-261 to FR-267): files are stored in the library when they are attached
 * (so a draft keeps them), saved or opened as copies with the Mark of the Web, never opened by themselves (FR-264).
 */
export interface AttachmentDeps {
    library: LibraryService
    ui: Ui
    /** FR-265, in MB. */
    limitMb: () => number
    /** The folder for opened copies (`%TEMP%\BranchChat\open`). */
    openDir: string
    /** Lets Windows open a file with its program (`shell.openPath`); returns an error text or ''. */
    openPath: (path: string) => Promise<string>
    platform: NodeJS.Platform
    log?: (message: string) => void
}

const TYPES: Record<string, string> = {
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
    xml: 'application/xml',
    zip: 'application/zip',
    '7z': 'application/x-7z-compressed',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    docm: 'application/vnd.ms-word.document.macroEnabled.12',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    odt: 'application/vnd.oasis.opendocument.text',
    ods: 'application/vnd.oasis.opendocument.spreadsheet',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    mp4: 'video/mp4',
    mov: 'video/quicktime'
}

export function typeOf(name: string): string {
    return TYPES[extensionOf(name)] ?? ''
}

/** FR-263: the Windows "downloaded from the internet" mark (an NTFS stream); elsewhere nothing. */
export async function markFromInternet(file: string, platform: NodeJS.Platform): Promise<boolean> {
    if (platform !== 'win32') return false
    try {
        await fs.writeFile(`${file}:Zone.Identifier`, '[ZoneTransfer]\r\nZoneId=3\r\n')
        return true
    } catch {
        return false // not NTFS (a USB stick with FAT32): Windows cannot keep the mark
    }
}

export class AttachmentService {
    constructor(private readonly deps: AttachmentDeps) {}

    private get limitBytes(): number {
        return this.deps.limitMb() * 1024 * 1024
    }

    /** FR-261, FR-265: stores files from disk for a draft; a file above the limit is refused (with its name). */
    async addPaths(paths: readonly string[]): Promise<AttachResult> {
        const result: AttachResult = { added: [], refused: [], limitMb: this.deps.limitMb() }
        for (const [i, path] of paths.entries()) {
            const name = safeAttachmentName(basename(path))
            if (i >= MAX_ATTACHMENTS_PER_MESSAGE) {
                result.refused.push({ name, reason: 'too-many' })
                continue
            }
            const stat = await fs.stat(path).catch(() => null)
            if (!stat?.isFile()) {
                result.refused.push({ name, reason: 'unreadable' })
                continue
            }
            if (stat.size > this.limitBytes) {
                result.refused.push({ name, reason: 'too-large' })
                continue
            }
            try {
                const { sha256, size } = await this.deps.library.storeBlobFile(
                    path,
                    typeOf(name),
                    this.limitBytes
                )
                result.added.push({ name, size, type: typeOf(name), sha256 })
            } catch (err) {
                const code = (err as { code?: string }).code
                result.refused.push({
                    name,
                    reason: code === 'TOO_LARGE' ? 'too-large' : 'unreadable'
                })
            }
        }
        return result
    }

    /** A pasted file without a path. */
    async addBytes(rawName: string, type: string, data: Uint8Array): Promise<AttachResult> {
        const name = safeAttachmentName(rawName)
        const result: AttachResult = { added: [], refused: [], limitMb: this.deps.limitMb() }
        if (data.length > this.limitBytes) {
            result.refused.push({ name, reason: 'too-large' })
            return result
        }
        const sha256 = await this.deps.library.storeBlobBytes(data, type || typeOf(name))
        result.added.push({ name, size: data.length, type: type || typeOf(name), sha256 })
        return result
    }

    async pick(parent: BrowserWindow | undefined): Promise<AttachResult> {
        const paths = await this.deps.ui.pickAttachmentPaths(parent)
        if (paths.length === 0) return { added: [], refused: [], limitMb: this.deps.limitMb() }
        return this.addPaths(paths)
    }

    private source(a: Attachment): string {
        const file = this.deps.library.blobFile(a.sha256)
        if (!file)
            throw new AppError('ATTACHMENT_MISSING', 'The bytes of the attachment are missing')
        return file
    }

    /** FR-262: "Сохранить как…": a copy with the mark of the web. */
    async saveAs(parent: BrowserWindow | undefined, a: Attachment): Promise<boolean> {
        const source = this.source(a)
        const target = await this.deps.ui.pickAttachmentSavePath(parent, safeAttachmentName(a.name))
        if (!target) return false
        try {
            await fs.copyFile(source, target)
        } catch {
            throw new AppError('ATTACHMENT_SAVE_FAILED', 'Cannot save the attachment')
        }
        await markFromInternet(target, this.deps.platform)
        return true
    }

    /**
     * FR-262, FR-267: "Открыть": for a type that can run code, a warning with the type and the author first; then a
     * copy in a new folder of the temporary folder, with the mark of the web, opened by Windows.
     */
    async open(
        parent: BrowserWindow | undefined,
        a: Attachment,
        message: Message
    ): Promise<boolean> {
        const source = this.source(a)
        const name = safeAttachmentName(a.name)
        if (isRiskyAttachment(name)) {
            const yes = await this.deps.ui.confirm(parent, {
                title: texts().attachments.warnTitle,
                message: texts().attachments.warnMessage(name, extensionOf(name)),
                detail: texts().attachments.warnDetail(message.authorDisplayName),
                yes: texts().attachments.warnOpen,
                no: texts().attachments.warnCancel
            })
            if (!yes) return false
        }
        const dir = join(this.deps.openDir, randomUUID())
        const target = join(dir, name)
        try {
            await fs.mkdir(dir, { recursive: true })
            await fs.copyFile(source, target)
        } catch {
            throw new AppError('ATTACHMENT_OPEN_FAILED', 'Cannot copy the attachment')
        }
        await markFromInternet(target, this.deps.platform)
        const error = await this.deps.openPath(target)
        if (error) {
            this.deps.log?.(`open of an attachment failed: ${error}`)
            throw new AppError('ATTACHMENT_OPEN_FAILED', 'Windows could not open the file')
        }
        return true
    }

    /** Opened copies older than a week are removed at start (a program may still hold a newer one). */
    async cleanOpenDir(now = Date.now()): Promise<void> {
        for (const name of await fs.readdir(this.deps.openDir).catch(() => [] as string[])) {
            const dir = join(this.deps.openDir, name)
            const stat = await fs.stat(dir).catch(() => null)
            if (stat && now - stat.mtimeMs > 7 * 24 * 60 * 60_000)
                await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
        }
    }
}

/** The attachment `index` of a message of the discussion (the window names it by position). */
export function findAttachment(
    threads: ReadonlyArray<{ messages: readonly Message[] }>,
    messageId: string,
    index: number
): { message: Message; attachment: Attachment } {
    for (const t of threads) {
        const message = t.messages.find((m) => m.messageId === messageId)
        if (!message) continue
        const attachment = message.attachments?.[index]
        if (attachment) return { message, attachment }
    }
    throw new AppError('ATTACHMENT_NOT_FOUND', 'No such attachment')
}
