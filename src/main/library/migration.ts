import { promises as fs } from 'node:fs'
import { basename } from 'node:path'
import type { MigrationCandidate, MigrationResult } from '@shared/types/ipc'
import { pathKey } from '../application/paths'
import { DocumentError } from '../document'
import type { RecentEntry } from '../local-state/recentFiles'
import type { RegistryEntry } from '../sync/registry'
import type { LibraryService } from './library'
import { LibraryError } from './schema'

const DONE_KEY = 'migration_1x'

export interface MigrationDeps {
    library: LibraryService
    /** The recent files list of release 1.5 and older (read only). */
    recent: () => readonly RecentEntry[]
    /** The sync registry; entries of release 1.5 and older have the path of the local file. */
    registry: () => readonly RegistryEntry[]
    /** The participant ID of this computer: a registered file of another identity is imported as a normal one. */
    ownId: () => string
    log?: (message: string) => void
}

/**
 * FR-206: at the first start of release 2.2, the files of the recent list and the sync registry are offered for the
 * library, all selected. The files are only read: they are never changed or deleted. A synchronized discussion keeps
 * its conversation ID, member list, keys, sync state, outbox, and shared folder (the registry entry and
 * `sync\<id>\` stay as they are).
 */
export class Migration {
    constructor(private readonly deps: MigrationDeps) {}

    get done(): boolean {
        return this.deps.library.repo.getMeta(DONE_KEY) !== null
    }

    /** The files to offer; empty when the question was answered before or there is nothing to offer. */
    async candidates(): Promise<MigrationCandidate[]> {
        if (this.done) return []
        const seen = new Map<string, MigrationCandidate>()
        const registered = new Set(
            this.deps
                .registry()
                .filter((e) => e.filePath)
                .map((e) => pathKey(e.filePath!))
        )
        const add = async (path: string): Promise<void> => {
            const key = pathKey(path)
            if (seen.has(key)) return
            seen.set(key, {
                path,
                name: basename(path).replace(/\.branchchat$/i, ''),
                exists: await fs
                    .stat(path)
                    .then((s) => s.isFile())
                    .catch(() => false),
                synced: registered.has(key)
            })
        }
        for (const e of this.deps.registry()) if (e.filePath) await add(e.filePath)
        for (const e of this.deps.recent()) await add(e.path)
        return [...seen.values()]
    }

    /** Imports the chosen files (synchronized ones first, so a plain copy cannot take their place). */
    async run(paths: readonly string[]): Promise<MigrationResult[]> {
        const ownId = this.deps.ownId()
        const registered = new Map(
            this.deps
                .registry()
                .filter((e) => e.filePath && e.ownId === ownId)
                .map((e) => [pathKey(e.filePath!), e])
        )
        const ordered = [...paths].sort(
            (a, b) => Number(registered.has(pathKey(b))) - Number(registered.has(pathKey(a)))
        )
        const results: MigrationResult[] = []
        for (const path of ordered) {
            const entry = registered.get(pathKey(path))
            const name = basename(path).replace(/\.branchchat$/i, '')
            try {
                const r = await this.deps.library.importFile(path, {
                    keepSync: entry !== undefined
                })
                if (entry && r.id !== entry.conversationId)
                    this.deps.log?.(`migration: ${path} is not the registered discussion`)
                results.push({
                    path,
                    name,
                    status: r.status === 'created' ? 'imported' : 'merged',
                    synced: entry !== undefined,
                    id: r.id
                })
                this.deps.log?.(`migration: ${path} → ${r.id} (${r.status})`)
            } catch (err) {
                const code =
                    err instanceof DocumentError || err instanceof LibraryError
                        ? err.code
                        : 'UNKNOWN'
                results.push({ path, name, status: 'failed', synced: false, errorCode: code })
                this.deps.log?.(`migration: ${path} failed (${code})`)
            }
        }
        this.finish()
        return results
    }

    /** "Не переносить": the question is not asked again (files can still be imported one by one). */
    skip(): void {
        this.deps.log?.('migration: skipped')
        this.finish()
    }

    private finish(): void {
        this.deps.library.repo.setMeta(DONE_KEY, new Date().toISOString())
    }
}
