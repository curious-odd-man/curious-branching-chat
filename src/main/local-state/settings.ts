import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { SettingsView } from '@shared/types/ipc'
import { writeFileAtomically } from '../document/atomicWrite'

const settingsSchema = z
  .object({
    participantId: z.string().min(1),
    displayName: z.string().min(1).optional(),
    /** The person has seen that read status is stored in the file and visible to others (FR-125). */
    readNoticeAcknowledged: z.boolean().optional(),
    /** The question about the .branchchat file association has been settled (FR-136). */
    associationAsked: z.boolean().optional(),
    /** Background update checks (FR-097); on unless the person turned them off. */
    autoUpdateCheck: z.boolean().optional()
  })
  .passthrough()
type Settings = z.infer<typeof settingsSchema>

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
        await fs.rename(this.file, `${this.file}.corrupt-${Date.now()}`).catch(() => undefined)
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
      autoUpdateCheck: this.data.autoUpdateCheck ?? true
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

  private async persist(): Promise<void> {
    const text = JSON.stringify(this.data, null, 2)
    await writeFileAtomically(this.file, (tmp) => fs.writeFile(tmp, text, 'utf8'))
  }
}
