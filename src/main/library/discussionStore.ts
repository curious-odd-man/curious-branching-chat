import type { AssetInfo, DocumentContents } from '@shared/validation'
import { verifyImageAsset } from '../document/assets'
import type { BlobRef, LibraryRepository, LoadedDiscussion } from './repository'

/** A change of a discussion with the bytes of the images it registers (the sync engine's `DocumentPort.update`). */
export type DiscussionChange = (contents: DocumentContents) => {
    contents: DocumentContents
    images: Array<{ assetId: string; data: Uint8Array }>
} | null

/** The open window of a discussion (a `DocumentSession`): while it is set, every change goes through it. */
export interface DiscussionOwner {
    readonly current: DocumentContents
    applyRemote(change: DiscussionChange): void
    readAssetBytes(assetId: string): Promise<{ data: Buffer; mediaType: string } | null>
}

/**
 * One discussion of the library, shared by its window and the sync engine (ADR-003: a closed synchronized
 * discussion is written by the sync engine the same way as an open one). Writes are serialized; each one is a
 * difference from the last saved version, protected by the revision.
 */
export class DiscussionStore {
    private chain: Promise<unknown> = Promise.resolve()
    private saved: LoadedDiscussion | null = null
    private owner: DiscussionOwner | null = null

    constructor(
        private readonly repo: LibraryRepository,
        readonly id: string,
        /** After each save (the list of discussions shows the last message and the unread count). */
        private readonly onSaved: () => void = () => undefined
    ) {}

    private serial<T>(fn: () => Promise<T> | T): Promise<T> {
        const next = this.chain.then(fn, fn)
        this.chain = next.catch(() => undefined)
        return next
    }

    private ensure(): LoadedDiscussion {
        this.saved ??= this.repo.load(this.id)
        return this.saved
    }

    /** The last saved version and the images that are missing in the library. */
    load(): Promise<LoadedDiscussion> {
        return this.serial(() => this.ensure())
    }

    /** Resolves when no write is running. */
    idle(): Promise<void> {
        return this.serial(() => undefined)
    }

    setOwner(owner: DiscussionOwner | null): void {
        this.owner = owner
    }

    get hasOwner(): boolean {
        return this.owner !== null
    }

    /** Saves `after` (the window's save queue). `newAssets` are images whose bytes are not in the library yet. */
    save(after: DocumentContents, newAssets: BlobRef[] = []): Promise<void> {
        return this.serial(async () => {
            const before = this.ensure()
            if (before.contents === after && newAssets.length === 0) return
            const revision = await this.repo.save(
                this.id,
                before.contents,
                after,
                before.revision,
                newAssets
            )
            const missing = new Set(before.missingAssetIds)
            for (const a of newAssets) missing.delete(a.sha256)
            this.saved = { contents: after, revision, missingAssetIds: [...missing] }
            this.onSaved()
        })
    }

    // ---- DocumentPort of the sync engine ---------------------------------------------------------------------------

    async read(): Promise<DocumentContents> {
        if (this.owner) return this.owner.current
        return (await this.load()).contents
    }

    async update(change: DiscussionChange): Promise<void> {
        if (this.owner) return this.owner.applyRemote(change)
        await this.serial(async () => {
            const before = this.ensure()
            const r = change(before.contents)
            if (!r) return
            const assets: BlobRef[] = []
            for (const image of r.images) {
                const info = r.contents.discussion.assets.find((a) => a.assetId === image.assetId)
                if (info)
                    assets.push({
                        sha256: info.sha256,
                        mediaType: info.mediaType,
                        size: info.size,
                        data: Buffer.from(image.data)
                    })
            }
            const revision = await this.repo.save(
                this.id,
                before.contents,
                r.contents,
                before.revision,
                assets
            )
            this.saved = { contents: r.contents, revision, missingAssetIds: before.missingAssetIds }
            this.onSaved()
        })
    }

    async imageBytes(assetId: string): Promise<Uint8Array | null> {
        if (this.owner) {
            const r = await this.owner.readAssetBytes(assetId)
            return r ? new Uint8Array(r.data) : null
        }
        const contents = await this.read()
        const info = contents.discussion.assets.find((a) => a.assetId === assetId)
        const data = info ? await this.readAsset(info) : null
        return data ? new Uint8Array(data) : null
    }

    /** Image bytes from the library, checked against the recorded type and checksum; null: show a placeholder. */
    async readAsset(info: AssetInfo): Promise<Buffer | null> {
        const data = await this.repo.readBlob(info.sha256)
        if (!data) return null
        try {
            verifyImageAsset(data, info)
            return data
        } catch {
            return null
        }
    }

    /** Forget the cached version (the rows were changed outside this store, e.g. a restore). */
    invalidate(): void {
        this.saved = null
    }
}
