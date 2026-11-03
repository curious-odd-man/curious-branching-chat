import { promises as fs } from 'node:fs'
import yazl from 'yazl'

/** Writes a valid discussion with `count` messages straight into a .branchchat file (no application code involved). */
export async function writeBigDiscussion(path: string, count: number): Promise<void> {
  const base = Date.UTC(2026, 0, 1, 9, 0, 0)
  const iso = (i: number): string => new Date(base + i * 60_000).toISOString()
  const people = [
    { participantId: 'p-anna', displayName: 'Анна' },
    { participantId: 'p-boris', displayName: 'Борис' }
  ]
  const messages = Array.from({ length: count }, (_, i) => {
    const author = people[i % 2]!
    const text = { type: 'text', text: `Сообщение номер ${i} — ёж` }
    return {
      messageId: `m-${i}`,
      threadId: 'main',
      sequence: i,
      authorId: author.participantId,
      authorDisplayName: author.displayName,
      createdAt: iso(i),
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: i % 10 === 0 ? [{ ...text, marks: [{ type: 'bold' }] }] : [text]
          }
        ]
      },
      assetReferences: []
    }
  })
  const discussion = {
    title: 'Большое обсуждение',
    createdAt: iso(0),
    updatedAt: iso(count),
    participants: people,
    threads: [
      { threadId: 'main', status: 'open', createdAt: iso(0), createdBy: 'p-anna', messages }
    ],
    assets: []
  }
  const manifest = {
    format: 'branchchat',
    schemaVersion: 1,
    documentId: 'big-doc',
    createdAt: iso(0)
  }

  const zip = new yazl.ZipFile()
  zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json')
  zip.addBuffer(Buffer.from(JSON.stringify(discussion)), 'discussion.json')
  zip.addBuffer(Buffer.from('{}'), 'readstate.json')
  zip.end()
  const chunks: Buffer[] = []
  for await (const chunk of zip.outputStream) chunks.push(chunk as Buffer)
  await fs.writeFile(path, Buffer.concat(chunks))
}
