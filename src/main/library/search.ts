import {
    branchLabel,
    matchRanges,
    messageSearchText,
    normalizeSearchText,
    searchWords
} from '@shared/domain'
import type { SearchHit } from '@shared/types/ipc'
import type { Message, Thread } from '@shared/validation'
import type { Database } from './db'

const AROUND = 60
const LIMIT = 200

/** FTS5 query: every word as a quoted prefix, all words required (FR-212). */
export function ftsQuery(words: readonly string[]): string {
    return words.map((w) => `"${w.replace(/"/g, '""')}"*`).join(' ')
}

/**
 * FR-211 to FR-215: search over the messages (FTS5 index of normalized text) and the branch titles of one discussion
 * or of the whole library. Results: newest first; in one discussion in the order of the discussion.
 */
export function search(
    db: Database,
    query: string,
    options: { discussionId?: string; limit?: number } = {}
): SearchHit[] {
    const words = searchWords(query)
    if (words.length === 0) return []
    const limit = Math.min(options.limit ?? LIMIT, LIMIT)
    const scoped = options.discussionId !== undefined
    const rows = db
        .prepare(
            `SELECT m.discussion_id, m.thread_id, m.data FROM search_index s
               JOIN message m ON m.rowid = s.rowid
              WHERE search_index MATCH ? ${scoped ? 'AND m.discussion_id = ?' : ''}
              ORDER BY m.created_at ${scoped ? 'ASC' : 'DESC'}
              LIMIT ?`
        )
        .all(
            ...(scoped ? [ftsQuery(words), options.discussionId!, limit] : [ftsQuery(words), limit])
        )

    // names of discussions, threads, and people for the results
    const discussions = new Set(rows.map((r) => String(r.discussion_id)))
    const titles = new Map<string, string>()
    const threads = new Map<string, Thread>()
    const people = new Map<string, string>()
    const threadRows = scoped
        ? db
              .prepare('SELECT discussion_id, thread_id, data FROM thread WHERE discussion_id = ?')
              .all(options.discussionId!)
        : db.prepare('SELECT discussion_id, thread_id, data FROM thread').all()
    const branchHits: SearchHit[] = []
    for (const r of threadRows) {
        const thread = JSON.parse(String(r.data)) as Thread
        const id = String(r.discussion_id)
        threads.set(`${id}:${String(r.thread_id)}`, thread)
        // FR-214: branch titles too
        const title = thread.title?.trim()
        if (title && thread.parentThreadId !== undefined) {
            const marks = matchRanges(title, words)
            const norm = normalizeSearchText(title)
            if (words.every((w) => norm.split(/[^\p{L}\p{N}]+/u).some((t) => t.startsWith(w)))) {
                discussions.add(id)
                branchHits.push({
                    kind: 'branch',
                    discussionId: id,
                    discussionTitle: '',
                    threadId: thread.threadId,
                    threadLabel: title,
                    messageId: null,
                    authorName: '',
                    createdAt: thread.createdAt,
                    snippet: title,
                    marks
                })
            }
        }
    }
    for (const id of discussions) {
        const d = db.prepare('SELECT title FROM discussion WHERE id = ?').get(id)
        if (d) titles.set(id, String(d.title))
        for (const p of db
            .prepare('SELECT data FROM participant WHERE discussion_id = ?')
            .all(id)) {
            const person = JSON.parse(String(p.data)) as {
                participantId: string
                displayName: string
            }
            people.set(`${id}:${person.participantId}`, person.displayName)
        }
    }

    const hits: SearchHit[] = rows.map((r) => {
        const id = String(r.discussion_id)
        const message = JSON.parse(String(r.data)) as Message
        const thread = threads.get(`${id}:${message.threadId}`)
        const { snippet, marks } = around(messageSearchText(message), words)
        return {
            kind: 'message',
            discussionId: id,
            discussionTitle: titles.get(id) ?? '',
            threadId: message.threadId,
            threadLabel: thread && thread.parentThreadId !== undefined ? branchLabel(thread) : '',
            messageId: message.messageId,
            authorName: people.get(`${id}:${message.authorId}`) ?? '',
            createdAt: message.createdAt,
            snippet,
            marks
        }
    })
    for (const b of branchHits) b.discussionTitle = titles.get(b.discussionId) ?? ''
    return [...branchHits, ...hits]
}

/** The text around the first match, with the matches in it. */
function around(
    text: string,
    words: readonly string[]
): { snippet: string; marks: Array<[number, number]> } {
    const flat = text.replace(/\s+/g, ' ')
    const all = matchRanges(flat, words)
    const first = all[0]?.[0] ?? 0
    const start = Math.max(0, first - AROUND)
    const end = Math.min(flat.length, first + AROUND * 2)
    const prefix = start > 0 ? '…' : ''
    const snippet = `${prefix}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`
    const marks = all
        .filter(([s, e]) => s >= start && e <= end)
        .map(([s, e]): [number, number] => [s - start + prefix.length, e - start + prefix.length])
    return { snippet, marks }
}
