import type { DiscussionData, Message, Thread, ThreadStatus } from '../validation/schemas'
import type { Author, DomainContext } from './context'
import { DomainError } from './errors'
import { ensureParticipant, findMessage, findThread, touch } from './discussion'

export interface CreateBranchInput {
    sourceMessageId: string
    quoteText: string
    selectionStart?: number
    selectionEnd?: number
    author: Author
    title?: string
}

/** "Reply to this": creates a branch linked to a message and the selected passage (FR-049 to FR-056). */
export function createBranch(
    ctx: DomainContext,
    d: DiscussionData,
    input: CreateBranchInput
): { discussion: DiscussionData; thread: Thread } {
    const { thread: parent } = findMessage(d, input.sourceMessageId)
    if (input.quoteText.trim().length === 0)
        throw new DomainError('EMPTY_QUOTE', 'a branch needs a non-empty selected passage')
    if (
        input.selectionStart !== undefined &&
        input.selectionEnd !== undefined &&
        input.selectionEnd < input.selectionStart
    )
        throw new DomainError('INVALID_SELECTION', 'selection end is before selection start')

    const thread: Thread = {
        threadId: ctx.newId(),
        parentThreadId: parent.threadId,
        sourceMessageId: input.sourceMessageId,
        quoteText: input.quoteText,
        ...(input.selectionStart !== undefined ? { selectionStart: input.selectionStart } : {}),
        ...(input.selectionEnd !== undefined ? { selectionEnd: input.selectionEnd } : {}),
        ...(input.title ? { title: input.title } : {}),
        status: 'open',
        createdAt: ctx.now(),
        createdBy: input.author.participantId,
        messages: []
    }
    const withAuthor = ensureParticipant(d, input.author)
    return {
        discussion: touch(ctx, { ...withAuthor, threads: [...withAuthor.threads, thread] }),
        thread
    }
}

function updateThread(
    ctx: DomainContext,
    d: DiscussionData,
    threadId: string,
    patch: (t: Thread) => Thread
): DiscussionData {
    findThread(d, threadId)
    return touch(ctx, {
        ...d,
        threads: d.threads.map((t) => (t.threadId === threadId ? patch(t) : t))
    })
}

/** Closing or reopening only affects this branch, never its parent or children (FR-059, FR-064). */
export function setThreadStatus(
    ctx: DomainContext,
    d: DiscussionData,
    threadId: string,
    status: ThreadStatus
): DiscussionData {
    const thread = findThread(d, threadId)
    if (thread.parentThreadId === undefined && status === 'closed')
        throw new DomainError('MAIN_THREAD_NOT_CLOSABLE', 'the main thread cannot be closed')
    return updateThread(ctx, d, threadId, (t) => ({ ...t, status }))
}

export function setThreadTitle(
    ctx: DomainContext,
    d: DiscussionData,
    threadId: string,
    title: string
): DiscussionData {
    const trimmed = title.trim()
    return updateThread(ctx, d, threadId, (t) => {
        const { title: _old, ...rest } = t
        return trimmed ? { ...rest, title: trimmed } : rest
    })
}

export interface ThreadContext {
    thread: Thread
    /** Threads from the main thread down to this one. */
    path: Thread[]
    /** Read-only inherited messages, root first: parent messages up to and including the source, recursively. */
    inherited: Message[]
    /** The thread's own messages. */
    own: Message[]
}

/** Context rules of requirements section 4.5. Sibling branches and later parent messages are excluded. */
export function resolveContext(d: DiscussionData, threadId: string): ThreadContext {
    const thread = findThread(d, threadId)
    const path: Thread[] = []
    const inheritedByThread = new Map<string, Message[]>()

    const chain: Thread[] = []
    for (let cur: Thread | undefined = thread; cur;) {
        chain.unshift(cur)
        cur = cur.parentThreadId === undefined ? undefined : findThread(d, cur.parentThreadId)
    }
    path.push(...chain)

    let inherited: Message[] = []
    for (const t of chain) {
        inheritedByThread.set(t.threadId, inherited)
        if (t.threadId === threadId) break
        const next = chain[chain.indexOf(t) + 1]
        if (!next || next.sourceMessageId === undefined) break
        const cut = t.messages.findIndex((m) => m.messageId === next.sourceMessageId)
        inherited = [...inherited, ...t.messages.slice(0, cut + 1)]
    }
    return { thread, path, inherited: inheritedByThread.get(threadId) ?? [], own: thread.messages }
}

