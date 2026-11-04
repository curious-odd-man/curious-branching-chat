import yauzl from 'yauzl'

/** Minimal independent reader for assertions: returns the parsed JSON entries of a .branchchat file. */
export async function readEntries(path: string): Promise<Map<string, Buffer>> {
  const entries = new Map<string, Buffer>()
  await new Promise<void>((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err)
      zip.on('entry', (entry: yauzl.Entry) => {
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(e)
          const chunks: Buffer[] = []
          stream.on('data', (c: Buffer) => chunks.push(c))
          stream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks))
            zip.readEntry()
          })
        })
      })
      zip.on('end', () => resolve())
      zip.readEntry()
    })
  })
  return entries
}

interface SavedMessage {
  authorId: string
  content: unknown
}
export interface SavedThread {
  threadId: string
  parentThreadId?: string
  sourceMessageId?: string
  quoteText?: string
  selectionStart?: number
  selectionEnd?: number
  title?: string
  status: 'open' | 'closed'
  messages: (SavedMessage & { messageId: string })[]
}
interface SavedDiscussion {
  title: string
  participants: { participantId: string; displayName: string }[]
  threads: SavedThread[]
}

export async function readReadState(path: string): Promise<Record<string, string[]>> {
  const entries = await readEntries(path)
  return JSON.parse(entries.get('readstate.json')!.toString('utf8')) as Record<string, string[]>
}

/** Plain text of a stored message in the offset coordinate system used by branch selections. */
export function plainTextOf(content: unknown): string {
  const parts: string[] = []
  const walk = (node: SavedNode): void => {
    if (node.type === 'text') parts.push(node.text ?? '')
    else if (node.type === 'hardBreak') parts.push('\n')
    else if (node.type === 'paragraph' || node.type === 'heading') {
      node.content?.forEach(walk)
      parts.push('\n')
      return
    }
    node.content?.forEach(walk)
  }
  walk(content as SavedNode)
  return parts.join('').replace(/\n+$/, '')
}

export async function readDiscussionFile(path: string): Promise<{
  discussion: SavedDiscussion
  manifest: { documentId: string; schemaVersion: number }
}> {
  const entries = await readEntries(path)
  return {
    discussion: JSON.parse(entries.get('discussion.json')!.toString('utf8')) as SavedDiscussion,
    manifest: JSON.parse(entries.get('manifest.json')!.toString('utf8')) as {
      documentId: string
      schemaVersion: number
    }
  }
}

export interface SavedMark {
  type: string
  attrs?: Record<string, string>
}
export interface SavedText {
  text: string
  marks: SavedMark[]
}
interface SavedNode {
  type?: string
  text?: string
  marks?: SavedMark[]
  content?: SavedNode[]
}

/** Every text node of a stored message, with its marks (in document order). */
export function textNodes(content: unknown): SavedText[] {
  const out: SavedText[] = []
  const walk = (node: SavedNode): void => {
    if (node.type === 'text') out.push({ text: node.text ?? '', marks: node.marks ?? [] })
    node.content?.forEach(walk)
  }
  walk(content as SavedNode)
  return out
}

/** Node types used anywhere in a stored message. */
export function nodeTypes(content: unknown): Set<string> {
  const types = new Set<string>()
  const walk = (node: SavedNode): void => {
    if (node.type) types.add(node.type)
    node.content?.forEach(walk)
  }
  walk(content as SavedNode)
  return types
}
