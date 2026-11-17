import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
    appendMessage,
    mainThread,
    reactionCounts,
    safeAttachmentName,
    toggleReaction
} from '@shared/domain'
import type { Attachment, DocumentContents } from '@shared/validation'
import { readDocument, writeDocument } from '../../src/main/document'
import type { DocumentError } from '../../src/main/document/errors'
import { LibraryService, openLibrary, search } from '../../src/main/library'
import { anna, boris, buildSample, buildZip, withTempDir } from '../helpers/fixtures'

function withAttachment(
    c: DocumentContents,
    data: Buffer,
    name = 'отчёт.docx'
): { contents: DocumentContents; attachment: Attachment } {
    const sample = buildSample()
    const attachment: Attachment = {
        name,
        size: data.length,
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sha256: createHash('sha256').update(data).digest('hex')
    }
    const discussion = appendMessage(sample.ctx, c.discussion, {
        threadId: mainThread(c.discussion).threadId,
        author: boris,
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
        attachments: [attachment]
    }).discussion
    return { contents: { ...c, discussion }, attachment }
}

describe('library and file: reactions and attachments', () => {
    it('exports attachments as ZIP entries and imports them into another library (schema version 3)', async () => {
        await withTempDir(async (dir) => {
            const data = Buffer.from('содержимое файла'.repeat(1000))
            const s = buildSample()
            const { contents, attachment } = withAttachment(s.contents, data)
            const reacted = {
                ...contents,
                discussion: toggleReaction(
                    contents.discussion,
                    anna,
                    mainThread(contents.discussion).messages[0]!.messageId,
                    '✅'
                )
            }
            const one = await openLibrary(join(dir, 'one'))
            const two = await openLibrary(join(dir, 'two'))
            try {
                const a = new LibraryService(one)
                await one.repo.storeBlob(attachment.sha256, data, attachment.type)
                await a.create(reacted)
                const file = join(dir, 'x.branchchat')
                await a.exportTo(await a.store(reacted.manifest.documentId).read(), file)
                const loaded = await readDocument(file)
                expect(loaded.contents.manifest.schemaVersion).toBe(3)
                expect(loaded.entryNames).toContain(`attachments/${attachment.sha256}`)

                const b = new LibraryService(two)
                await b.importFile(file)
                const back = await b.store(reacted.manifest.documentId).read()
                const last = mainThread(back.discussion).messages.at(-1)!
                expect(last.attachments).toEqual([attachment])
                expect(two.repo.hasBlob(attachment.sha256)).toBe(true)
                expect((await two.repo.readBlob(attachment.sha256))!.equals(data)).toBe(true)
                expect(
                    reactionCounts(mainThread(back.discussion).messages[0]!, anna.participantId)
                ).toEqual([{ emoji: '✅', by: [anna.participantId], mine: true }])
            } finally {
                one.close()
                two.close()
            }
        })
    })

    it('keeps attachment files from the cleanup while a message or a draft uses them', async () => {
        await withTempDir(async (dir) => {
            const lib = await openLibrary(dir)
            try {
                const data = Buffer.from('a'.repeat(50))
                const draftData = Buffer.from('b'.repeat(50))
                const unused = Buffer.from('c'.repeat(50))
                const s = buildSample()
                const { contents, attachment } = withAttachment(s.contents, data)
                await lib.repo.storeBlob(attachment.sha256, data, attachment.type)
                const hashOf = (d: Buffer) => createHash('sha256').update(d).digest('hex')
                await lib.repo.storeBlob(hashOf(draftData), draftData, '')
                await lib.repo.storeBlob(hashOf(unused), unused, '')
                await new LibraryService(lib).create(contents)
                lib.repo.setDraft(
                    contents.manifest.documentId,
                    s.ids.branch1,
                    '{}',
                    [],
                    [{ name: 'd.txt', size: 50, type: '', sha256: hashOf(draftData) }]
                )
                const removed = await lib.repo.removeUnusedBlobs(0, Date.now() + 1000)
                expect(removed).toBe(1)
                expect(lib.repo.hasBlob(attachment.sha256)).toBe(true)
                expect(lib.repo.hasBlob(hashOf(draftData))).toBe(true)
                expect(lib.repo.hasBlob(hashOf(unused))).toBe(false)
                expect(lib.repo.drafts(contents.manifest.documentId)[0]!.attachments).toHaveLength(
                    1
                )
            } finally {
                lib.close()
            }
        })
    })

    it('merges reactions of the same message on import (the later change of a person wins)', async () => {
        await withTempDir(async (dir) => {
            const lib = await openLibrary(dir)
            try {
                const service = new LibraryService(lib)
                const s = buildSample()
                const id = mainThread(s.contents.discussion).messages[0]!.messageId
                const mine = toggleReaction(s.contents.discussion, anna, id, '👍')
                await service.create({ ...s.contents, discussion: mine })
                // the copy: Boris reacted, Anna never did
                const theirs = toggleReaction(s.contents.discussion, boris, id, '😮')
                const file = join(dir, 'copy.branchchat')
                await writeDocument(
                    file,
                    { ...s.contents, discussion: theirs },
                    {
                        discardExisting: true
                    }
                )
                const r = await service.importFile(file)
                expect(r.status).toBe('merged')
                const merged = await service.store(s.contents.manifest.documentId).read()
                expect(
                    reactionCounts(mainThread(merged.discussion).messages[0]!, anna.participantId)
                ).toEqual([
                    { emoji: '👍', by: [anna.participantId], mine: true },
                    { emoji: '😮', by: [boris.participantId], mine: false }
                ])
            } finally {
                lib.close()
            }
        })
    })

    it('finds a message by the name of its file (FR-214)', async () => {
        await withTempDir(async (dir) => {
            const lib = await openLibrary(dir)
            try {
                const s = buildSample()
                const { contents } = withAttachment(s.contents, Buffer.from('x'), 'Смета ёлки.xlsx')
                await new LibraryService(lib).create(contents)
                const hits = search(lib.db, 'смета елки')
                expect(hits).toHaveLength(1)
                expect(hits[0]!.snippet).toContain('Смета ёлки.xlsx')
            } finally {
                lib.close()
            }
        })
    })

    it('refuses a file of a newer version (FR-016)', async () => {
        await withTempDir(async (dir) => {
            const s = buildSample()
            const file = join(dir, 'new.branchchat')
            await writeDocument(file, s.contents, { discardExisting: true })
            // a version 4 manifest
            const zip = await buildZip([
                {
                    name: 'manifest.json',
                    data: JSON.stringify({ ...s.contents.manifest, schemaVersion: 4 })
                },
                { name: 'discussion.json', data: JSON.stringify(s.contents.discussion) }
            ])
            await fs.writeFile(file, zip)
            await expect(readDocument(file)).rejects.toMatchObject({
                code: 'UNSUPPORTED_VERSION'
            } satisfies Partial<DocumentError>)
        })
    })

    it('makes file names safe (security review of attachments)', () => {
        expect(safeAttachmentName('..\\..\\evil.exe')).toBe('.._.._evil.exe')
        expect(safeAttachmentName('a‮gpj.exe')).toBe('a_gpj.exe')
        expect(safeAttachmentName('con.txt')).toBe('_con.txt')
        expect(safeAttachmentName('name. . ')).toBe('name')
        expect(safeAttachmentName('\u0000\u0001')).toBe('__')
        expect(safeAttachmentName('   ')).toBe('файл')
        const long = safeAttachmentName('x'.repeat(500) + '.pdf')
        expect(long.length).toBe(200)
        expect(long.endsWith('.pdf')).toBe(true)
    })
})
