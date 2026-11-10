import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addAsset, appendMessage, mainThread } from '@shared/domain'
import type { DocumentContents } from '@shared/types'
import {
    DocumentError,
    prepareImage,
    readDocument,
    readImageAsset,
    writeDocument,
    type DocumentErrorCode
} from '../../src/main/document'
import { scanZip } from '../../src/main/document/zip'
import {
    anna,
    boris,
    buildSample,
    buildZip,
    makeCtx,
    para,
    patchName,
    pngBytes,
    richDoc,
    simple,
    withTempDir
} from '../helpers/fixtures'

const jsonOf = (c: DocumentContents) => ({
    manifest: JSON.stringify(c.manifest),
    discussion: JSON.stringify(c.discussion),
    readstate: JSON.stringify(c.readState)
})

async function rejectsWith(
    promise: Promise<unknown>,
    code: DocumentErrorCode
): Promise<DocumentError> {
    try {
        await promise
    } catch (err) {
        expect(err).toBeInstanceOf(DocumentError)
        expect((err as DocumentError).code).toBe(code)
        return err as DocumentError
    }
    throw new Error(`expected DocumentError ${code}, but nothing was thrown`)
}

async function entryNames(path: string): Promise<string[]> {
    const names: string[] = []
    await scanZip(path, (e) => void names.push(e.fileName))
    return names
}

describe('round trip', () => {
    it('writes and reads back an identical discussion (incl. Cyrillic)', async () => {
        await withTempDir(async (dir) => {
            const { contents } = buildSample()
            const file = join(dir, 'тест.branchchat')
            await writeDocument(
                file,
                { ...contents, readState: { 'p-boris': ['id-2'] } },
                { discardExisting: true }
            )
            const loaded = await readDocument(file)
            expect(loaded.contents.discussion).toEqual(contents.discussion)
            expect(loaded.contents.manifest).toEqual(contents.manifest)
            expect(loaded.contents.readState).toEqual({ 'p-boris': ['id-2'] })
            expect(loaded.missingAssetIds).toEqual([])
            expect(await entryNames(file)).toEqual([
                'manifest.json',
                'discussion.json',
                'readstate.json'
            ])
        })
    })

    it('preserves unknown optional fields and unknown ZIP entries (FR-015)', async () => {
        await withTempDir(async (dir) => {
            const { contents } = buildSample()
            const manifest = { ...contents.manifest, futureFlag: { a: 1 } }
            const discussion = structuredClone(contents.discussion) as Record<string, unknown> &
                typeof contents.discussion
            discussion.futureField = 'keep me'
            discussion.threads[0]!.messages[0] = {
                ...discussion.threads[0]!.messages[0]!,
                reaction: '👍'
            }
            const file = join(dir, 'a.branchchat')
            const zip = await buildZip([
                { name: 'manifest.json', data: JSON.stringify(manifest) },
                { name: 'discussion.json', data: JSON.stringify(discussion) },
                { name: 'readstate.json', data: '{}' },
                { name: 'notes/future.txt', data: 'from a newer minor version' }
            ])
            await fs.writeFile(file, zip)

            const loaded = await readDocument(file)
            expect((loaded.contents.manifest as Record<string, unknown>).futureFlag).toEqual({
                a: 1
            })
            expect((loaded.contents.discussion as Record<string, unknown>).futureField).toBe(
                'keep me'
            )

            // modify and save: everything unknown must survive
            const ctx = makeCtx('x')
            const added = appendMessage(ctx, loaded.contents.discussion, {
                threadId: mainThread(loaded.contents.discussion).threadId,
                author: boris,
                content: simple('новое')
            })
            await writeDocument(file, { ...loaded.contents, discussion: added.discussion })
            const again = await readDocument(file)
            expect((again.contents.discussion as Record<string, unknown>).futureField).toBe(
                'keep me'
            )
            expect((again.contents.manifest as Record<string, unknown>).futureFlag).toEqual({
                a: 1
            })
            expect(again.contents.discussion.threads[0]!.messages[0]).toMatchObject({
                reaction: '👍'
            })
            expect(again.contents.discussion.threads[0]!.messages).toHaveLength(4)
            expect(again.entryNames).toContain('notes/future.txt')
        })
    })

    it('treats a missing readstate.json as empty', async () => {
        await withTempDir(async (dir) => {
            const j = jsonOf(buildSample().contents)
            const file = join(dir, 'a.branchchat')
            await fs.writeFile(
                file,
                await buildZip([
                    { name: 'manifest.json', data: j.manifest },
                    { name: 'discussion.json', data: j.discussion }
                ])
            )
            expect((await readDocument(file)).contents.readState).toEqual({})
        })
    })

    it('refuses to open a document from a newer schema version (FR-012)', async () => {
        await withTempDir(async (dir) => {
            const c = buildSample().contents
            const file = join(dir, 'new.branchchat')
            await fs.writeFile(
                file,
                await buildZip([
                    {
                        name: 'manifest.json',
                        data: JSON.stringify({ ...c.manifest, schemaVersion: 99 })
                    },
                    { name: 'discussion.json', data: '{"something":"new"}' }
                ])
            )
            const err = await rejectsWith(readDocument(file), 'UNSUPPORTED_VERSION')
            expect(err.message).toMatch(/newer version/)
        })
    })
})

