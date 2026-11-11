import type {
    AssetInfo,
    ChangeStamp,
    DiscussionData,
    DocumentContents,
    Message,
    Participant,
    ReadState,
    Thread
} from '../validation/schemas'
import { collectImageAssetIds } from '../validation/richText'
import { isLaterStamp, maxClock, normalizeOrder } from '../validation/order'
import type { RosterMember, SyncInfo } from '../validation/roster'
import type { EventPayload, EventType } from './schemas'

/**
 * Pure apply rules of the sync protocol (sync-protocol.md sections 7 to 9, design section 9).
 * The caller has already decrypted and verified the event, and checked that the sender is a member.
 * Applying the same event twice changes nothing; any arrival order gives the same discussion.
 */

/** A decrypted, verified event. For `message.sent`, `payload.message.content` is present (parts already joined). */
export interface VerifiedEvent<T extends EventType = EventType> {
    eventId: string
    type: T
    senderId: string
    clock: number
    createdAt: string
    payload: EventPayload<T>
}

/** Event types that change the discussion. Parts, receipts, and invitations are handled by the sync service. */
export type DocumentEventType =
    | 'message.sent'
    | 'branch.created'
    | 'branch.status.set'
    | 'branch.title.set'
    | 'readstate.added'
    | 'member.added'
    | 'profile.updated'

export const DOCUMENT_EVENT_TYPES: readonly DocumentEventType[] = [
    'message.sent',
    'branch.created',
    'branch.status.set',
    'branch.title.set',
    'readstate.added',
    'member.added',
    'profile.updated'
]

export type ApplyResult =
    | {
          status: 'applied'
          contents: DocumentContents
          /** Image assets registered by this event; their bytes must be written into the file. */
          newAssetIds: string[]
      }
    /** Already in the discussion: nothing to do (the receipt is still sent). */
    | { status: 'duplicate' }
    /** Needs data that has not arrived yet; keep it in the pending queue (section 9.3). */
    | { status: 'pending'; waitingFor: string }
    /** Breaks a rule; quarantine it. */
    | { status: 'rejected'; reason: string }

const EXTENSIONS: Record<AssetInfo['mediaType'], string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp'
}

export function assetPath(assetId: string, mediaType: AssetInfo['mediaType']): string {
    return `assets/images/${assetId}.${EXTENSIONS[mediaType]}`
}

/** The highest clock in the document, also counting roster name changes (Lamport clock of this member). */
export function documentClock(contents: DocumentContents): number {
    let max = maxClock(contents.discussion)
    for (const m of contents.sync?.members ?? []) {
        const c = nameClockOf(m)
        if (c > max) max = c
    }
    return max
}

/** Clock for the next local change in a synchronized discussion (sync-protocol.md section 8). */
export function nextDocumentClock(contents: DocumentContents): number {
    return documentClock(contents) + 1
}

function nameClockOf(member: RosterMember): number {
    const c = (member as { displayNameClock?: unknown }).displayNameClock
    return typeof c === 'number' && Number.isSafeInteger(c) && c >= 0 ? c : 0
}

function findThread(d: DiscussionData, threadId: string): Thread | undefined {
    return d.threads.find((t) => t.threadId === threadId)
}

function hasMessage(d: DiscussionData, messageId: string): boolean {
    return d.threads.some((t) => t.messages.some((m) => m.messageId === messageId))
}

function member(sync: SyncInfo | undefined, participantId: string): RosterMember | undefined {
    return sync?.members.find((m) => m.participantId === participantId)
}

/** Adds the participant (sorted by ID, so every member gets the same list) if it is not listed yet. */
function withParticipant(d: DiscussionData, p: Participant): DiscussionData {
    if (d.participants.some((x) => x.participantId === p.participantId)) return d
    const participants = [...d.participants, p].sort((a, b) =>
        a.participantId < b.participantId ? -1 : a.participantId > b.participantId ? 1 : 0
    )
    return { ...d, participants }
}

function participantFor(
    contents: DocumentContents,
    senderId: string,
    fallbackName: string
): Participant {
    const m = member(contents.sync, senderId)
    return { participantId: senderId, displayName: m?.displayName ?? fallbackName }
}

function touched(d: DiscussionData, createdAt: string): DiscussionData {
    // updatedAt is display information only; the latest one wins so all members converge
    return createdAt > d.updatedAt ? { ...d, updatedAt: createdAt } : d
}

function done(
    contents: DocumentContents,
    discussion: DiscussionData,
    newAssetIds: string[] = []
): ApplyResult {
    return {
        status: 'applied',
        contents: { ...contents, discussion: normalizeOrder(discussion) },
        newAssetIds
    }
}

