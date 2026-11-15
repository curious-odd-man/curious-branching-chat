import type { Author } from '@shared/domain'
import type { DocumentContents } from '@shared/validation'
import {
    DocumentSession,
    type SessionDeps,
    type SessionStore
} from '../../src/main/application/documentSession'
import { sep } from 'node:path'
import { DiscussionStore, LibraryService, openLibrary } from '../../src/main/library'
import { onTempDirRemove } from './fixtures'

const libraries = new Map<string, LibraryService>()
const byDiscussion = new Map<string, LibraryService>()

// the libraries in a test folder are closed before the folder is removed (Windows cannot remove an open database)
onTempDirRemove((dir) => {
    for (const [libDir, lib] of [...libraries]) {
        if (libDir !== dir && !libDir.startsWith(dir + sep)) continue
        lib.close()
        libraries.delete(libDir)
        for (const [id, l] of [...byDiscussion]) if (l === lib) byDiscussion.delete(id)
    }
})

/** The library in a test folder (one per folder, opened on first use). */
export async function libraryIn(dir: string): Promise<LibraryService> {
    let lib = libraries.get(dir)
    if (!lib) {
        lib = new LibraryService(await openLibrary(dir))
        libraries.set(dir, lib)
    }
    return lib
}

/** Closes the libraries of the test folders (call before the folders are removed). */
export function closeLibraries(): void {
    for (const lib of libraries.values()) lib.close()
    libraries.clear()
    byDiscussion.clear()
}

/** A new discussion in the library of `dir`, open in a session. `wrap` can observe or fail the saves. */
export async function createSession(
    dir: string,
    deps: SessionDeps,
    input: { author: Author; title?: string },
    wrap?: (store: DiscussionStore) => SessionStore
): Promise<DocumentSession> {
    const lib = await libraryIn(dir)
    const contents = DocumentSession.newContents(deps, {
        author: input.author,
        title: input.title ?? 'Обсуждение'
    })
    await lib.create(contents)
    byDiscussion.set(contents.manifest.documentId, lib)
    const store = lib.store(contents.manifest.documentId)
    return DocumentSession.open(wrap ? wrap(store) : store, await store.load(), deps)
}

/** What the library holds for a discussion (read from the database, not from a cache). */
export function readSaved(id: string): DocumentContents {
    return byDiscussion.get(id)!.repo.load(id).contents
}

/** The discussion opened again, as after a restart (a new store, read from the database). */
export function reopenSession(id: string, deps: SessionDeps): DocumentSession {
    const lib = byDiscussion.get(id)!
    const loaded = lib.repo.load(id)
    return DocumentSession.open(new DiscussionStore(lib.repo, id), loaded, deps)
}

/** The library of a discussion created with `createSession`. */
export function libraryOf(id: string): LibraryService {
    return byDiscussion.get(id)!
}
