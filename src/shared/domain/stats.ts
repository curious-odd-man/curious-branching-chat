import { richTextToPlain, type DiscussionData, type ReadState } from '../validation'
import { readSet } from './readState'

/** The numbers of the stats line of a discussion (whole discussion, all branches). */
export interface DiscussionStats {
    messages: number
    /** Messages in open and in closed branches (the main thread is always open). */
    inOpenBranches: number
    inClosedBranches: number
    /** Messages of others that this person has read, and not read (own messages do not count). */
    read: number
    unread: number
    /** Synchronized only: own messages that every member received, and that some member did not receive yet. */
    delivered: number
    waiting: number
    /** Synchronized only: messages of others whose parts are still loading. */
    loading: number
    /** UTF-8 size of the text of all messages. */
    textBytes: number
    /** Size of the images and the attachments. */
    fileBytes: number
}

export interface StatsInput {
    discussion: DiscussionData
    readState: ReadState
    localParticipantId: string
    /** Own outbox: copy state per member, by message ID; empty for a normal discussion. */
    copies: Record<string, Record<string, 'pending' | 'written' | 'delivered'>>
    loadingCount: number
}

const encoder = new TextEncoder()

export function discussionStats(input: StatsInput): DiscussionStats {
    const { discussion, localParticipantId } = input
    const readByMe = readSet(input.readState, localParticipantId)
    const out: DiscussionStats = {
        messages: 0,
        inOpenBranches: 0,
        inClosedBranches: 0,
        read: 0,
        unread: 0,
        delivered: 0,
        waiting: 0,
        loading: input.loadingCount,
        textBytes: 0,
        fileBytes: discussion.assets.reduce((sum, a) => sum + a.size, 0)
    }
    for (const thread of discussion.threads)
        for (const m of thread.messages) {
            out.messages += 1
            if (thread.status === 'closed') out.inClosedBranches += 1
            else out.inOpenBranches += 1
            if (m.authorId === localParticipantId) {
                const copies = Object.values(input.copies[m.messageId] ?? {})
                if (copies.some((c) => c !== 'delivered')) out.waiting += 1
                else out.delivered += 1
            } else if (readByMe.has(m.messageId)) out.read += 1
            else out.unread += 1
            out.textBytes += encoder.encode(richTextToPlain(m.content)).length
            for (const a of m.attachments ?? []) out.fileBytes += a.size
        }
    return out
}
