import { describe, expect, it } from 'vitest'
import { appendMessage, mainThread, matchRanges, searchWords, setThreadTitle } from '@shared/domain'
import { LibraryService, openLibrary, search } from '../../src/main/library'
import { newDocumentContents } from '../../src/main/document'
import { anna, boris, buildSample, makeCtx, simple, withTempDir } from '../helpers/fixtures'

describe('search (FR-211 to FR-215)', () => {
    it('normalizes words: case, ё = е, and word starts', () => {
        expect(searchWords('  ЁЖИК, ёлка!  ')).toEqual(['ежик', 'елка'])
        expect(matchRanges('Ёжика видели у ёлки, а не ежевику', ['ежик'])).toEqual([[0, 4]])
        expect(matchRanges('Ёжика видели у ёлки', ['ел', 'ежика'])).toEqual([
            [0, 5],
            [15, 17]
        ])
    })

    it('finds messages in all branches and branch titles, in one discussion or in all', async () => {
        await withTempDir(async (dir) => {
            const lib = await openLibrary(dir)
            try {
                const service = new LibraryService(lib)
                const s = buildSample()
                const titled = setThreadTitle(
                    s.ctx,
                    s.contents.discussion,
                    s.ids.branch1,
                    'Ёлки и игрушки',
                    anna.participantId
                )
                const sent = appendMessage(s.ctx, titled, {
                    threadId: s.ids.branch2,
                    author: boris,
                    content: simple('Купим ЁЛКУ завтра, а потом ёжика')
                })
                await service.create({ ...s.contents, discussion: sent.discussion })
                const other = newDocumentContents(makeCtx('o'), { title: 'Другое', author: anna })
                const otherD = appendMessage(makeCtx('o2'), other.discussion, {
                    threadId: mainThread(other.discussion).threadId,
                    author: anna,
                    content: simple('Тоже про ёлку')
                }).discussion
                await service.create({ ...other, discussion: otherD })

                const inOne = search(lib.db, 'елк', {
                    discussionId: s.contents.manifest.documentId
                })
                expect(inOne.map((h) => h.kind)).toEqual([
                    'branch',
                    'message',
                    'message',
                    'message'
                ])
                expect(inOne[0]).toMatchObject({
                    threadId: s.ids.branch1,
                    threadLabel: 'Ёлки и игрушки'
                })
                const last = inOne.at(-1)!
                expect(last).toMatchObject({
                    threadId: s.ids.branch2,
                    authorName: 'Борис',
                    messageId: sent.message.messageId
                })
                expect(last.snippet.slice(last.marks[0]![0], last.marks[0]![1])).toBe('ЁЛК')

                const everywhere = search(lib.db, 'ёлку')
                expect(new Set(everywhere.map((h) => h.discussionTitle))).toEqual(
                    new Set(['Тест', 'Другое'])
                )
                expect(search(lib.db, 'ёлку ежика').map((h) => h.messageId)).toEqual([
                    sent.message.messageId
                ])
                expect(search(lib.db, '  ,,  ')).toEqual([])
            } finally {
                lib.close()
            }
        })
    })

    it('shows the first results in less than 0.5 s in a library of 100,000 messages (NFR-201)', async () => {
        await withTempDir(async (dir) => {
            const lib = await openLibrary(dir)
            try {
                const service = new LibraryService(lib)
                const words = [
                    'план',
                    'ёлка',
                    'отпуск',
                    'проект',
                    'встреча',
                    'документ',
                    'бюджет',
                    'задача'
                ]
                for (let n = 0; n < 5; n++) {
                    const ctx = makeCtx(`p${n}`)
                    const c = newDocumentContents(ctx, { title: `Большое ${n}`, author: anna })
                    const main = mainThread(c.discussion).threadId
                    let d = c.discussion
                    for (let i = 0; i < 20_000; i++) {
                        ctx.tick()
                        d = appendMessage(ctx, d, {
                            threadId: main,
                            author: i % 2 ? anna : boris,
                            content: simple(
                                `Сообщение ${i}: ${words[i % words.length]} номер ${i % 97}`
                            )
                        }).discussion
                    }
                    await service.create({ ...c, discussion: d })
                }
                for (const q of ['ёлк', 'бюдж номер', 'встреча']) {
                    const t0 = performance.now()
                    const hits = search(lib.db, q)
                    const ms = performance.now() - t0
                    expect(hits.length).toBeGreaterThan(0)
                    expect(ms).toBeLessThan(500)
                }
                const t0 = performance.now()
                search(lib.db, 'план', { discussionId: lib.repo.list()[0]!.id })
                expect(performance.now() - t0).toBeLessThan(500)
            } finally {
                lib.close()
            }
        })
    }, 300_000)
})
