import type { BlobStore } from './blobs'
import type { Database } from './db'

/** An image for the library: with `data`, the bytes are stored first; without, the file must already be there. */
export interface BlobRef {
    sha256: string
    mediaType: string
    size: number
    data?: Uint8Array
}

/** Image and attachment files (folder `blobs`) and their rows (table `blob`). */
export class BlobRows {
    constructor(
        private readonly db: Database,
        private readonly blobs: BlobStore,
        /** Hashes that drafts use: kept by the cleanup. */
        private readonly draftBlobs: () => Set<string>
    ) {}

    /** Image bytes by hash, checked; null when missing or damaged. */
    readBlob(sha256: string): Promise<Buffer | null> {
        return this.blobs.read(sha256)
    }

    /** Hashes that rows refer to (for the cleanup of unused files and for the integrity check). */
    usedBlobs(): Set<string> {
        return new Set(
            this.db
                .prepare('SELECT sha256 FROM blob')
                .all()
                .map((r) => String(r.sha256))
        )
    }

    /**
     * Deletes image files that no asset row uses and that are older than `minAgeMs` (ADR-003 Q-07: 7 days, so a file
     * written just before a crash or a restore can still be used). Returns the number of files removed.
     */
    async removeUnusedBlobs(minAgeMs: number, now = Date.now()): Promise<number> {
        const used = new Set(
            this.db
                .prepare('SELECT sha256 FROM asset UNION SELECT sha256 FROM attachment')
                .all()
                .map((r) => String(r.sha256))
        )
        for (const h of this.draftBlobs()) used.add(h)
        let removed = 0
        for (const { sha256, modifiedMs } of await this.blobs.list()) {
            if (used.has(sha256) || now - modifiedMs < minAgeMs) continue
            this.db.prepare('DELETE FROM blob WHERE sha256 = ?').run(sha256)
            await this.blobs.remove(sha256)
            removed++
        }
        return removed
    }

    async storeBlobs(assets: BlobRef[]): Promise<void> {
        for (const a of assets) if (a.data) await this.blobs.put(a.sha256, a.data)
    }

    registerBlobs(assets: BlobRef[]): void {
        for (const a of assets) this.registerBlob(a)
    }

    /** True if the bytes of this hash are in the library (a row exists; rows come after their file). */
    hasBlob(sha256: string): boolean {
        return this.db.prepare('SELECT 1 FROM blob WHERE sha256 = ?').get(sha256) !== undefined
    }

    /** The recorded size of stored bytes, or null. */
    blobSize(sha256: string): number | null {
        const row = this.db.prepare('SELECT size FROM blob WHERE sha256 = ?').get(sha256)
        return row ? Number(row.size) : null
    }

    /** Stores checked bytes (an attachment) and records them. */
    async storeBlob(sha256: string, data: Uint8Array, mediaType: string): Promise<void> {
        await this.blobs.put(sha256, data)
        this.registerBlob({ sha256, mediaType, size: data.length })
    }

    /** Stores a file from disk (an attachment, FR-261) and records it; refuses a file above `maxBytes`. */
    async storeBlobFile(
        path: string,
        mediaType: string,
        maxBytes?: number
    ): Promise<{ sha256: string; size: number }> {
        const r = await this.blobs.putFile(path, maxBytes)
        this.registerBlob({ sha256: r.sha256, mediaType, size: r.size })
        return r
    }

    /** The file of a stored blob (to copy an attachment out without reading it into memory). */
    blobPath(sha256: string): string {
        return this.blobs.pathOf(sha256)
    }

    /** Records an image whose file is in the blob folder (the row comes after the file). */
    registerBlob(a: BlobRef): void {
        this.db
            .prepare('INSERT OR IGNORE INTO blob (sha256, media_type, size) VALUES (?, ?, ?)')
            .run(a.sha256, a.mediaType, a.size)
    }
}
