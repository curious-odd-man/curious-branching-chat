import type { DocumentContents, Message, Thread } from '../validation/schemas'
import { documentClock, type DocumentEventType } from './apply'
import type { EventPayload, MessageSentPayload } from './schemas'

/**
 * Events for a local change (design section 9.1): compares the discussion before and after the change, so local
 * and remote changes give the same data. The sync service adds envelope fields, parts, and encryption.
 */
export interface LocalEvent<T extends DocumentEventType = DocumentEventType> {
    type: T
    clock: number
    createdAt: string
    payload: EventPayload<T>
}

/** `message.sent` before parts are planned: the content is inline; `parts` is filled in by the sync service. */
export function messageSentDraft(message: Message, contents: DocumentContents): MessageSentPayload {
    const assets = new Map(contents.discussion.assets.map((a) => [a.assetId, a]))
    return {
        message: {
            messageId: message.messageId,
            threadId: message.threadId,
            authorDisplayName: message.authorDisplayName,
            createdAt: message.createdAt,
            content: message.content,
            assetReferences: message.assetReferences
        },
        images: message.assetReferences
            .map((id) => assets.get(id))
            .filter((a): a is NonNullable<typeof a> => a !== undefined)
            .map((a) => ({ assetId: a.assetId, mediaType: a.mediaType, size: a.size })),
        parts: []
    }
}

function threadsById(c: DocumentContents): Map<string, Thread> {
    return new Map(c.discussion.threads.map((t) => [t.threadId, t]))
}

export function eventsFromChange(
    before: DocumentContents,
    after: DocumentContents,
    localId: string,
    now: string
): LocalEvent[] {
    const events: LocalEvent[] = []
    const old = threadsById(before)
    const oldMessages = new Set(
        before.discussion.threads.flatMap((t) => t.messages.map((m) => m.messageId))
    )

    // new branches first: messages and status changes may refer to them
    for (const t of after.discussion.threads) {
        if (old.has(t.threadId) || t.parentThreadId === undefined) continue
        if (t.createdBy !== localId) continue
        events.push({
            type: 'branch.created',
            clock: t.clock,
            createdAt: t.createdAt,
            payload: {
                thread: {
                    threadId: t.threadId,
                    parentThreadId: t.parentThreadId,
                    sourceMessageId: t.sourceMessageId!,
                    quoteText: t.quoteText!,
                    ...(t.selectionStart !== undefined ? { selectionStart: t.selectionStart } : {}),
                    ...(t.selectionEnd !== undefined ? { selectionEnd: t.selectionEnd } : {}),
                    ...(t.title ? { title: t.title } : {}),
                    createdAt: t.createdAt
                }
            }
        })
    }

    const known = new Set(before.discussion.assets.map((a) => a.assetId))
    for (const t of after.discussion.threads) {
        for (const m of t.messages) {
            if (oldMessages.has(m.messageId) || m.authorId !== localId) continue
            const draft = messageSentDraft(m, after)
            // images that this member has already seen in the conversation are not sent again
            draft.images = draft.images.filter((i) => !known.has(i.assetId))
            events.push({
                type: 'message.sent',
                clock: m.clock,
                createdAt: m.createdAt,
                payload: draft
            })
        }
    }

    for (const t of after.discussion.threads) {
        const prev = old.get(t.threadId)
        if (!prev) continue
        if (
            t.statusSet &&
            t.statusSet.by === localId &&
            t.statusSet.clock !== prev.statusSet?.clock
        )
            events.push({
                type: 'branch.status.set',
                clock: t.statusSet.clock,
                createdAt: now,
                payload: { threadId: t.threadId, status: t.status }
            })
        if (t.titleSet && t.titleSet.by === localId && t.titleSet.clock !== prev.titleSet?.clock)
            events.push({
                type: 'branch.title.set',
                clock: t.titleSet.clock,
                createdAt: now,
                payload: { threadId: t.threadId, title: t.title ?? '' }
            })
    }

    const wasRead = new Set(before.readState[localId] ?? [])
    const added = (after.readState[localId] ?? []).filter((id) => !wasRead.has(id))
    for (let i = 0; i < added.length; i += 10_000)
        events.push({
            type: 'readstate.added',
            clock: documentClock(after),
            createdAt: now,
            payload: { messageIds: added.slice(i, i + 10_000) }
        })

    const oldMember = before.sync?.members.find((m) => m.participantId === localId)
    const newMember = after.sync?.members.find((m) => m.participantId === localId)
    if (oldMember && newMember && oldMember.displayName !== newMember.displayName) {
        const clock =
            (newMember as { displayNameClock?: number }).displayNameClock ?? documentClock(after)
        events.push({
            type: 'profile.updated',
            clock,
            createdAt: now,
            payload: { displayName: newMember.displayName }
        })
    }
    return events
}

/**
 * A local name change in a synchronized discussion: the roster entry gets the new name and a new clock, so the
 * change wins over older ones on every computer (FR-161, D-12). Returns the same object if nothing changes.
 */
export function withLocalDisplayName(
    contents: DocumentContents,
    localId: string,
    displayName: string
): DocumentContents {
    const sync = contents.sync
    const current = sync?.members.find((m) => m.participantId === localId)
    if (!sync || !current || current.displayName === displayName) return contents
    const clock = documentClock(contents) + 1
    return {
        ...contents,
        sync: {
            ...sync,
            members: sync.members.map((m) =>
                m.participantId === localId ? { ...m, displayName, displayNameClock: clock } : m
            )
        }
    }
}
