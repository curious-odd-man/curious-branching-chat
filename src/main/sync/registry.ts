import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { StateFileWriter } from '../document/atomicWrite'

/**
 * Synchronized discussions on this computer (design section 18): which shared folder belongs to each conversation.
 * The discussion itself is in the library (ADR-003) under the conversation ID. `filePath` is the local file of
 * release 1.5 and older; it is kept only for the migration of that file into the library (FR-206).
 */
const entrySchema = z
    .object({
        conversationId: z.string().min(1),
        filePath: z.string().min(1).optional(),
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

    private readonly writer = new StateFileWriter(() => this.path)

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

    async remove(conversationId: string): Promise<void> {
        this.entries = this.entries.filter((e) => e.conversationId !== conversationId)
        await this.persist()
    }

    private async persist(): Promise<void> {
        await fs.mkdir(this.dir, { recursive: true })
        await this.writer.write(() =>
            JSON.stringify({ version: 1, entries: this.entries }, null, 2)
        )
        for (const l of this.listeners) l()
    }
}
