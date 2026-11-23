import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { BackgroundFlag, SettingsView, SidebarSettings } from '@shared/types/ipc'
import { clampTextSize, TEXT_SIZE_DEFAULT } from '@shared/shortcuts'
import { ATTACHMENT_LIMIT_MB, FILE_SIZE_LIMIT_MB } from '@shared/sync'
import { StateFileWriter } from '../document/atomicWrite'
import { isLanguage, type Language } from '@shared/i18n'

const settingsSchema = z
    .object({
        participantId: z.string().min(1),
        displayName: z.string().min(1).optional(),
        /** The person has seen that read status is stored in the file and visible to others (FR-125). */
        readNoticeAcknowledged: z.boolean().optional(),
        /** The question about the .branchchat file association has been settled (FR-136). */
        associationAsked: z.boolean().optional(),
        /** Background update checks (FR-097); on unless the person turned them off. */
        autoUpdateCheck: z.boolean().optional(),
        /** Number of recent files kept; 0 = no list. */
        recentFilesLimit: z.number().int().nonnegative().optional(),
        openLastFileOnStartup: z.boolean().optional(),
        /** Largest file read from a shared folder, in MB (FR-166). */
        fileSizeLimitMb: z.number().int().optional(),
        notifyNewMessages: z.boolean().optional(),
        notifyShowText: z.boolean().optional(),
        startWithWindows: z.boolean().optional(),
        /** FR-174: the automatic switch-on of "start with Windows" has happened (it happens only once). */
        startWithWindowsSettled: z.boolean().optional(),
        /** FR-173: the one-time notice about the tray was shown. */
        trayNoticeShown: z.boolean().optional(),
        /** FR-301: text size of all windows, in percent. */
        textSize: z.number().optional(),
        /** FR-222, FR-223: the discussion list of the windows. */
        sidebar: z
            .object({
                /** Earlier name of `collapsed` (the list could only be hidden then). */
                hidden: z.boolean().optional(),
                /** The list shows small icons only. */
                collapsed: z.boolean().optional(),
                width: z.number().optional(),
                sort: z.enum(['activity', 'name']).optional()
            })
            .optional(),
        /** FR-207: the folder for backups that the person chose (null or absent: only the app folder). */
        backupFolder: z.string().min(1).nullable().optional(),
        /** FR-209: the one-time warning about backups in a cloud folder was shown. */
        backupFolderWarned: z.boolean().optional(),
        /** FR-265: the largest file that can be attached, in MB. */
        attachmentLimitMb: z.number().int().optional(),
        /** FR-292: the language of the interface; absent: Russian. */
        language: z.string().optional(),
        /** Archived discussions: shown at the end of the list only (they keep their data and sync). */
        archived: z.array(z.string().min(1)).optional()
    })
    .passthrough()
type Settings = z.infer<typeof settingsSchema>

const DEFAULT_RECENT_FILES_LIMIT = 10

function clampLimit(mb: number | undefined): number {
    if (mb === undefined || !Number.isInteger(mb)) return FILE_SIZE_LIMIT_MB.default
    return Math.min(FILE_SIZE_LIMIT_MB.max, Math.max(FILE_SIZE_LIMIT_MB.min, mb))
}

function clampAttachmentLimit(mb: number | undefined): number {
    if (mb === undefined || !Number.isInteger(mb)) return ATTACHMENT_LIMIT_MB.default
    return Math.min(ATTACHMENT_LIMIT_MB.max, Math.max(ATTACHMENT_LIMIT_MB.min, mb))
}

/**
 * Local, per-Windows-user settings (NFR-017): the participant ID (generated once, FR-020) and display name (FR-017).
 * Stored in the user's application data folder, never next to the executable and never in discussion files.
 */
export class SettingsStore {
    private data: Settings | null = null

    constructor(
        private readonly dir: string,
        private readonly newId: () => string
    ) {}

    private readonly writer = new StateFileWriter(() => this.file)

    private get file(): string {
        return join(this.dir, 'settings.json')
    }