export interface BranchNode {
    thread: Thread
    children: BranchNode[]
}

/** Branch hierarchy for the side panel; children keep creation order. */
export function buildHierarchy(d: DiscussionData): BranchNode {
    const nodes = new Map<string, BranchNode>(
        d.threads.map((t) => [t.threadId, { thread: t, children: [] }])
    )
    let root: BranchNode | undefined
    for (const t of d.threads) {
        const node = nodes.get(t.threadId)
        if (!node) continue
        if (t.parentThreadId === undefined) root = node
        else nodes.get(t.parentThreadId)?.children.push(node)
    }
    if (!root) throw new DomainError('THREAD_NOT_FOUND', 'discussion has no main thread')
    return root
}

/** How many branches start from each message (FR-035). */
export function branchCountsByMessage(d: DiscussionData): Map<string, number> {
    const counts = new Map<string, number>()
    for (const t of d.threads) {
        if (t.sourceMessageId !== undefined)
            counts.set(t.sourceMessageId, (counts.get(t.sourceMessageId) ?? 0) + 1)
    }
    return counts
}

/** Branches (not the main thread) split into Active and Closed groups for the side panel (FR-031). */
export function groupBranchesByStatus(d: DiscussionData): { active: Thread[]; closed: Thread[] } {
    const branches = d.threads.filter((t) => t.parentThreadId !== undefined)
    return {
        active: branches.filter((t) => t.status === 'open'),
        closed: branches.filter((t) => t.status === 'closed')
    }
}

/** The branches that start from each message, in creation order (FR-035). */
export function branchesBySourceMessage(d: DiscussionData): Map<string, Thread[]> {
    const map = new Map<string, Thread[]>()
    for (const t of d.threads) {
        if (t.sourceMessageId === undefined) continue
        const list = map.get(t.sourceMessageId)
        if (list) list.push(t)
        else map.set(t.sourceMessageId, [t])
    }
    return map
}

const LABEL_QUOTE_LENGTH = 40

/** Name of a branch in lists: its title, or an excerpt of the quoted passage. */
export function branchLabel(thread: Thread): string {
    if (thread.title && thread.title.trim()) return thread.title.trim()
    const quote = (thread.quoteText ?? '').replace(/\s+/g, ' ').trim()
    if (quote.length === 0) return '…'
    return quote.length > LABEL_QUOTE_LENGTH
        ? `${quote.slice(0, LABEL_QUOTE_LENGTH).trimEnd()}…`
        : quote
}

/**
 * Branches of one status as a forest for the side panel (FR-031, FR-033).
 * A branch hangs under its nearest ancestor that has the same status, or at the top level if there is none, so
 * closing a parent never hides its still-open children (FR-064). `hiddenParent` is set when the real parent is not
 * the one the branch is shown under, so the panel can say where it belongs.
 */
export interface GroupedBranchNode {
    thread: Thread
    children: GroupedBranchNode[]
    /** The real parent branch when it is not displayed in this group (null when the parent is the main thread). */
    hiddenParent: Thread | null
}

export function groupedForest(d: DiscussionData, status: ThreadStatus): GroupedBranchNode[] {
    const byId = new Map(d.threads.map((t) => [t.threadId, t]))
    const nodes = new Map<string, GroupedBranchNode>()
    for (const t of d.threads) {
        if (t.parentThreadId !== undefined && t.status === status)
            nodes.set(t.threadId, { thread: t, children: [], hiddenParent: null })
    }
    const roots: GroupedBranchNode[] = []
    for (const t of d.threads) {
        const node = nodes.get(t.threadId)
        if (!node) continue
        let ancestor = t.parentThreadId === undefined ? undefined : byId.get(t.parentThreadId)
        while (ancestor && !nodes.has(ancestor.threadId)) {
            ancestor =
                ancestor.parentThreadId === undefined
                    ? undefined
                    : byId.get(ancestor.parentThreadId)
        }
        const directParent = t.parentThreadId === undefined ? undefined : byId.get(t.parentThreadId)
        if (directParent && directParent.parentThreadId !== undefined && directParent !== ancestor)
            node.hiddenParent = directParent
        if (ancestor) nodes.get(ancestor.threadId)?.children.push(node)
        else roots.push(node)
    }
    return roots
}
