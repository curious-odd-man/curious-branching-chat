import { expect, type Page } from '@playwright/test'
import type * as Sqlite from 'node:sqlite'
import { basename, join } from 'node:path'
import type { TestApp } from './app'
import { readEntries, type SavedDiscussion, type SavedThread } from './readFile'
import { readFile } from 'node:fs/promises'

/**
 * ADR-003: discussions live in the library of the profile (`library.sqlite`). These helpers make a
 * discussion through the window, and read the library directly, independent of the app's own code.
 */

/** "Новое обсуждение" through the start screen: the name prompt (if shown), then the title prompt. */
export async function newDiscussion(
    win: Page,
    title = 'Обсуждение',
    name = 'Анна',
    start?: () => Promise<void>
): Promise<void> {
    if (start) await start()
    else {
        // the start screen of an empty library, else the "+" menu of the list of discussions
        const launcher = win.getByTestId('launcher-new')
        const add = win.getByTestId('sidebar-add')
        await expect(launcher.or(add).first()).toBeVisible()
        if (await launcher.isVisible()) await launcher.click()
        else {
            await add.first().click()
            await win.getByTestId('menu-add-local').click()
        }
    }
    const namePrompt = win.getByTestId('name-input')
    const titlePrompt = win.getByTestId('new-title-input')
    await expect(namePrompt.or(titlePrompt)).toBeVisible()
    if (await namePrompt.isVisible()) {
        await namePrompt.fill(name)
        await win.getByTestId('name-confirm').click()
    }
    await titlePrompt.fill(title)
    await win.getByTestId('new-title-confirm').click()
    await expect(win.getByTestId('composer')).toBeVisible()
}

/** "Экспортировать…" of the discussion in `win`, to `file`. */
export async function exportOpen(t: TestApp, win: Page, file: string): Promise<void> {
    await t.answer({ save: [file] })
    const r = await win.evaluate(() => window.branchchat.exportDiscussion())
    expect(r).toEqual({ ok: true, data: true })
}

/**
 * `node:sqlite` exists only with the `node:` prefix. The Playwright loader on Windows does not know such a module and
 * fails on a static import, so it is taken from Node directly.
 */
// the Node types give `unknown` for this module name
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- needed by tsc
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof Sqlite
type DatabaseSync = Sqlite.DatabaseSync

interface Row {
    [key: string]: string | number | null
}

function open(userData: string): DatabaseSync {
    return new DatabaseSync(join(userData, 'library.sqlite'))
}

/** The discussions of a profile: ID and title, most recently changed first. */
export function libraryList(
    userData: string
): Array<{ id: string; title: string; synced: boolean }> {
    const db = open(userData)
    try {
        return (
            db
                .prepare('SELECT id, title, synced FROM discussion ORDER BY updated_at DESC')
                .all() as Row[]
        ).map((r) => ({ id: String(r.id), title: String(r.title), synced: r.synced === 1 }))
    } finally {
        db.close()
    }
}

/** The number of drafts in the library of a profile (FR-251). */
export function draftRows(userData: string): number {
    const db = open(userData)
    try {
        return Number((db.prepare('SELECT count(*) AS n FROM draft').get() as Row).n)
    } finally {
        db.close()
    }
}

/** Profiles of the apps that the tests started (newest last); `savedFile` looks there for imported files. */
export const knownProfiles: string[] = []

export interface LibraryDiscussion {
    id: string
    manifest: { documentId: string; schemaVersion: number }
    discussion: SavedDiscussion
    readState: Record<string, string[]>
    delivery: Record<string, string[]> | null
    sync: { members: Array<{ participantId: string; displayName: string }> } | null
}

