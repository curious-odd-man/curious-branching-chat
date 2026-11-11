import type { Message, Participant } from '../validation/schemas'

/** State of one copy of an own message in the outbox (FR-169). */
export type CopyState = 'pending' | 'written' | 'delivered'

/**
 * The mark of a message (D-41, FR-122, FR-169). The same rule applies to own messages and to messages of others.
 * - `pending`: the own message is not written to the shared folder yet (a clock).
 * - `written`: one grey check: the message is in the shared folder.
 * - `delivered`: two grey checks: all members (except the author) have received it.
 * - `read-some`: one green check: at least one member (except the author) has read it.
 * - `read-all`: two green checks: all members (except the author) have read it.
 * Reading always wins over delivery. A normal discussion has no delivery: it shows only the green checks.
 */
export type MessageMarkState = 'pending' | 'written' | 'delivered' | 'read-some' | 'read-all'

/** State of one member for one message. `unread` is used only in a normal discussion. */
export type MemberMarkState = 'read' | 'delivered' | 'written' | 'pending' | 'unread'

export interface MessageMark {
    state: MessageMarkState
    /** Known participants other than the author, sorted by name. */
    members: Array<{ participant: Participant; state: MemberMarkState }>
}

/** Delivery data of a synchronized discussion. */
export interface MarkSync {
    localId: string
    /** Which messages each member has received (`delivery.json`, as sets). */
    deliverySets: Map<string, Set<string>>
    /** Own outbox: the copy state per recipient, by message ID. Only own messages have an entry. */
    copies: Record<string, Record<string, CopyState>>
}

const RANK: Record<MemberMarkState, number> = {
    unread: 0,
    pending: 0,
    written: 1,
    delivered: 2,
    read: 3
}

/**
 * Returns the mark of `message`, or null if no mark is shown: no other known participant, or (in a normal
 * discussion) nobody has read the message yet.
 */
export function messageMarkOf(
    message: Message,
    participants: readonly Participant[],
    readSets: Map<string, Set<string>>,
    sync: MarkSync | null
): MessageMark | null {
    const others = participants
        .filter((p) => p.participantId !== message.authorId)
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ru'))
    if (others.length === 0) return null
    const own = sync !== null && message.authorId === sync.localId
    const copies = sync && own ? (sync.copies[message.messageId] ?? {}) : {}

    const members = others.map((participant) => {
        const id = participant.participantId
        let state: MemberMarkState
        if (readSets.get(id)?.has(message.messageId)) state = 'read'
        else if (!sync) state = 'unread'
        else if (id === sync.localId || sync.deliverySets.get(id)?.has(message.messageId))
            // a message in the own copy is received by this member
            state = 'delivered'
        else state = copies[id] ?? 'written'
        return { participant, state }
    })

    const read = members.filter((m) => m.state === 'read').length
    let state: MessageMarkState
    if (read === members.length) state = 'read-all'
    else if (read > 0) state = 'read-some'
    else if (!sync) return null
    else {
        const lowest = members.reduce<MemberMarkState>(
            (min, m) => (RANK[m.state] < RANK[min] ? m.state : min),
            'read'
        )
        state = lowest === 'delivered' ? 'delivered' : lowest === 'pending' ? 'pending' : 'written'
    }
    return { state, members }
}
