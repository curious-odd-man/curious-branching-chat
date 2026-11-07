import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yazl from 'yazl'
import { randomUUID } from 'node:crypto'
import { appendMessage, createBranch, type Author, type DomainContext } from '@shared/domain'
import type { DocumentContents, RichDoc, RichNode } from '@shared/types'
import { newDocumentContents } from '../../src/main/document/factory'

/** Deterministic clock and ids so tests are repeatable. */
export function makeCtx(prefix = 'id'): DomainContext & { tick(): void } {
  let n = 0
  let t = Date.UTC(2026, 10, 2, 10, 0, 0)
  return {
    now: () => new Date(t).toISOString(),
    newId: () => `${prefix}-${++n}`,
    tick: () => {
      t += 60_000
    }
  }
}

export const anna: Author = { participantId: 'p-anna', displayName: 'Анна' }
export const boris: Author = { participantId: 'p-boris', displayName: 'Борис' }
export const clara: Author = { participantId: 'p-clara', displayName: 'Clara' }

export const text = (t: string, marks?: Extract<RichNode, { type: 'text' }>['marks']): RichNode =>
  marks ? { type: 'text', text: t, marks } : { type: 'text', text: t }
export const para = (...content: RichNode[]): RichNode => ({ type: 'paragraph', content })
export const richDoc = (...content: RichNode[]): RichDoc => ({ type: 'doc', content })
export const simple = (t: string): RichDoc => richDoc(para(text(t)))

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'branchchat-test-'))
  try {
    return await fn(dir)
  } finally {
    // retried: on Windows a file can stay locked for a moment after it was closed; never fail a test over cleanup
    await rm(dir, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 }).catch(
      () => undefined
    )
  }
}

/** A 1x1 PNG with a random-ish payload so each call can produce a distinct image. */
export function pngBytes(extra = 0): Buffer {
  const base = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  )
  return extra === 0 ? base : Buffer.concat([base, Buffer.from(`pad-${extra}`)])
}

export interface Sample {
  contents: DocumentContents
  ctx: ReturnType<typeof makeCtx>
  ids: { mainMessages: string[]; branch1: string; branch1Messages: string[]; branch2: string }
}

/** main: m1, m2, m3 (Anna/Boris/Anna); branch1 from m2 with b1, b2; branch2 (nested) from b1. */
export function buildSample(): Sample {
  const ctx = makeCtx()
  const contents = newDocumentContents(ctx, { title: 'Тест', author: anna })
  let d = contents.discussion
  const main = d.threads[0]!.threadId

  const post = (threadId: string, author: Author, t: string): string => {
    ctx.tick()
    const r = appendMessage(ctx, d, { threadId, author, content: simple(t) })
    d = r.discussion
    return r.message.messageId
  }

  const m1 = post(main, anna, 'Привет, это первое сообщение.')
  const m2 = post(main, boris, 'Второе сообщение с идеей про ёлку.')
  const m3 = post(main, anna, 'Третье сообщение.')

  ctx.tick()
  const br1 = createBranch(ctx, d, {
    sourceMessageId: m2,
    quoteText: 'идеей про ёлку',
    selectionStart: 19,
    selectionEnd: 33,
    author: anna
  })
  d = br1.discussion
  const b1 = post(br1.thread.threadId, anna, 'Что именно про ёлку?')
  const b2 = post(br1.thread.threadId, boris, 'Где поставить.')

  ctx.tick()
  const br2 = createBranch(ctx, d, { sourceMessageId: b1, quoteText: 'про ёлку', author: boris })
  d = br2.discussion

  return {
    contents: { ...contents, discussion: d },
    ctx,
    ids: {
      mainMessages: [m1, m2, m3],
      branch1: br1.thread.threadId,
      branch1Messages: [b1, b2],
      branch2: br2.thread.threadId
    }
  }
}

export interface ZipEntry {
  name: string
  data: Buffer | string
  compress?: boolean
}

/** Builds a ZIP in memory (for hand-crafted malformed fixtures). */
export function buildZip(entries: ZipEntry[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile()
    const chunks: Buffer[] = []
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c))
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
    zip.outputStream.on('error', reject)
    for (const e of entries)
      zip.addBuffer(Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data), e.name, {
        compress: e.compress ?? true,
        mtime: new Date(Date.UTC(2026, 0, 1))
      })
    zip.end()
  })
}

/** Replaces every occurrence of `from` with `to` (same length) — used to forge unsafe entry names. */
export function patchName(buf: Buffer, from: string, to: string): Buffer {
  if (from.length !== to.length) throw new Error('patchName needs equal lengths')
  const out = Buffer.from(buf)
  const needle = Buffer.from(from)
  for (let i = out.indexOf(needle); i !== -1; i = out.indexOf(needle, i + 1))
    Buffer.from(to).copy(out, i)
  return out
}

export const uuid = (): string => randomUUID()