function applyMessage(contents: DocumentContents, e: VerifiedEvent<'message.sent'>): ApplyResult {
    const d = contents.discussion
    const { message: m, images } = e.payload
    if (hasMessage(d, m.messageId)) return { status: 'duplicate' }
    if (m.content === undefined)
        return { status: 'pending', waitingFor: `content of ${m.messageId}` }
    const thread = findThread(d, m.threadId)
    if (!thread) return { status: 'pending', waitingFor: `thread ${m.threadId}` }

    const inContent = collectImageAssetIds(m.content)
    if (inContent.some((id) => !m.assetReferences.includes(id)))
        return { status: 'rejected', reason: 'image in content is not in assetReferences' }
    const listed = new Map(images.map((i) => [i.assetId, i]))
    const newAssets: AssetInfo[] = []
    for (const ref of m.assetReferences) {
        if (d.assets.some((a) => a.assetId === ref)) continue
        const image = listed.get(ref)
        // an image that the sender saw earlier in the conversation, but that has not reached this member yet
        if (!image) return { status: 'pending', waitingFor: `asset ${ref}` }
        newAssets.push({
            assetId: ref,
            path: assetPath(ref, image.mediaType),
            mediaType: image.mediaType,
            size: image.size,
            sha256: ref
        })
    }

    const message: Message = {
        messageId: m.messageId,
        threadId: m.threadId,
        sequence: thread.messages.length,
        clock: e.clock,
        authorId: e.senderId,
        authorDisplayName: m.authorDisplayName,
        createdAt: m.createdAt,
        content: m.content,
        assetReferences: m.assetReferences
    }
    // a message for a branch that is closed here is accepted; the branch stays closed (D-07)
    let next = withParticipant(d, participantFor(contents, e.senderId, m.authorDisplayName))
    next = {
        ...next,
        assets: [...next.assets, ...newAssets].sort((a, b) =>
            a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0
        ),
        threads: next.threads.map((t) =>
            t.threadId === thread.threadId ? { ...t, messages: [...t.messages, message] } : t
        )
    }
    return done(
        contents,
        touched(next, m.createdAt),
        newAssets.map((a) => a.assetId)
    )
}

function applyBranch(contents: DocumentContents, e: VerifiedEvent<'branch.created'>): ApplyResult {
    const d = contents.discussion
    const t = e.payload.thread
    if (findThread(d, t.threadId)) return { status: 'duplicate' }
    if (e.clock === 0) return { status: 'rejected', reason: 'a branch needs a clock above 0' }
    const parent = findThread(d, t.parentThreadId)
    if (!parent) return { status: 'pending', waitingFor: `thread ${t.parentThreadId}` }
    if (!parent.messages.some((m) => m.messageId === t.sourceMessageId)) {
        if (hasMessage(d, t.sourceMessageId))
            return { status: 'rejected', reason: 'source message is not in the parent thread' }
        return { status: 'pending', waitingFor: `message ${t.sourceMessageId}` }
    }
    if (
        t.selectionStart !== undefined &&
        t.selectionEnd !== undefined &&
        t.selectionEnd < t.selectionStart
    )
        return { status: 'rejected', reason: 'selection end is before selection start' }
    const thread: Thread = {
        threadId: t.threadId,
        parentThreadId: t.parentThreadId,
        sourceMessageId: t.sourceMessageId,
        quoteText: t.quoteText,
        ...(t.selectionStart !== undefined ? { selectionStart: t.selectionStart } : {}),
        ...(t.selectionEnd !== undefined ? { selectionEnd: t.selectionEnd } : {}),
        ...(t.title && t.title.trim() ? { title: t.title.trim() } : {}),
        status: 'open',
        createdAt: t.createdAt,
        createdBy: e.senderId,
        clock: e.clock,
        messages: []
    }
    const next = withParticipant(d, participantFor(contents, e.senderId, e.senderId))
    return done(contents, touched({ ...next, threads: [...next.threads, thread] }, t.createdAt))
}

function stampOf(stamp: ChangeStamp | undefined, thread: Thread): ChangeStamp {
    return stamp ?? { clock: 0, by: thread.createdBy }
}

function applyStatus(
    contents: DocumentContents,
    e: VerifiedEvent<'branch.status.set'>
): ApplyResult {
    const d = contents.discussion
    const thread = findThread(d, e.payload.threadId)
    if (!thread) return { status: 'pending', waitingFor: `thread ${e.payload.threadId}` }
    if (thread.parentThreadId === undefined && e.payload.status === 'closed')
        return { status: 'rejected', reason: 'the main thread cannot be closed' }
    const stamp = { clock: e.clock, by: e.senderId }
    // last writer wins (D-24); an older or equal change is already covered
    if (!isLaterStamp(stamp, stampOf(thread.statusSet, thread))) return { status: 'duplicate' }
    const threads = d.threads.map((t) =>
        t.threadId === thread.threadId ? { ...t, status: e.payload.status, statusSet: stamp } : t
    )
    return done(contents, touched({ ...d, threads }, e.createdAt))
}

