import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import yazl from 'yazl'

// Small builders for message content (the stored rich-text format).
type Json = Record<string, unknown>
export const t = (text: string, marks?: Json[]): Json => ({
  type: 'text',
  text,
  ...(marks ? { marks } : {})
})
export const bold = { type: 'bold' }
export const italic = { type: 'italic' }
export const link = (href: string): Json => ({ type: 'link', attrs: { href } })
export const p = (...content: Json[]): Json => ({ type: 'paragraph', content })
export const h = (level: 1 | 2 | 3, text: string): Json => ({
  type: 'heading',
  attrs: { level },
  content: [t(text)]
})
export const li = (...content: Json[]): Json => ({ type: 'listItem', content })
export const ul = (...items: Json[]): Json => ({ type: 'bulletList', content: items })
export const img = (assetId: string): Json => ({ type: 'image', attrs: { assetId } })
export const doc = (...content: Json[]): Json => ({ type: 'doc', content })
export const simple = (text: string): Json => doc(p(t(text)))

export type Person = 'anna' | 'boris' | 'clara'

export interface CraftMessage {
  id: string
  author: Person
  content: Json
}
export interface CraftThread {
  id: string
  parent?: string
  source?: string
  quote?: string
  start?: number
  end?: number
  title?: string
  status?: 'open' | 'closed'
  createdBy?: Person
  messages: CraftMessage[]
}

const PEOPLE = {
  anna: { participantId: 'p-anna', displayName: 'Анна' },
  boris: { participantId: 'p-boris', displayName: 'Борис' },
  clara: { participantId: 'p-clara', displayName: 'Клара' }
}

export interface CraftAsset {
  data: Buffer
  /** normal: stored correctly; missing: listed but no data in the file; corrupt: data that does not match its checksum. */
  mode?: 'normal' | 'missing' | 'corrupt'
}

export const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex')

function imageIds(node: unknown, out: string[] = []): string[] {
  if (typeof node !== 'object' || node === null) return out
  const n = node as { type?: string; attrs?: { assetId?: string }; content?: unknown[] }
  if (n.type === 'image' && n.attrs?.assetId && !out.includes(n.attrs.assetId))
    out.push(n.attrs.assetId)
  n.content?.forEach((c) => imageIds(c, out))
  return out
}

export interface CraftOptions {
  /** PNG images embedded in the file; message content refers to them by `sha256(data)`. */
  assets?: CraftAsset[]
  /** Who is listed as a participant (default: Анна and Борис). */
  people?: Person[]
  /** participantId -> IDs of messages that participant has read. */
  readState?: Record<string, string[]>
}

/** Writes a valid discussion file directly (no application code involved). The first thread is the main thread. */
export async function writeDiscussionFile(
  path: string,
  threads: CraftThread[],
  options: CraftOptions = {}
): Promise<void> {
  const base = Date.UTC(2026, 0, 1, 9, 0, 0)
  let tick = 0
  const iso = (): string => new Date(base + tick++ * 60_000).toISOString()
  const created = iso()
  const discussion = {
    title: 'Тестовое обсуждение',
    createdAt: created,
    updatedAt: created,
    participants: (options.people ?? ['anna', 'boris']).map((person) => PEOPLE[person]),
    assets: (options.assets ?? []).map((a) => ({
      assetId: sha256(a.data),
      path: `assets/images/${sha256(a.data)}.png`,
      mediaType: 'image/png',
      size: a.data.length,
      sha256: sha256(a.data)
    })),
    threads: threads.map((th) => ({
      threadId: th.id,
      ...(th.parent ? { parentThreadId: th.parent } : {}),
      ...(th.source ? { sourceMessageId: th.source } : {}),
      ...(th.quote !== undefined ? { quoteText: th.quote } : {}),
      ...(th.start !== undefined ? { selectionStart: th.start } : {}),
      ...(th.end !== undefined ? { selectionEnd: th.end } : {}),
      ...(th.title ? { title: th.title } : {}),
      status: th.status ?? 'open',
      createdAt: iso(),
      createdBy: PEOPLE[th.createdBy ?? 'boris'].participantId,
      messages: th.messages.map((m, sequence) => ({
        messageId: m.id,
        threadId: th.id,
        sequence,
        authorId: PEOPLE[m.author].participantId,
        authorDisplayName: PEOPLE[m.author].displayName,
        createdAt: iso(),
        content: m.content,
        assetReferences: imageIds(m.content)
      }))
    }))
  }
  const manifest = {
    format: 'branchchat',
    schemaVersion: 1,
    documentId: `doc-${Date.now()}`,
    createdAt: created
  }
  const zip = new yazl.ZipFile()
  zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json')
  zip.addBuffer(Buffer.from(JSON.stringify(discussion)), 'discussion.json')
  zip.addBuffer(Buffer.from(JSON.stringify(options.readState ?? {})), 'readstate.json')
  for (const asset of options.assets ?? []) {
    if (asset.mode === 'missing') continue
    const data = asset.mode === 'corrupt' ? Buffer.from(asset.data).reverse() : asset.data
    zip.addBuffer(data, `assets/images/${sha256(asset.data)}.png`, { compress: false })
  }
  zip.end()
  const chunks: Buffer[] = []
  for await (const chunk of zip.outputStream) chunks.push(chunk as Buffer)
  await fs.writeFile(path, Buffer.concat(chunks))
}
