import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { writeFileAtomically } from '../document/atomicWrite'
import { pathKey } from '../application/paths'

const fileSchema = z
  .object({
    version: z.literal(1),
    files: z.array(z.object({ path: z.string().min(1), openedAt: z.string() }))
  })
  .passthrough()

export interface RecentEntry {
  path: string
  openedAt: string
}

/**
 * The list of recently opened discussions, most recent first. Local to this Windows user (like the settings): it is
 * never stored in a discussion file. A file that is missing or unreadable simply means an empty list.
 */
export class RecentFilesStore {
  private entries: RecentEntry[] = []
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly dir: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  private get file(): string {
    return join(this.dir, 'recent.json')
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.file, 'utf8')
      this.entries = fileSchema.parse(
        JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw)
      ).files
    } catch {
      this.entries = []
    }
  }

  list(): readonly RecentEntry[] {
    return this.entries
  }

  /** Called after every change (used to refresh windows, the menu and the jump list). */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Moves the file to the top; the list is cut to `limit` entries (0 keeps nothing). */
  async add(path: string, limit: number): Promise<void> {
    const key = pathKey(path)
    const rest = this.entries.filter((e) => pathKey(e.path) !== key)
    this.entries = [{ path, openedAt: this.now().toISOString() }, ...rest].slice(0, limit)
    await this.commit()
  }

  async remove(path: string): Promise<void> {
    const key = pathKey(path)
    const next = this.entries.filter((e) => pathKey(e.path) !== key)
    if (next.length === this.entries.length) return
    this.entries = next
    await this.commit()
  }

  async clear(): Promise<void> {
    if (this.entries.length === 0) return
    this.entries = []
    await this.commit()
  }

  /** Forgets the oldest entries beyond `limit` (the setting was lowered). */
  async trim(limit: number): Promise<void> {
    if (this.entries.length <= limit) return
    this.entries = this.entries.slice(0, limit)
    await this.commit()
  }

  private async commit(): Promise<void> {
    const text = JSON.stringify({ version: 1, files: this.entries }, null, 2)
    await fs.mkdir(this.dir, { recursive: true })
    await writeFileAtomically(this.file, (tmp) => fs.writeFile(tmp, text, 'utf8'))
    for (const listener of this.listeners) listener()
  }
}
