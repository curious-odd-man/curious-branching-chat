import { promises as fs } from 'node:fs'
import type { DocumentContents } from '@shared/validation'
import { readDocument, readImageAsset, writeDocument, type PreparedImage } from '../document'
import type { DocumentPort } from './conversationSync'

/**
 * A synchronized discussion that no window shows: the sync service reads and writes the file directly (design
 * section 10). The contents are cached while the file does not change.
 */
export class FilePort implements DocumentPort {
    private cache: { contents: DocumentContents; mtimeMs: number } | null = null
    private chain: Promise<unknown> = Promise.resolve()

    constructor(readonly path: string) {}

    private serial<T>(fn: () => Promise<T>): Promise<T> {
        const next = this.chain.then(fn, fn)
        this.chain = next.catch(() => undefined)
        return next
    }

    /** Resolves when no write is running (a window that opens the file waits for this). */
    idle(): Promise<void> {
        return this.serial(async () => undefined)
    }

    private async load(): Promise<DocumentContents> {
        const st = await fs.stat(this.path)
        if (this.cache && this.cache.mtimeMs === st.mtimeMs) return this.cache.contents
        const contents = (await readDocument(this.path)).contents
        this.cache = { contents, mtimeMs: st.mtimeMs }
        return contents
    }

    read(): Promise<DocumentContents> {
        return this.serial(() => this.load())
    }

    update(change: Parameters<DocumentPort['update']>[0]): Promise<void> {
        return this.serial(async () => {
            const current = await this.load()
            const r = change(current)
            if (!r) return
            const newAssets: PreparedImage[] = []
            for (const image of r.images) {
                const info = r.contents.discussion.assets.find((a) => a.assetId === image.assetId)
                if (!info) continue
                newAssets.push({
                    data: Buffer.from(image.data),
                    sha256: info.sha256,
                    size: info.size,
                    mediaType: info.mediaType,
                    path: info.path
                })
            }
            await writeDocument(this.path, r.contents, newAssets.length > 0 ? { newAssets } : {})
            const st = await fs.stat(this.path)
            this.cache = { contents: r.contents, mtimeMs: st.mtimeMs }
        })
    }

    imageBytes(assetId: string): Promise<Uint8Array | null> {
        return this.serial(async () => {
            const contents = await this.load()
            const info = contents.discussion.assets.find((a) => a.assetId === assetId)
            if (!info) return null
            try {
                const data = await readImageAsset(this.path, info)
                return data ? new Uint8Array(data) : null
            } catch {
                return null
            }
        })
    }

    /** Forget the cache (the window wrote the file meanwhile). */
    invalidate(): void {
        this.cache = null
    }
}