function applyTitle(contents: DocumentContents, e: VerifiedEvent<'branch.title.set'>): ApplyResult {
    const d = contents.discussion
    const thread = findThread(d, e.payload.threadId)
    if (!thread) return { status: 'pending', waitingFor: `thread ${e.payload.threadId}` }
    const stamp = { clock: e.clock, by: e.senderId }
    if (!isLaterStamp(stamp, stampOf(thread.titleSet, thread))) return { status: 'duplicate' }
    const title = e.payload.title.trim()
    const threads = d.threads.map((t) => {
        if (t.threadId !== thread.threadId) return t
        const { title: _old, ...rest } = t
        return title ? { ...rest, title, titleSet: stamp } : { ...rest, titleSet: stamp }
    })
    return done(contents, touched({ ...d, threads }, e.createdAt))
}

function applyReadState(
    contents: DocumentContents,
    e: VerifiedEvent<'readstate.added'>
): ApplyResult {
    const rs: ReadState = contents.readState
    const current = new Set(rs[e.senderId] ?? [])
    // the sender's own messages are never listed (implicitly read)
    const own = new Set(
        contents.discussion.threads.flatMap((t) =>
            t.messages.filter((m) => m.authorId === e.senderId).map((m) => m.messageId)
        )
    )
    const added = e.payload.messageIds.filter((id) => !current.has(id) && !own.has(id))
    if (added.length === 0) return { status: 'duplicate' }
    // IDs of messages that have not arrived yet are kept; they count once the message arrives
    const readState = { ...rs, [e.senderId]: [...current, ...added].sort() }
    const discussion = withParticipant(
        contents.discussion,
        participantFor(contents, e.senderId, e.senderId)
    )
    return {
        status: 'applied',
        contents: { ...contents, discussion, readState },
        newAssetIds: []
    }
}

function applyMemberAdded(
    contents: DocumentContents,
    e: VerifiedEvent<'member.added'>
): ApplyResult {
    const sync = contents.sync
    if (!sync) return { status: 'rejected', reason: 'not a synchronized discussion' }
    const m = e.payload.member
    if (m.addedBy !== e.senderId) return { status: 'rejected', reason: 'addedBy is not the sender' }
    if (sync.members.some((x) => x.participantId === m.participantId))
        return { status: 'duplicate' }
    const members = [...sync.members, { ...m }].sort((a, b) =>
        a.participantId < b.participantId ? -1 : a.participantId > b.participantId ? 1 : 0
    )
    return {
        status: 'applied',
        contents: { ...contents, sync: { ...sync, members } },
        newAssetIds: []
    }
}

function applyProfile(
    contents: DocumentContents,
    e: VerifiedEvent<'profile.updated'>
): ApplyResult {
    const sync = contents.sync
    const current = member(sync, e.senderId)
    if (!sync || !current) return { status: 'rejected', reason: 'sender is not a member' }
    if (e.clock <= nameClockOf(current)) return { status: 'duplicate' }
    const displayName = e.payload.displayName.trim()
    if (!displayName) return { status: 'rejected', reason: 'empty display name' }
    const members = sync.members.map((x) =>
        x.participantId === e.senderId ? { ...x, displayName, displayNameClock: e.clock } : x
    )
    // like a local name change: old messages keep the name they were written with (FR-024)
    const participants = contents.discussion.participants.map((p) =>
        p.participantId === e.senderId ? { ...p, displayName } : p
    )
    return {
        status: 'applied',
        contents: {
            ...contents,
            sync: { ...sync, members },
            discussion: { ...contents.discussion, participants }
        },
        newAssetIds: []
    }
}

const byString =
    <T>(key: (x: T) => string) =>
    (a: T, b: T): number =>
        key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0

/**
 * The same discussion always gives the same data on every member's computer: participants, assets, roster
 * members, and read-state lists are sorted; messages and threads are in clock order. Used after every remote and
 * local change of a synchronized discussion. Returns the same object if nothing changes.
 */
