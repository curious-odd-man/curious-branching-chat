import {
    REACTION_EMOJI,
    type DiscussionData,
    type Message,
    type Reaction,
    type ReactionEmoji
} from '../validation/schemas'
import { nextClock } from '../validation/order'
import type { Author } from './context'
import { DomainError } from './errors'
import { ensureParticipant } from './discussion'

/**
 * Reactions (FR-231 to FR-234). Each person has at most one entry per emoji; a removed reaction keeps its entry with
 * `on: false`, so the last change of the person wins everywhere (as for branch statuses, D-05).
 */

function compareReactions(a: Reaction, b: Reaction): number {
    const ea = REACTION_EMOJI.indexOf(a.emoji)
    const eb = REACTION_EMOJI.indexOf(b.emoji)
    return ea - eb || (a.by < b.by ? -1 : a.by > b.by ? 1 : 0)
}

/**
 * The message with this reaction change, if it is later than the person's last change of the same emoji (higher
 * clock; with the same clock, a removal wins, so the result does not depend on the order). Returns the same object when
 * nothing changes.
 */
export function withReaction(message: Message, change: Reaction): Message {
    const list = message.reactions ?? []
    const old = list.find((r) => r.emoji === change.emoji && r.by === change.by)
    if (old) {
        if (change.clock < old.clock) return message
        if (change.clock === old.clock && (old.on === change.on || change.on)) return message
    }
    const reactions = [
        ...list.filter((r) => r !== old),
        { emoji: change.emoji, by: change.by, on: change.on, clock: change.clock }
    ].sort(compareReactions)
    return { ...message, reactions }
}

/** Both sets of reactions of one message together (an import merges a copy, ADR-003). */
export function mergeReactions(a: Message, b: Message): Message {
    let out = a
    for (const r of b.reactions ?? []) out = withReaction(out, r)
    return out
}

export interface ReactionCount {
    emoji: ReactionEmoji
    /** IDs of the people with this reaction, sorted. */
    by: string[]
    /** True if the local person gave it. */
    mine: boolean
}

/** FR-232: the reactions under a message, in the fixed emoji order; only emoji with a count above 0. */
export function reactionCounts(message: Message, localId: string): ReactionCount[] {
    const out: ReactionCount[] = []
    for (const emoji of REACTION_EMOJI) {
        const by = (message.reactions ?? [])
            .filter((r) => r.emoji === emoji && r.on)
            .map((r) => r.by)
            .sort()
        if (by.length > 0) out.push({ emoji, by, mine: by.includes(localId) })
    }
    return out
}

/**
 * FR-231: the local person adds or removes a reaction (a second click on the same one removes it). The change gets the
 * next clock of the discussion. The person is added to the participants, as for a read mark (FR-022). `updatedAt`
 * does not change: a reaction is not a new message (FR-234).
 */
export function toggleReaction(
    d: DiscussionData,
    author: Author,
    messageId: string,
    emoji: ReactionEmoji
): DiscussionData {
    if (!REACTION_EMOJI.includes(emoji))
        throw new DomainError('INVALID_REACTION', 'unknown reaction')
    let threadId: string | null = null
    let message: Message | null = null
    for (const t of d.threads) {
        const m = t.messages.find((x) => x.messageId === messageId)
        if (m) {
            threadId = t.threadId
            message = m
            break
        }
    }
    if (!message || threadId === null)
        throw new DomainError('MESSAGE_NOT_FOUND', `message ${messageId} not found`)
    const current = (message.reactions ?? []).find(
        (r) => r.emoji === emoji && r.by === author.participantId
    )
    const next = withReaction(message, {
        emoji,
        by: author.participantId,
        on: !(current?.on ?? false),
        clock: nextClock(d)
    })
    const withAuthor = ensureParticipant(d, author)
    return {
        ...withAuthor,
        threads: withAuthor.threads.map((t) =>
            t.threadId === threadId
                ? { ...t, messages: t.messages.map((m) => (m === message ? next : m)) }
                : t
        )
    }
}
