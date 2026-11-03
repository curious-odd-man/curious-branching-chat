import type { AssetInfo, DiscussionData, Message, Participant, Thread } from '../validation/schemas'
import { collectImageAssetIds, type RichDoc } from '../validation/richText'
import type { Author, DomainContext } from './context'
import { DomainError } from './errors'

export function createDiscussion(
  ctx: DomainContext,
  input: { title: string; author: Author }
): DiscussionData {
  const now = ctx.now()
  return {
    title: input.title,
    createdAt: now,
    updatedAt: now,
    participants: [
      { participantId: input.author.participantId, displayName: input.author.displayName }
    ],
    threads: [
      {
        threadId: ctx.newId(),
        status: 'open',
        createdAt: now,
        createdBy: input.author.participantId,
        messages: []
      }
    ],
    assets: []
  }
}

export function mainThread(d: DiscussionData): Thread {
  const main = d.threads.find((t) => t.parentThreadId === undefined)
  if (!main) throw new DomainError('THREAD_NOT_FOUND', 'discussion has no main thread')
  return main
}

export function findThread(d: DiscussionData, threadId: string): Thread {
  const t = d.threads.find((x) => x.threadId === threadId)
  if (!t) throw new DomainError('THREAD_NOT_FOUND', `thread ${threadId} not found`)
  return t
}

export interface LocatedMessage {
  thread: Thread
  message: Message
  index: number
}

export function findMessage(d: DiscussionData, messageId: string): LocatedMessage {
  for (const thread of d.threads) {
    const index = thread.messages.findIndex((m) => m.messageId === messageId)
    const message = thread.messages[index]
    if (message) return { thread, message, index }
  }
  throw new DomainError('MESSAGE_NOT_FOUND', `message ${messageId} not found`)
}

/** Adds the participant on first write; refreshes the display name if it changed (old messages keep their snapshot). */
export function ensureParticipant(d: DiscussionData, author: Author): DiscussionData {
  const existing = d.participants.find((p) => p.participantId === author.participantId)
  if (existing && existing.displayName === author.displayName) return d
  const participants: Participant[] = existing
    ? d.participants.map((p) =>
        p.participantId === author.participantId ? { ...p, displayName: author.displayName } : p
      )
    : [...d.participants, { participantId: author.participantId, displayName: author.displayName }]
  return { ...d, participants }
}

export function touch(ctx: DomainContext, d: DiscussionData): DiscussionData {
  return { ...d, updatedAt: ctx.now() }
}

export function setDiscussionTitle(
  ctx: DomainContext,
  d: DiscussionData,
  title: string
): DiscussionData {
  return touch(ctx, { ...d, title })
}

/** Registers an embedded asset. Assets are identified by their SHA-256, so identical images are stored once. */
export interface NewAsset {
  path: string
  mediaType: AssetInfo['mediaType']
  size: number
  sha256: string
}

export function addAsset(
  d: DiscussionData,
  asset: NewAsset
): { discussion: DiscussionData; asset: AssetInfo } {
  const existing = d.assets.find((a) => a.assetId === asset.sha256)
  if (existing) return { discussion: d, asset: existing }
  const full: AssetInfo = { ...asset, assetId: asset.sha256 }
  return { discussion: { ...d, assets: [...d.assets, full] }, asset: full }
}

function hasContent(doc: RichDoc): boolean {
  const walk = (nodes: RichDoc['content']): boolean =>
    nodes.some((n) => {
      if (n.type === 'text') return n.text.trim().length > 0
      if (n.type === 'image') return true
      if ('content' in n && n.content) return walk(n.content)
      return false
    })
  return walk(doc.content)
}

export function appendMessage(
  ctx: DomainContext,
  d: DiscussionData,
  input: { threadId: string; author: Author; content: RichDoc }
): { discussion: DiscussionData; message: Message } {
  const thread = findThread(d, input.threadId)
  if (!hasContent(input.content)) throw new DomainError('EMPTY_MESSAGE', 'message is empty')
  const assetReferences = collectImageAssetIds(input.content)
  for (const ref of assetReferences) {
    if (!d.assets.some((a) => a.assetId === ref))
      throw new DomainError('UNKNOWN_ASSET', `asset ${ref} is not registered`)
  }
  const message: Message = {
    messageId: ctx.newId(),
    threadId: thread.threadId,
    sequence: thread.messages.length,
    authorId: input.author.participantId,
    authorDisplayName: input.author.displayName,
    createdAt: ctx.now(),
    content: input.content,
    assetReferences
  }
  const withAuthor = ensureParticipant(d, input.author)
  const threads = withAuthor.threads.map((t) =>
    t.threadId === thread.threadId ? { ...t, messages: [...t.messages, message] } : t
  )
  return { discussion: touch(ctx, { ...withAuthor, threads }), message }
}