    async load(): Promise<void> {
        await fs.mkdir(this.dir, { recursive: true })
        let raw: string | null = null
        try {
            raw = await fs.readFile(this.file, 'utf8')
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
        }
        if (raw !== null) {
            try {
                this.data = settingsSchema.parse(JSON.parse(raw.replace(/^\uFEFF/, '')))
                return
            } catch {
                // Unreadable settings: keep a copy for inspection and start fresh (this person becomes a new participant).
                await fs
                    .rename(this.file, `${this.file}.corrupt-${Date.now()}`)
                    .catch(() => undefined)
            }
        }
        this.data = { participantId: this.newId() }
        await this.persist()
    }

    get(): SettingsView {
        if (!this.data) throw new Error('SettingsStore.load() has not been called')
        return {
            participantId: this.data.participantId,
            displayName: this.data.displayName ?? null,
            readNoticeAcknowledged: this.data.readNoticeAcknowledged ?? false,
            associationAsked: this.data.associationAsked ?? false,
            autoUpdateCheck: this.data.autoUpdateCheck ?? true,
            recentFilesLimit: this.data.recentFilesLimit ?? DEFAULT_RECENT_FILES_LIMIT,
            openLastFileOnStartup: this.data.openLastFileOnStartup ?? true,
            fileSizeLimitMb: clampLimit(this.data.fileSizeLimitMb),
            notifyNewMessages: this.data.notifyNewMessages ?? true,
            notifyShowText: this.data.notifyShowText ?? true,
            startWithWindows: this.data.startWithWindows ?? false,
            startWithWindowsSettled: this.data.startWithWindowsSettled ?? false,
            textSize: clampTextSize(this.data.textSize ?? TEXT_SIZE_DEFAULT),
            backupFolder: this.data.backupFolder ?? null,
            attachmentLimitMb: clampAttachmentLimit(this.data.attachmentLimitMb),
            language: isLanguage(this.data.language) ? this.data.language : 'ru',
            archived: [...(this.data.archived ?? [])],
            sidebar: {
                collapsed: this.data.sidebar?.collapsed ?? this.data.sidebar?.hidden ?? false,
                width: Math.min(480, Math.max(180, Math.round(this.data.sidebar?.width ?? 260))),
                sort: this.data.sidebar?.sort ?? 'activity'
            }
        }
    }

    /** FR-222, FR-223: the discussion list (collapsed, width, sort). */
    async setSidebar(change: Partial<SidebarSettings>): Promise<SettingsView> {
        if (!this.data) throw new Error('SettingsStore.load() has not been called')
        this.data = { ...this.data, sidebar: { ...this.get().sidebar, ...change } }
        await this.persist()
        return this.get()
    }

    /** Archives a discussion, or takes it out of the archive. */
    async setArchived(id: string, archived: boolean): Promise<SettingsView> {
        if (!this.data) throw new Error('SettingsStore.load() has not been called')
        const rest = (this.data.archived ?? []).filter((x) => x !== id)
        this.data = { ...this.data, archived: archived ? [...rest, id] : rest }
        await this.persist()
        return this.get()
    }

    /** FR-207: the folder for backups (null: only %APPDATA%\BranchChat\backups). */
    async setBackupFolder(folder: string | null): Promise<SettingsView> {
        if (!this.data) throw new Error('SettingsStore.load() has not been called')
        this.data = { ...this.data, backupFolder: folder }
        await this.persist()
        return this.get()
    }

    /** FR-209: true the first time only (then the warning about cloud folders is shown). */
    async takeBackupFolderWarning(): Promise<boolean> {
        if (!this.data) throw new Error('SettingsStore.load() has not been called')
        if (this.data.backupFolderWarned) return false
        this.data = { ...this.data, backupFolderWarned: true }
        await this.persist()
        return true
    }

    async setDisplayName(name: string): Promise<SettingsView> {
        if (!this.data) throw new Error('SettingsStore.load() has not been called')
        const trimmed = name.trim()
        if (trimmed.length === 0) throw new Error('display name must not be empty')
        this.data = { ...this.data, displayName: trimmed }
        await this.persist()
        return this.get()
    }

    async acknowledgeReadNotice(): Promise<SettingsView> {
        if (!this.data) throw new Error('SettingsStore.load() has not been called')
        this.data = { ...this.data, readNoticeAcknowledged: true }
        await this.persist()
        return this.get()
    }

    async markAssociationAsked(): Promise<SettingsView> {
        if (!this.data) throw new Error('SettingsStore.load() has not been called')
        if (this.data.associationAsked) return this.get()
        this.data = { ...this.data, associationAsked: true }
        await this.persist()
        return this.get()
    }

