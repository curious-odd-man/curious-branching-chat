import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { SettingsView } from '@shared/types/ipc'
import { FILE_SIZE_LIMIT_MB } from '@shared/sync'
import { StateFileWriter } from '../document/atomicWrite'

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
        fileSizeLimitMb: z.number().int().optional()
    })
    .passthrough()
type Settings = z.infer<typeof settingsSchema>

export const DEFAULT_RECENT_FILES_LIMIT = 10

function clampLimit(mb: number | undefined): number {
    if (mb === undefined || !Number.isInteger(mb)) return FILE_SIZE_LIMIT_MB.default
    return Math.min(FILE_SIZE_LIMIT_MB.max, Math.max(FILE_SIZE_LIMIT_MB.min, mb))
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
            fileSizeLimitMb: clampLimit(this.data.fileSizeLimitMb)
        }
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

    private async persist(): Promise<void> {
        await this.writer.write(() => JSON.stringify(this.data, null, 2))
    }
}