describe('malformed and malicious files (FR-009, NFR-014)', () => {
    const valid = () => {
        const j = jsonOf(buildSample().contents)
        return [
            { name: 'manifest.json', data: j.manifest },
            { name: 'discussion.json', data: j.discussion },
            { name: 'readstate.json', data: j.readstate }
        ]
    }
    const put = async (dir: string, data: Buffer | string): Promise<string> => {
        const file = join(dir, 'bad.branchchat')
        await fs.writeFile(file, data)
        return file
    }

    it('missing file', async () => {
        await withTempDir(async (dir) => {
            await rejectsWith(readDocument(join(dir, 'nope.branchchat')), 'NOT_FOUND')
        })
    })

    it('not a zip at all', async () => {
        await withTempDir(async (dir) => {
            await rejectsWith(
                readDocument(await put(dir, Buffer.from('this is plain text, not a zip'))),
                'NOT_AN_ARCHIVE'
            )
            await rejectsWith(readDocument(await put(dir, Buffer.alloc(0))), 'NOT_AN_ARCHIVE')
        })
    })

    it('truncated zip', async () => {
        await withTempDir(async (dir) => {
            const zip = await buildZip(valid())
            await rejectsWith(
                readDocument(await put(dir, zip.subarray(0, zip.length >> 1))),
                'NOT_AN_ARCHIVE'
            )
        })
    })

    it('missing manifest / discussion', async () => {
        await withTempDir(async (dir) => {
            const v = valid()
            await rejectsWith(
                readDocument(await put(dir, await buildZip(v.slice(1)))),
                'MISSING_ENTRY'
            )
            await rejectsWith(
                readDocument(await put(dir, await buildZip([v[0]!]))),
                'MISSING_ENTRY'
            )
        })
    })

    it('malformed JSON', async () => {
        await withTempDir(async (dir) => {
            const v = valid()
            v[1] = { name: 'discussion.json', data: '{"title": ' }
            await rejectsWith(readDocument(await put(dir, await buildZip(v))), 'INVALID_JSON')
        })
    })

    it('wrong format name and schema violations', async () => {
        await withTempDir(async (dir) => {
            const v = valid()
            const other = [
                { name: 'manifest.json', data: '{"format":"docx","schemaVersion":1}' },
                v[1]!
            ]
            await rejectsWith(readDocument(await put(dir, await buildZip(other))), 'INVALID_SCHEMA')

            const d = JSON.parse(v[1]!.data as string)
            d.threads[0].messages[0].content = {
                type: 'doc',
                content: [{ type: 'script', src: 'x' }]
            }
            v[1] = { name: 'discussion.json', data: JSON.stringify(d) }
            const err = await rejectsWith(
                readDocument(await put(dir, await buildZip(v))),
                'INVALID_SCHEMA'
            )
            expect(err.details.length).toBeGreaterThan(0)
        })
    })

    it('malicious rich text is rejected: javascript: link', async () => {
        await withTempDir(async (dir) => {
            const v = valid()
            const d = JSON.parse(v[1]!.data as string)
            d.threads[0].messages[0].content = richDoc(
                para({
                    type: 'text',
                    text: 'x',
                    marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]
                })
            )
            v[1] = { name: 'discussion.json', data: JSON.stringify(d) }
            await rejectsWith(readDocument(await put(dir, await buildZip(v))), 'INVALID_SCHEMA')
        })
    })

    it('inconsistent structure (unknown source message)', async () => {
        await withTempDir(async (dir) => {
            const v = valid()
            const d = JSON.parse(v[1]!.data as string)
            d.threads[1].sourceMessageId = 'ghost'
            v[1] = { name: 'discussion.json', data: JSON.stringify(d) }
            const err = await rejectsWith(
                readDocument(await put(dir, await buildZip(v))),
                'INVALID_STRUCTURE'
            )
            expect(err.details.join(' ')).toMatch(/source message/)
        })
    })

    it('zip-slip: entry name with ".." is rejected', async () => {
        await withTempDir(async (dir) => {
            const zip = await buildZip([...valid(), { name: 'assets/xxxx/evil.txt', data: 'pwn' }])
            await rejectsWith(
                readDocument(
                    await put(dir, patchName(zip, 'assets/xxxx/evil.txt', '../../../evil.txtxxx'))
                ),
                'UNSAFE_ENTRY'
            )
        })
    })

    it('absolute and drive-letter entry names are rejected', async () => {
        await withTempDir(async (dir) => {
            const zip = await buildZip([...valid(), { name: 'aaaaaaaaaaaa', data: 'x' }])
            await rejectsWith(
                readDocument(await put(dir, patchName(zip, 'aaaaaaaaaaaa', '/etc/passwd!'))),
                'UNSAFE_ENTRY'
            )
            await rejectsWith(
                readDocument(await put(dir, patchName(zip, 'aaaaaaaaaaaa', 'C:\\evil\\x.tx'))),
                'UNSAFE_ENTRY'
            )
        })
    })

    it('duplicate entry names are rejected', async () => {
        await withTempDir(async (dir) => {
            const zip = await buildZip([...valid(), { name: 'readstate.jsoX', data: '{}' }])
            await rejectsWith(
                readDocument(await put(dir, patchName(zip, 'readstate.jsoX', 'readstate.json'))),
                'DUPLICATE_ENTRY'
            )
        })
    })

    it('entry whose real size differs from the declared size is rejected', async () => {
        await withTempDir(async (dir) => {
            const v = valid()
            const zip = await buildZip([
                { name: 'manifest.json', data: v[0]!.data, compress: false },
                v[1]!,
                v[2]!
            ])
            // central directory header: uncompressed size at offset 24 — make it smaller than the stored data
            const sig = Buffer.from([0x50, 0x4b, 0x01, 0x02])
            const at = zip.indexOf(sig)
            zip.writeUInt32LE(5, at + 24)
            await rejectsWith(readDocument(await put(dir, zip)), 'INVALID_STRUCTURE')
        })
    })
})