    async setAutoUpdateCheck(enabled: boolean): Promise<SettingsView> {
        if (!this.data) throw new Error('SettingsStore.load() has not been called')
        this.data = { ...this.data, autoUpdateCheck: enabled }
        await this.persist()
        return this.get()
    }

    async setRecentFilesLimit(limit: number): Promise<SettingsView> {
        if (!this.data) throw new Error('SettingsStore.load() has not been called')
        if (!Number.isInteger(limit) || limit < 0) throw new Error('invalid recent files limit')
        this.data = { ...this.data, recentFilesLimit: limit }
        await this.persist()
        return this.get()
    }

    async setOpenLastFileOnStartup(enabled: boolean): Promise<SettingsView> {
        if (!this.data) throw new Error('SettingsStore.load() has not been called')
        this.data = { ...this.data, openLastFileOnStartup: enabled }
        await this.persist()
        return this.get()
    }

    /** FR-166: 5 MB to 1 000 MB; other values are refused. */
    async setFileSizeLimit(mb: number): Promise<SettingsView> {
        if (!this.data) throw new Error('SettingsStore.load() has not been called')
        if (!Number.isInteger(mb) || mb < FILE_SIZE_LIMIT_MB.min || mb > FILE_SIZE_LIMIT_MB.max)
            throw new Error('invalid file size limit')
        this.data = { ...this.data, fileSizeLimitMb: mb }
        await this.persist()
        return this.get()
    }

    /** FR-292: applies after a restart (FR-293). */
    async setLanguage(language: Language): Promise<SettingsView> {
        if (!this.data) throw new Error('SettingsStore.load() has not been called')
        if (!isLanguage(language)) throw new Error('unknown language')
        this.data = { ...this.data, language }
        await this.persist()
        return this.get()
    }

    /** FR-265: 1 MB to 1 000 MB; other values are refused. */
    async setAttachmentLimit(mb: number): Promise<SettingsView> {
        if (!this.data) throw new Error('SettingsStore.load() has not been called')
        if (!Number.isInteger(mb) || mb < ATTACHMENT_LIMIT_MB.min || mb > ATTACHMENT_LIMIT_MB.max)
            throw new Error('invalid attachment limit')
        this.data = { ...this.data, attachmentLimitMb: mb }
        await this.persist()
        return this.get()
    }

    async setFlag(flag: BackgroundFlag, enabled: boolean): Promise<SettingsView> {
        if (!this.data) throw new Error('SettingsStore.load() has not been called')
        this.data = {
            ...this.data,
            [flag]: enabled,
            // a choice of the person settles the automatic switch-on (FR-174)
            ...(flag === 'startWithWindows' ? { startWithWindowsSettled: true } : {})
        }
        await this.persist()
        return this.get()
    }

    /** FR-301, FR-302: the text size of all windows (80–200 %, steps of 10). */
    async setTextSize(percent: number): Promise<SettingsView> {
        if (!this.data) throw new Error('SettingsStore.load() has not been called')
        this.data = { ...this.data, textSize: clampTextSize(percent) }
        await this.persist()
        return this.get()
    }

    /** D-32: a re-invitation after key loss gives this person the old participant ID back. */
    async setParticipantId(participantId: string): Promise<SettingsView> {
        if (!this.data) throw new Error('SettingsStore.load() has not been called')
        if (participantId.trim().length === 0) throw new Error('participant ID must not be empty')
        this.data = { ...this.data, participantId }
        await this.persist()
        return this.get()
    }

    /** FR-174: the first synchronized discussion turns "start with Windows" on, once. True if it did. */
    async settleStartWithWindows(): Promise<boolean> {
        if (!this.data) throw new Error('SettingsStore.load() has not been called')
        if (this.data.startWithWindowsSettled) return false
        this.data = { ...this.data, startWithWindows: true, startWithWindowsSettled: true }
        await this.persist()
        return true
    }

    /** FR-173: true the first time only. */
    async takeTrayNotice(): Promise<boolean> {
        if (!this.data) throw new Error('SettingsStore.load() has not been called')
        if (this.data.trayNoticeShown) return false
        this.data = { ...this.data, trayNoticeShown: true }
        await this.persist()
        return true
    }

    private async persist(): Promise<void> {
        await this.writer.write(() => JSON.stringify(this.data, null, 2))
    }
}
