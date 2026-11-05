import { describe, expect, it } from 'vitest'
import {
  appendMessage,
  createBranch,
  createDiscussion,
  buildReadSets,
  isUnread,
  isUnreadIn,
  readStatusOf,
  markAllRead,
  markMessageRead,
  markThreadRead,
  mainThread,
  readStateAfterBranch,
  readStateAfterSend,
  unreadSummary,
  whoHasRead,
  findMessage
} from '@shared/domain'
import type { ReadState } from '@shared/types'
import { anna, boris, buildSample, clara, makeCtx, simple } from '../helpers/fixtures'

describe('unread rules (FR-108 to FR-112)', () => {
  it('own messages are always read; others are unread until read', () => {
    const { contents, ids } = buildSample()
    const [m1, m2] = ids.mainMessages.map((id) => findMessage(contents.discussion, id).message)
    expect(isUnread({}, anna.participantId, m1!)).toBe(false) // Anna wrote m1
    expect(isUnread({}, anna.participantId, m2!)).toBe(true) // Boris wrote m2
  })

  it('first open: everything by others is unread (FR-109)', () => {
    const { contents } = buildSample()
    const s = unreadSummary(contents.discussion, {}, clara.participantId)
    expect(s.total).toBe(contents.discussion.threads.flatMap((t) => t.messages).length)
  })

  it('marks one message, a thread, and the whole discussion as read', () => {
    const { contents, ids } = buildSample()
    const d = contents.discussion
    let rs: ReadState = markMessageRead(d, {}, clara.participantId, ids.mainMessages[0]!)
    expect(rs[clara.participantId]).toEqual([ids.mainMessages[0]])

    rs = markThreadRead(d, rs, clara.participantId, mainThread(d).threadId)
    expect(rs[clara.participantId]).toEqual(ids.mainMessages) // no duplicates, order of first reads

    rs = markAllRead(d, rs, clara.participantId)
    expect(unreadSummary(d, rs, clara.participantId).total).toBe(0)
  })

  it('never lists own messages', () => {
    const { contents } = buildSample()
    const rs = markAllRead(contents.discussion, {}, anna.participantId)
    const own = contents.discussion.threads
      .flatMap((t) => t.messages)
      .filter((m) => m.authorId === anna.participantId)
      .map((m) => m.messageId)
    for (const id of own) expect(rs[anna.participantId]).not.toContain(id)
  })

  it('returns the same object when nothing changes (so no save is needed)', () => {
    const { contents, ids } = buildSample()
    const rs = markMessageRead(contents.discussion, {}, clara.participantId, ids.mainMessages[0]!)
    expect(
      markMessageRead(contents.discussion, rs, clara.participantId, ids.mainMessages[0]!)
    ).toBe(rs)
    expect(
      markMessageRead(contents.discussion, {}, anna.participantId, ids.mainMessages[0]!)
    ).toEqual({})
  })

  it('only the local participant entry changes; others are preserved (FR-120)', () => {
    const { contents, ids } = buildSample()
    const others: ReadState = {
      [boris.participantId]: [ids.mainMessages[0]!],
      'p-future': ['whatever']
    }
    const rs = markAllRead(contents.discussion, others, clara.participantId)
    expect(rs[boris.participantId]).toEqual(others[boris.participantId])
    expect(rs['p-future']).toEqual(['whatever'])
    expect(others[clara.participantId]).toBeUndefined() // input untouched
  })

  it('sending a message reads all earlier messages of that thread only (FR-112, case 1)', () => {
    const { contents, ctx, ids } = buildSample()
    const d = contents.discussion
    const main = mainThread(d).threadId
    // Boris never read anything; he now replies in the main thread.
    const rs = readStateAfterSend(d, {}, boris.participantId, main)
    const after = appendMessage(ctx, d, {
      threadId: main,
      author: boris,
      content: simple('ответ')
    }).discussion
    const summary = unreadSummary(after, rs, boris.participantId)
    expect(summary.byThread.get(main)?.own).toBe(0) // main thread fully read
    expect(summary.byThread.get(ids.branch1)?.own).toBe(1) // Anna's b1 in branch1 stays unread
  })

  it('creating a branch reads the source message only (FR-112, case 2)', () => {
    const { contents, ctx, ids } = buildSample()
    const d = contents.discussion
    const rs = readStateAfterBranch(d, {}, clara.participantId, ids.mainMessages[1]!)
    expect(rs[clara.participantId]).toEqual([ids.mainMessages[1]])
    const br = createBranch(ctx, d, {
      sourceMessageId: ids.mainMessages[1]!,
      quoteText: 'x',
      author: clara
    })
    expect(br.discussion.participants.some((p) => p.participantId === clara.participantId)).toBe(
      true
    )
  })

  it('counts per branch and flags ancestors with unread descendants (FR-113)', () => {
    const { contents, ids } = buildSample()
    const d = contents.discussion
    // Anna has read everything except Boris's b2 in branch1.
    let rs = markAllRead(d, {}, anna.participantId)
    rs = {
      [anna.participantId]: rs[anna.participantId]!.filter((id) => id !== ids.branch1Messages[1])
    }
    const s = unreadSummary(d, rs, anna.participantId)
    expect(s.total).toBe(1)
    expect(s.byThread.get(ids.branch1)).toEqual({ own: 1, descendants: 0 })
    expect(s.byThread.get(mainThread(d).threadId)).toEqual({ own: 0, descendants: 1 })
    expect(s.byThread.get(ids.branch2)).toEqual({ own: 0, descendants: 0 })
  })
})