/** One discussion of the profile, by title (or the only one). */
export function readLibrary(userData: string, title?: string, byId = false): LibraryDiscussion {
    const db = open(userData)
    try {
        const rows = db.prepare('SELECT * FROM discussion').all() as Row[]
        const d = title
            ? rows.find((r) => (byId ? r.id : r.title) === title)
            : rows.length === 1
              ? rows[0]
              : undefined
        if (!d)
            throw new Error(`no discussion ${title ?? ''} (${rows.map((r) => r.title).join(', ')})`)
        const id = String(d.id)
        const json = <T>(v: unknown): T => JSON.parse(String(v)) as T
        const messages = new Map<string, SavedThread['messages']>()
        for (const r of db
            .prepare(
                'SELECT thread_id, data FROM message WHERE discussion_id = ? ORDER BY thread_id, ord'
            )
            .all(id) as Row[]) {
            const list = messages.get(String(r.thread_id)) ?? []
            list.push(json(r.data))
            messages.set(String(r.thread_id), list)
        }
        const threads = (
            db
                .prepare('SELECT thread_id, data FROM thread WHERE discussion_id = ? ORDER BY ord')
                .all(id) as Row[]
        ).map((r) => ({
            ...json<SavedThread>(r.data),
            messages: messages.get(String(r.thread_id)) ?? []
        }))
        const participants = (
            db
                .prepare('SELECT data FROM participant WHERE discussion_id = ? ORDER BY ord')
                .all(id) as Row[]
        ).map((r) => json<SavedDiscussion['participants'][number]>(r.data))
        const assets = (
            db
                .prepare('SELECT data FROM asset WHERE discussion_id = ? ORDER BY ord')
                .all(id) as Row[]
        ).map((r) => json<SavedDiscussion['assets'][number]>(r.data))
        const keys = json<{ read: string[]; delivery: string[] | null }>(d.mark_keys)
        const marks = (kind: number, people: string[]): Record<string, string[]> => {
            const out: Record<string, string[]> = {}
            for (const p of people) out[p] = []
            for (const r of db
                .prepare(
                    'SELECT participant_id, message_id FROM mark WHERE discussion_id = ? AND kind = ? ORDER BY participant_id, ord'
                )
                .all(id, kind) as Row[])
                out[String(r.participant_id)]?.push(String(r.message_id))
            return out
        }
        return {
            id,
            manifest: json(d.manifest),
            discussion: {
                ...json<Omit<SavedDiscussion, 'threads' | 'participants' | 'assets'>>(d.head),
                threads,
                participants,
                assets
            },
            readState: marks(0, keys.read),
            delivery: keys.delivery ? marks(1, keys.delivery) : null,
            sync: d.sync === null ? null : json(d.sync)
        }
    } finally {
        db.close()
    }
}

const created = new Map<string, { userData: string; title: string }>()

/**
 * Earlier tests named a discussion by its file. This keeps that: the discussion gets the file name as its
 * title, and `savedFile(file)` reads it from the library of that profile.
 */
export async function createAt(t: TestApp, win: Page, file: string, name = 'Анна'): Promise<void> {
    const title = basename(file).replace(/\.branchchat$/i, '')
    await newDiscussion(win, title, name)
    created.set(file, { userData: t.userData, title })
}

/**
 * What the library holds for a test file: a discussion made by `createAt(…, file)`, or the discussion of a file that a
 * test imported (found by the ID in the file, in the profiles of the started apps, newest first).
 */
async function savedOf(file: string): Promise<LibraryDiscussion> {
    const c = created.get(file)
    if (c) return readLibrary(c.userData, c.title)
    const entries = await readEntries(file)
    const id = (
        JSON.parse(entries.get('manifest.json')!.toString('utf8')) as { documentId: string }
    ).documentId
    for (const userData of [...knownProfiles].reverse()) {
        try {
            return readLibrary(userData, id, true)
        } catch {
            // not in this profile
        }
    }
    throw new Error(`the discussion of ${file} is in no library`)
}

/** In the shape of `readDiscussionFile`. */
export async function savedFile(file: string): Promise<{
    discussion: SavedDiscussion
    manifest: { documentId: string; schemaVersion: number }
}> {
    const d = await savedOf(file)
    return { discussion: d.discussion, manifest: d.manifest }
}

export async function savedReadState(file: string): Promise<Record<string, string[]>> {
    return (await savedOf(file)).readState
}

/** The image files of the library of the discussion (as `assets/images/<hash>.<ext>` names, like in a file). */
export async function savedAssets(file: string): Promise<Map<string, Buffer>> {
    const d = await savedOf(file)
    const userData = created.get(file)?.userData ?? findProfile(d.id)
    const out = new Map<string, Buffer>()
    for (const a of d.discussion.assets) {
        const data = await readFile(join(userData, 'blobs', a.sha256.slice(0, 2), a.sha256)).catch(
            () => null
        )
        if (data) out.set(a.path, data)
    }
    return out
}

function findProfile(id: string): string {
    for (const userData of [...knownProfiles].reverse()) {
        try {
            readLibrary(userData, id, true)
            return userData
        } catch {
            // not here
        }
    }
    throw new Error(`no profile has ${id}`)
}
