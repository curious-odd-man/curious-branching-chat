import { promises as fs } from 'node:fs'
import { readEntries } from './readFile'
import yazl from 'yazl'

/** Copies a discussion file but marks its manifest with a schema version this build does not know. */
export async function buildNewerCopy(source: string, target: string): Promise<void> {
    const entries = await readEntries(source)
    const manifest = JSON.parse(entries.get('manifest.json')!.toString('utf8'))
    manifest.schemaVersion = 99
    entries.set('manifest.json', Buffer.from(JSON.stringify(manifest)))
    const out = new yazl.ZipFile()
    for (const [name, data] of entries) out.addBuffer(data, name)
    out.end()
    const chunks: Buffer[] = []
    for await (const c of out.outputStream) chunks.push(c as Buffer)
    await fs.writeFile(target, Buffer.concat(chunks))
}