describe('who has read a message (FR-122 to FR-124)', () => {
  it('excludes the author and reports none / some / all', () => {
    const { contents, ids } = buildSample()
    const d = contents.discussion
    const m = ids.mainMessages[0]! // written by Anna; known participants: Anna, Boris
    expect(whoHasRead(d, {}, m).state).toBe('none')
    expect(whoHasRead(d, {}, m).others.map((p) => p.participantId)).toEqual([boris.participantId])
    expect(whoHasRead(d, { [boris.participantId]: [m] }, m).state).toBe('all')

    const withClara = appendMessage(buildSample().ctx, d, {
      threadId: mainThread(d).threadId,
      author: clara,
      content: simple('hi')
    }).discussion
    const some = whoHasRead(withClara, { [boris.participantId]: [m] }, m)
    expect(some.state).toBe('some')
    expect(some.readers.map((p) => p.participantId)).toEqual([boris.participantId])
  })

  it('a person who never wrote to the file is not shown', () => {
    const { contents, ids } = buildSample()
    const r = whoHasRead(
      contents.discussion,
      { [clara.participantId]: [ids.mainMessages[0]!] },
      ids.mainMessages[0]!
    )
    expect(r.others.map((p) => p.participantId)).not.toContain(clara.participantId)
  })

  it("reports 'no-others' for a single-participant discussion", () => {
    const ctx = makeCtx('solo')
    const d0 = createDiscussion(ctx, { title: 'Solo', author: anna })
    const r = appendMessage(ctx, d0, {
      threadId: mainThread(d0).threadId,
      author: anna,
      content: simple('solo')
    })
    expect(whoHasRead(r.discussion, {}, r.message.messageId)).toEqual({
      state: 'no-others',
      readers: [],
      others: []
    })
  })
})

describe('fast read status for many messages', () => {
  it('buildReadSets, isUnreadIn and readStatusOf agree with the array-based functions', () => {
    const { contents, ids } = buildSample()
    const d = contents.discussion
    const rs: ReadState = {
      [boris.participantId]: [ids.mainMessages[0]!, ids.branch1Messages[0]!],
      [clara.participantId]: [ids.mainMessages[0]!]
    }
    const sets = buildReadSets(rs)
    for (const t of d.threads) {
      for (const m of t.messages) {
        expect(isUnreadIn(sets, boris.participantId, m)).toBe(isUnread(rs, boris.participantId, m))
        expect(isUnreadIn(sets, anna.participantId, m)).toBe(isUnread(rs, anna.participantId, m))
        expect(readStatusOf(d.participants, sets, m)).toEqual(whoHasRead(d, rs, m.messageId))
      }
    }
  })

  it('a participant who is only in the read state (never wrote) is not counted', () => {
    const { contents, ids } = buildSample()
    const d = contents.discussion // participants: Анна, Борис
    const m = findMessage(d, ids.mainMessages[0]!).message // by Анна
    const sets = buildReadSets({ [clara.participantId]: [ids.mainMessages[0]!] })
    const status = readStatusOf(d.participants, sets, m)
    expect(status.others.map((p) => p.participantId)).toEqual([boris.participantId])
    expect(status.state).toBe('none') // Клара's entry does not make it "some"
  })
})
