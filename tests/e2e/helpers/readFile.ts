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
}
interface SavedDiscussion {
  title: string
  participants: { participantId: string; displayName: string }[]
  threads: { messages: SavedMessage[] }[]
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