describe('images', () => {
    it('embeds, dedupes, round-trips and verifies an image', async () => {
        await withTempDir(async (dir) => {
            const { contents, ctx } = buildSample()
            const img = prepareImage(pngBytes())
            expect(img.path).toMatch(/^assets\/images\/[0-9a-f]{64}\.png$/)

            const reg = addAsset(contents.discussion, {
                path: img.path,
                mediaType: img.mediaType,
                size: img.size,
                sha256: img.sha256
            })
            const msg = appendMessage(ctx, reg.discussion, {
                threadId: mainThread(reg.discussion).threadId,
                author: anna,
                content: richDoc(para({ type: 'image', attrs: { assetId: reg.asset.assetId } }))
            })
            const file = join(dir, 'img.branchchat')
            await writeDocument(
                file,
                { ...contents, discussion: msg.discussion },
                { newAssets: [img, img], discardExisting: true }
            )
            expect((await entryNames(file)).filter((n) => n.startsWith('assets/'))).toEqual([
                img.path
            ]) // stored once

            const loaded = await readDocument(file)
            expect(loaded.missingAssetIds).toEqual([])
            const data = await readImageAsset(file, loaded.contents.discussion.assets[0]!)
            expect(data?.equals(pngBytes())).toBe(true)

            // saving again without new assets keeps the image
            await writeDocument(file, loaded.contents)
            expect((await entryNames(file)).filter((n) => n.startsWith('assets/'))).toEqual([
                img.path
            ])
            expect(
                (await readImageAsset(file, loaded.contents.discussion.assets[0]!))?.equals(
                    pngBytes()
                )
            ).toBe(true)
        })
    })

    it('rejects unsupported image types (including SVG)', () => {
        expect(() =>
            prepareImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))
        ).toThrow(/PNG, JPEG, GIF and WebP/)
        expect(() => prepareImage(Buffer.from('MZ\x90\x00 definitely an exe'))).toThrow(
            DocumentError
        )
    })

    it('a missing asset still opens; it is reported for a placeholder (FR-075)', async () => {
        await withTempDir(async (dir) => {
            const { contents, ctx } = buildSample()
            const img = prepareImage(pngBytes())
            const reg = addAsset(contents.discussion, {
                path: img.path,
                mediaType: img.mediaType,
                size: img.size,
                sha256: img.sha256
            })
            const msg = appendMessage(ctx, reg.discussion, {
                threadId: mainThread(reg.discussion).threadId,
                author: anna,
                content: richDoc(para({ type: 'image', attrs: { assetId: reg.asset.assetId } }))
            })
            const file = join(dir, 'm.branchchat')
            await writeDocument(
                file,
                { ...contents, discussion: msg.discussion },
                { discardExisting: true }
            ) // no asset data written
            const loaded = await readDocument(file)
            expect(loaded.missingAssetIds).toEqual([reg.asset.assetId])
            expect(await readImageAsset(file, loaded.contents.discussion.assets[0]!)).toBeNull()
        })
    })

    it('detects an asset whose bytes do not match its record', async () => {
        await withTempDir(async (dir) => {
            const { contents, ctx } = buildSample()
            const img = prepareImage(pngBytes())
            const reg = addAsset(contents.discussion, {
                path: img.path,
                mediaType: img.mediaType,
                size: img.size,
                sha256: img.sha256
            })
            const msg = appendMessage(ctx, reg.discussion, {
                threadId: mainThread(reg.discussion).threadId,
                author: anna,
                content: richDoc(para({ type: 'image', attrs: { assetId: reg.asset.assetId } }))
            })
            const file = join(dir, 'x.branchchat')
            const j = jsonOf({ ...contents, discussion: msg.discussion })
            await fs.writeFile(
                file,
                await buildZip([
                    { name: 'manifest.json', data: j.manifest },
                    { name: 'discussion.json', data: j.discussion },
                    { name: img.path, data: pngBytes(1), compress: false } // different bytes than recorded
                ])
            )
            const loaded = await readDocument(file)
            await rejectsWith(
                readImageAsset(file, loaded.contents.discussion.assets[0]!),
                'ASSET_MISMATCH'
            )
        })
    })
})