export function normalizeSynced(contents: DocumentContents): DocumentContents {
    const d = normalizeOrder(contents.discussion)
    const sortedOrSame = <T>(
        items: readonly T[],
        compare: (a: T, b: T) => number
    ): readonly T[] => {
        for (let i = 1; i < items.length; i++)
            if (compare(items[i - 1]!, items[i]!) > 0) return [...items].sort(compare)
        return items
    }
    // in a synchronized discussion the roster is the source of display names (D-12)
    const names = new Map(
        (contents.sync?.members ?? []).map((m) => [m.participantId, m.displayName])
    )
    const renamed = d.participants.some(
        (p) => names.has(p.participantId) && names.get(p.participantId) !== p.displayName
    )
    const withNames = renamed
        ? d.participants.map((p) =>
              names.has(p.participantId) ? { ...p, displayName: names.get(p.participantId)! } : p
          )
        : d.participants
    const participants = sortedOrSame(
        withNames,
        byString((p) => p.participantId)
    )
    const assets = sortedOrSame(
        d.assets,
        byString((a) => a.assetId)
    )
    let rsChanged = false
    const readState: ReadState = {}
    for (const key of Object.keys(contents.readState).sort()) {
        const list = contents.readState[key]!
        const unique = [...new Set(list)].sort()
        if (unique.length !== list.length || unique.some((v, i) => v !== list[i])) rsChanged = true
        readState[key] = unique
    }
    if (!rsChanged && Object.keys(contents.readState).join() !== Object.keys(readState).join())
        rsChanged = true
    const members = contents.sync
        ? sortedOrSame(
              contents.sync.members,
              byString((m) => m.participantId)
          )
        : undefined
    const discussionChanged =
        d !== contents.discussion || participants !== d.participants || assets !== d.assets
    const syncChanged = contents.sync !== undefined && members !== contents.sync.members
    if (!discussionChanged && !rsChanged && !syncChanged) return contents
    return {
        ...contents,
        discussion: discussionChanged
            ? { ...d, participants: [...participants], assets: [...assets] }
            : contents.discussion,
        readState: rsChanged ? readState : contents.readState,
        ...(contents.sync
            ? { sync: syncChanged ? { ...contents.sync, members: [...members!] } : contents.sync }
            : {})
    }
}

/** Applies one verified event to the discussion. */
export function applyEvent(contents: DocumentContents, event: VerifiedEvent): ApplyResult {
    const r = applyEventRaw(contents, event)
    return r.status === 'applied' ? { ...r, contents: normalizeSynced(r.contents) } : r
}

function applyEventRaw(contents: DocumentContents, event: VerifiedEvent): ApplyResult {
    switch (event.type) {
        case 'message.sent':
            return applyMessage(contents, event as VerifiedEvent<'message.sent'>)
        case 'branch.created':
            return applyBranch(contents, event as VerifiedEvent<'branch.created'>)
        case 'branch.status.set':
            return applyStatus(contents, event as VerifiedEvent<'branch.status.set'>)
        case 'branch.title.set':
            return applyTitle(contents, event as VerifiedEvent<'branch.title.set'>)
        case 'readstate.added':
            return applyReadState(contents, event as VerifiedEvent<'readstate.added'>)
        case 'member.added':
            return applyMemberAdded(contents, event as VerifiedEvent<'member.added'>)
        case 'profile.updated':
            return applyProfile(contents, event as VerifiedEvent<'profile.updated'>)
        default:
            return { status: 'rejected', reason: `${event.type} does not change the discussion` }
    }
}

export interface DrainResult {
    contents: DocumentContents
    /** Events applied in this call, in order, with the image assets each one registered. */
    applied: Array<{ event: VerifiedEvent; newAssetIds: string[] }>
    duplicates: VerifiedEvent[]
    rejected: Array<{ event: VerifiedEvent; reason: string }>
    /** Still waiting for a dependency. */
    pending: VerifiedEvent[]
}

/**
 * Applies a batch of events, retrying the pending ones after every applied event, until nothing more can be
 * applied (sync-protocol.md section 9.3).
 */
export function applyAll(
    contents: DocumentContents,
    events: readonly VerifiedEvent[]
): DrainResult {
    let current = contents
    let waiting = [...events]
    const result: DrainResult = {
        contents,
        applied: [],
        duplicates: [],
        rejected: [],
        pending: []
    }
    let progress = true
    while (progress && waiting.length > 0) {
        progress = false
        const still: VerifiedEvent[] = []
        for (const event of waiting) {
            const r = applyEvent(current, event)
            if (r.status === 'applied') {
                current = r.contents
                result.applied.push({ event, newAssetIds: r.newAssetIds })
                progress = true
            } else if (r.status === 'duplicate') {
                result.duplicates.push(event)
                progress = true
            } else if (r.status === 'rejected') {
                result.rejected.push({ event, reason: r.reason })
                progress = true
            } else still.push(event)
        }
        waiting = still
    }
    result.contents = current
    result.pending = waiting
    return result
}

/**
 * Known participants for the read indicator (FR-123, FR-124, D-25): in a synchronized discussion, every roster
 * member counts from the start; others count after their first write, as before.
 */
export function knownParticipants(
    contents: Pick<DocumentContents, 'discussion' | 'sync'>
): Participant[] {
    const byId = new Map(contents.discussion.participants.map((p) => [p.participantId, p]))
    for (const m of contents.sync?.members ?? []) {
        const existing = byId.get(m.participantId)
        byId.set(m.participantId, {
            ...existing,
            participantId: m.participantId,
            displayName: m.displayName
        })
    }
    return [...byId.values()]
}
