import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { writeFileAtomically } from '../document/atomicWrite'

/**
 * Synchronized discussions on this computer (design section 18): which local `.branchchat` file and which shared
 * folder belong to each conversation. A file with a roster that is not listed here is a detached copy (FR-154).
 */
const entrySchema = z
    .object({
        conversationId: z.string().min(1),
        filePath: z.string().min(1),
        sharedRoot: z.string().min(1),
        ownId: z.string().min(1)
    })
    .passthrough()
export type RegistryEntry = z.infer<typeof entrySchema>

const fileSchema = z.object({ version: z.literal(1), entries: z.array(entrySchema) }).passthrough()

export class SyncRegistry {
    private entries: RegistryEntry[] = []
    private listeners: Array<() => void> = []

    constructor(private readonly dir: string) {}

    private get path(): string {
        return join(this.dir, 'registry.json')
    }

    async load(): Promise<void> {
        try {
            const parsed = fileSchema.safeParse(JSON.parse(await fs.readFile(this.path, 'utf8')))
            this.entries = parsed.success ? parsed.data.entries : []
        } catch {
            this.entries = []
        }
    }

    list(): RegistryEntry[] {
        return [...this.entries]
    }

    get(conversationId: string): RegistryEntry | undefined {
        return this.entries.find((e) => e.conversationId === conversationId)
    }

    onChange(listener: () => void): void {
        this.listeners.push(listener)
    }

    async put(entry: RegistryEntry): Promise<void> {
        this.entries = [
            ...this.entries.filter((e) => e.conversationId !== entry.conversationId),
            entry
        ]
        await this.persist()
    }

    /** The registered file was moved or renamed (FR-168). */
    async updatePath(conversationId: string, filePath: string): Promise<void> {
        const entry = this.get(conversationId)
        if (!entry) return
        await this.put({ ...entry, filePath })
    }

    private async persist(): Promise<void> {
        await fs.mkdir(this.dir, { recursive: true })
        const text = JSON.stringify({ version: 1, entries: this.entries }, null, 2)
        await writeFileAtomically(this.path, (tmp) => fs.writeFile(tmp, text, 'utf8'))
        for (const l of this.listeners) l()
    }
}
