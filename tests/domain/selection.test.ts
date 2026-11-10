import { describe, expect, it } from 'vitest'
import {
    DomainError,
    appendMessage,
    branchLabel,
    branchesBySourceMessage,
    createBranch,
    findMessage,
    groupedForest,
    mainThread,
    quoteFromSelection,
    resolveQuoteRange,
    setThreadStatus
} from '@shared/domain'
import { linearize, richTextToPlain, type RichDoc } from '@shared/validation'
import { anna, boris, buildSample, para, richDoc, simple, text } from '../helpers/fixtures'

const rich: RichDoc = richDoc(
    { type: 'heading', attrs: { level: 2 }, content: [text('Заголовок')] },
    para(
        text('жирный', [{ type: 'bold' }]),
        text(' и '),
        text('курсив', [{ type: 'italic' }]),
        { type: 'hardBreak' },
        text('после')
    ),
    {
        type: 'bulletList',
        content: [
            { type: 'listItem', content: [para(text('один'))] },
            {
                type: 'listItem',
                content: [
                    para(text('два')),
                    {
                        type: 'orderedList',
                        content: [{ type: 'listItem', content: [para(text('вложенный'))] }]
                    }
                ]
            }
        ]
    },
    para(),
    para(text('конец'))
)

describe('linearize: the coordinate system of selections', () => {
    it('every text node sits exactly where the runs say it does', () => {
        const { text: plain, runs } = linearize(rich)
        expect(plain).toBe('Заголовок\nжирный и курсив\nпосле\nодин\nдва\nвложенный\n\nконец')
        expect(runs.length).toBeGreaterThan(5)
        for (const run of runs)
            expect(plain.slice(run.start, run.start + run.node.text.length)).toBe(run.node.text)
    })

    it('richTextToPlain is the same text', () => {
        expect(richTextToPlain(rich)).toBe(linearize(rich).text)
    })

    it('trailing blank blocks do not shift earlier offsets', () => {
        const a = linearize(richDoc(para(text('abc'))))
        const b = linearize(richDoc(para(text('abc')), para(), para()))
        expect(a.runs[0]!.start).toBe(b.runs[0]!.start)
        expect(a.text).toBe(b.text)
    })

    it('counts UTF-16 code units (emoji take two)', () => {
        const { text: plain, runs } = linearize(richDoc(para(text('a🌲б'), text('в'))))
        expect(runs[1]!.start).toBe(4)
        expect(plain.slice(runs[1]!.start)).toBe('в')
    })
})

describe('resolveQuoteRange', () => {
    const plain = 'раз два три два четыре'
    it('uses the stored range when it still matches the quote', () => {
        expect(
            resolveQuoteRange(plain, { quoteText: 'два', selectionStart: 12, selectionEnd: 15 })
        ).toEqual({ start: 12, end: 15 })
    })
    it('falls back to searching for the quote when the range does not match', () => {
        expect(
            resolveQuoteRange(plain, { quoteText: 'два', selectionStart: 0, selectionEnd: 3 })
        ).toEqual({ start: 4, end: 7 })
        expect(resolveQuoteRange(plain, { quoteText: 'три' })).toEqual({ start: 8, end: 11 })
    })
    it('returns null when there is nothing to highlight', () => {
        expect(
            resolveQuoteRange(plain, { quoteText: 'пять', selectionStart: 0, selectionEnd: 4 })
        ).toBeNull()
        expect(resolveQuoteRange(plain, {})).toBeNull()
    })
})

describe('quoteFromSelection takes the quote from the stored message', () => {
    const { contents, ids } = buildSample()
    const message = findMessage(contents.discussion, ids.mainMessages[1]!).message // «Второе сообщение с идеей про ёлку.»
    it('returns the selected text', () => {
        expect(quoteFromSelection(message, 19, 33)).toBe('идеей про ёлку')
    })
    it.each([
        [-1, 5],
        [5, 5],
        [6, 5],
        [0, 9999],
        [1.5, 4]
    ])('rejects the range %d..%d', (s, e) => {
        expect(() => quoteFromSelection(message, s, e)).toThrow(DomainError)
    })
    it('rejects a blank selection', () => {
        expect(() => quoteFromSelection(message, 6, 7)).toThrow(/non-empty/) // a single space
    })
})

