import type { DocumentContents, Message, Thread } from '../validation/schemas'
import { documentClock, type DocumentEventType } from './apply'
import type { EventPayload, EventType, MessageSentPayload } from './schemas'

/**
 * An event that this member sends, before the sync service adds envelope fields, parts, and encryption. A union over
 * the event types, so `payload` has the type that belongs to `type` (code review Y-1).
 */
export type OutgoingEvent<T extends EventType = EventType> = {
    [K in T]: { type: K; clock: number; createdAt: string; payload: EventPayload<K> }
}[T]

/**
 * Events for a local change (design section 9.1): compares the discussion before and after the change, so local
 * and remote changes give the same data.
 */
export type LocalEvent = OutgoingEvent<DocumentEventType>

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
            // FR-261: the files right after the message; the sync service adds the parts
            if (m.attachments && m.attachments.length > 0)
                events.push({
                    type: 'message.attachments',
                    clock: m.clock,
                    createdAt: m.createdAt,
                    payload: {
                        messageId: m.messageId,
                        attachments: m.attachments.map((a) => ({
                            name: a.name,
                            size: a.size,
                            type: a.type,
                            sha256: a.sha256,
                            parts: []
                        }))
                    }
                })
        }
    }

    // FR-233: own reaction changes (a new message has no reactions yet)
    const oldById = new Map<string, Message>()
    for (const t of before.discussion.threads)
        for (const m of t.messages) oldById.set(m.messageId, m)
    for (const t of after.discussion.threads)
        for (const m of t.messages) {
            const prev = oldById.get(m.messageId)
            if (!m.reactions || m.reactions === prev?.reactions) continue
            for (const r of m.reactions) {
                if (r.by !== localId) continue
                const was = prev?.reactions?.find((x) => x.emoji === r.emoji && x.by === r.by)
                if (was && was.clock === r.clock && was.on === r.on) continue
                events.push({
                    type: 'reaction.set',
                    clock: r.clock,
                    createdAt: now,
                    payload: { messageId: m.messageId, emoji: r.emoji, on: r.on }
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

    const wasDelivered = new Set(before.delivery?.[localId] ?? [])
    const delivered = (after.delivery?.[localId] ?? []).filter((id) => !wasDelivered.has(id))
    for (let i = 0; i < delivered.length; i += 10_000)
        events.push({
            type: 'delivery.added',
            clock: documentClock(after),
            createdAt: now,
            payload: { messageIds: delivered.slice(i, i + 10_000) }
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
 * D-41: the messages of other authors that are in this copy but not yet in the own delivery entry.
 */
export function missingOwnDelivery(contents: DocumentContents, localId: string): string[] {
    if (!contents.sync) return []
    const current = new Set(contents.delivery?.[localId] ?? [])
    const missing: string[] = []
    for (const t of contents.discussion.threads)
        for (const m of t.messages)
            if (m.authorId !== localId && !current.has(m.messageId)) missing.push(m.messageId)
    return missing.sort()
}

/** Adds message IDs to the own delivery entry. Returns the same object if nothing changes. */
export function addOwnDelivery(
    contents: DocumentContents,
    localId: string,
    messageIds: readonly string[]
): DocumentContents {
    if (!contents.sync) return contents
    const current = new Set(contents.delivery?.[localId] ?? [])
    const added = messageIds.filter((id) => !current.has(id))
    if (added.length === 0) return contents
    return {
        ...contents,
        delivery: { ...contents.delivery, [localId]: [...current, ...added].sort() }
    }
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

export interface NewMemberKeys {
    signingPublicKey: string
    encryptionPublicKey: string
    fingerprint: string
}

/**
 * D-15, D-32: the member gets new keys; the old ones go to `previousKeys` (old signatures stay valid). Returns the
 * same object if the member is unknown or already has these keys.
 */
export function withReplacedKeys(
    contents: DocumentContents,
    participantId: string,
    keys: NewMemberKeys,
    replacedAt: string
): DocumentContents {
    const sync = contents.sync
    const member = sync?.members.find((m) => m.participantId === participantId)
    if (!sync || !member || member.fingerprint === keys.fingerprint) return contents
    const previous = {
        signingPublicKey: member.signingPublicKey,
        encryptionPublicKey: member.encryptionPublicKey,
        fingerprint: member.fingerprint,
        replacedAt
    }
    return {
        ...contents,
        sync: {
            ...sync,
            members: sync.members.map((m) =>
                m.participantId === participantId
                    ? {
                          ...m,
                          signingPublicKey: keys.signingPublicKey,
                          encryptionPublicKey: keys.encryptionPublicKey,
                          fingerprint: keys.fingerprint,
                          previousKeys: [...(m.previousKeys ?? []), previous]
                      }
                    : m
            )
        }
    }
}
