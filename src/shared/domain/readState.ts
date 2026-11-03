import type { DiscussionData, Message, Participant, ReadState } from '../validation/schemas'
import { findMessage, findThread } from './discussion'

/**
 * Read-state rules (requirements 5.10). Read state is stored in the file, per participant.
 * Only the local participant's entry is ever changed; entries of others are preserved as they are.
 * A participant's own messages are implicitly read and are never listed.
 */

function readSet(rs: ReadState, participantId: string): Set<string> {
  return new Set(rs[participantId] ?? [])
}

export function isUnread(rs: ReadState, localId: string, message: Message): boolean {
  if (message.authorId === localId) return false
  return !(rs[localId] ?? []).includes(message.messageId)
}

/** Returns the same object if nothing changed, so callers can skip a save. */
function addRead(rs: ReadState, localId: string, messages: Message[]): ReadState {
  const already = readSet(rs, localId)
  const toAdd = messages
    .filter((m) => m.authorId !== localId && !already.has(m.messageId))
    .map((m) => m.messageId)
  if (toAdd.length === 0) return rs
  return { ...rs, [localId]: [...(rs[localId] ?? []), ...toAdd] }
}

export function markMessageRead(
  d: DiscussionData,
  rs: ReadState,
  localId: string,
  messageId: string
): ReadState {
  return addRead(rs, localId, [findMessage(d, messageId).message])
}

/** Marks the thread's own messages as read (not inherited context, which belongs to the parent threads). */
export function markThreadRead(
  d: DiscussionData,
  rs: ReadState,
  localId: string,
  threadId: string
): ReadState {
  return addRead(rs, localId, findThread(d, threadId).messages)
}

export function markAllRead(d: DiscussionData, rs: ReadState, localId: string): ReadState {
  return addRead(
    rs,
    localId,
    d.threads.flatMap((t) => t.messages)
  )
}

/**
 * FR-112 (1): sending a message in a thread reads every earlier message of that thread.
 * Call with the discussion as it was BEFORE the new message was appended.
 */
export function readStateAfterSend(
  dBeforeAppend: DiscussionData,
  rs: ReadState,
  localId: string,
  threadId: string
): ReadState {
  return markThreadRead(dBeforeAppend, rs, localId, threadId)
}

/** FR-112 (2): creating a branch from a message reads that source message. */
export function readStateAfterBranch(
  d: DiscussionData,
  rs: ReadState,
  localId: string,
  sourceMessageId: string
): ReadState {
  return markMessageRead(d, rs, localId, sourceMessageId)
}

export interface UnreadCounts {
  own: number
  /** Unread messages in descendant branches (drives the indicator on ancestors, FR-113). */
  descendants: number
}

export interface UnreadSummary {
  byThread: Map<string, UnreadCounts>
  total: number
}

export function unreadSummary(d: DiscussionData, rs: ReadState, localId: string): UnreadSummary {
  const read = readSet(rs, localId)
  const byThread = new Map<string, UnreadCounts>()
  let total = 0
  for (const t of d.threads) {
    const own = t.messages.filter((m) => m.authorId !== localId && !read.has(m.messageId)).length
    byThread.set(t.threadId, { own, descendants: 0 })
    total += own
  }
  const parentOf = new Map(d.threads.map((t) => [t.threadId, t.parentThreadId]))
  for (const t of d.threads) {
    const own = byThread.get(t.threadId)?.own ?? 0
    if (own === 0) continue
    for (let p = parentOf.get(t.threadId); p !== undefined; p = parentOf.get(p)) {
      const counts = byThread.get(p)
      if (counts) counts.descendants += own
    }
  }
  return { byThread, total }
}

export type ReadStatus = 'none' | 'some' | 'all' | 'no-others'

export interface WhoHasRead {
  state: ReadStatus
  /** Known participants other than the author who have read the message. */
  readers: Participant[]
  /** Known participants other than the author. */
  others: Participant[]
}

/** FR-122 to FR-124: read status of a message among the known participants, excluding its author. */
export function whoHasRead(d: DiscussionData, rs: ReadState, messageId: string): WhoHasRead {
  const { message } = findMessage(d, messageId)
  const others = d.participants.filter((p) => p.participantId !== message.authorId)
  const readers = others.filter((p) => (rs[p.participantId] ?? []).includes(messageId))
  const state: ReadStatus =
    others.length === 0
      ? 'no-others'
      : readers.length === 0
        ? 'none'
        : readers.length === others.length
          ? 'all'
          : 'some'
  return { state, readers, others }
}