describe('closed branches take no new messages', () => {
    it('refuses to append until the branch is reopened', () => {
        const { contents, ctx, ids } = buildSample()
        const closed = setThreadStatus(
            ctx,
            contents.discussion,
            ids.branch1,
            'closed',
            anna.participantId
        )
        expect(() =>
            appendMessage(ctx, closed, {
                threadId: ids.branch1,
                author: anna,
                content: simple('x')
            })
        ).toThrow(/closed/)
        const reopened = setThreadStatus(ctx, closed, ids.branch1, 'open', anna.participantId)
        expect(() =>
            appendMessage(ctx, reopened, {
                threadId: ids.branch1,
                author: anna,
                content: simple('x')
            })
        ).not.toThrow()
    })
    it('a branch can still be created from a message of a closed branch', () => {
        const { contents, ctx, ids } = buildSample()
        const closed = setThreadStatus(
            ctx,
            contents.discussion,
            ids.branch1,
            'closed',
            anna.participantId
        )
        expect(() =>
            createBranch(ctx, closed, {
                sourceMessageId: ids.branch1Messages[0]!,
                quoteText: 'x',
                author: boris
            })
        ).not.toThrow()
    })
})

describe('side panel data', () => {
    it('groups branches by status; a closed parent never hides its open child (FR-064)', () => {
        const { contents, ctx, ids } = buildSample()
        const d = setThreadStatus(
            ctx,
            contents.discussion,
            ids.branch1,
            'closed',
            anna.participantId
        ) // branch2 (child) stays open

        const active = groupedForest(d, 'open')
        expect(active.map((n) => n.thread.threadId)).toEqual([ids.branch2])
        expect(active[0]!.hiddenParent?.threadId).toBe(ids.branch1) // so the panel can say it belongs to branch1

        const closed = groupedForest(d, 'closed')
        expect(closed.map((n) => n.thread.threadId)).toEqual([ids.branch1])
        expect(closed[0]!.children).toEqual([])
    })

    it('nests branches of the same status under their parent', () => {
        const { contents, ids } = buildSample()
        const active = groupedForest(contents.discussion, 'open')
        expect(active.map((n) => n.thread.threadId)).toEqual([ids.branch1])
        expect(active[0]!.children.map((n) => n.thread.threadId)).toEqual([ids.branch2])
        expect(active[0]!.hiddenParent).toBeNull()
        expect(active[0]!.children[0]!.hiddenParent).toBeNull()
    })

    it('lists branches per source message in creation order', () => {
        const { contents, ctx, ids } = buildSample()
        const second = createBranch(ctx, contents.discussion, {
            sourceMessageId: ids.mainMessages[1]!,
            quoteText: 'ещё',
            author: boris
        })
        const map = branchesBySourceMessage(second.discussion)
        expect(map.get(ids.mainMessages[1]!)!.map((t) => t.threadId)).toEqual([
            ids.branch1,
            second.thread.threadId
        ])
        expect(map.get(ids.mainMessages[0]!)).toBeUndefined()
        expect(mainThread(second.discussion).messages).toHaveLength(3)
    })

    it('labels a branch with its title or an excerpt of the quote', () => {
        const { contents, ids } = buildSample()
        const branch = contents.discussion.threads.find((t) => t.threadId === ids.branch1)!
        expect(branchLabel(branch)).toBe('идеей про ёлку')
        expect(branchLabel({ ...branch, title: '  Про ёлку  ' })).toBe('Про ёлку')
        expect(branchLabel({ ...branch, quoteText: 'очень '.repeat(20) })).toMatch(
            /^очень очень.*…$/
        )
        expect(branchLabel({ ...branch, quoteText: '\n\n' })).toBe('…')
    })
})