describe('refuses to write bad data', () => {
    it('inconsistent discussion', async () => {
        await withTempDir(async (dir) => {
            const { contents } = buildSample()
            const bad = structuredClone(contents)
            bad.discussion.threads[0]!.messages[0]!.sequence = 9
            await rejectsWith(
                writeDocument(join(dir, 'x.branchchat'), bad, { discardExisting: true }),
                'INVALID_STRUCTURE'
            )
            await expect(fs.access(join(dir, 'x.branchchat'))).rejects.toThrow()
        })
    })

    it('wrong schema version', async () => {
        await withTempDir(async (dir) => {
            const { contents } = buildSample()
            const bad = { ...contents, manifest: { ...contents.manifest, schemaVersion: 1 } }
            await rejectsWith(
                writeDocument(join(dir, 'x.branchchat'), bad, { discardExisting: true }),
                'UNSUPPORTED_VERSION'
            )
        })
    })
})

describe('scale (no artificial limits, NFR-015)', () => {
    it('handles 5,000 messages and several large images', async () => {
        await withTempDir(async (dir) => {
            const { contents } = buildSample()
            const ctx = makeCtx('big')
            let d = contents.discussion
            const main = mainThread(d).threadId
            const messages = Array.from({ length: 5000 }, (_, i) => ({
                i,
                author: i % 2 ? anna : boris
            }))
            for (const m of messages)
                d = appendMessage(ctx, d, {
                    threadId: main,
                    author: m.author,
                    content: simple(`Сообщение номер ${m.i} — ёж`)
                }).discussion

            const images = [1, 2, 3].map((n) => {
                const big = Buffer.concat([pngBytes(), Buffer.alloc(4 * 1024 * 1024, n)]) // ~4 MB each
                return prepareImage(big)
            })
            let withAssets = d
            for (const img of images)
                withAssets = addAsset(withAssets, {
                    path: img.path,
                    mediaType: img.mediaType,
                    size: img.size,
                    sha256: img.sha256
                }).discussion

            const file = join(dir, 'big.branchchat')
            await writeDocument(
                file,
                { ...contents, discussion: withAssets },
                { newAssets: images, discardExisting: true }
            )
            const loaded = await readDocument(file)
            expect(mainThread(loaded.contents.discussion).messages).toHaveLength(5003)

            // a later small change must keep every image intact (copied through, not recompressed)
            const sizeBefore = (await fs.stat(file)).size
            await writeDocument(file, { ...loaded.contents, readState: { 'p-anna': ['x'] } })
            const after = await readDocument(file)
            expect(after.missingAssetIds).toEqual([])
            expect((await fs.stat(file)).size).toBeGreaterThan(sizeBefore - 1024)
            for (const asset of after.contents.discussion.assets)
                expect(await readImageAsset(file, asset)).not.toBeNull()
        })
    }, 60_000)
})
