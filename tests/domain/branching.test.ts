import { describe, expect, it } from 'vitest'
import {
    DomainError,
    appendMessage,
    branchCountsByMessage,
    buildHierarchy,
    createBranch,
    findThread,
    groupBranchesByStatus,
    mainThread,
    resolveContext,
    setThreadStatus,
    setThreadTitle,
    addAsset
} from '@shared/domain'
import {
    anna,
    boris,
    buildSample,
    clara,
    makeCtx,
    para,
    richDoc,
    simple
} from '../helpers/fixtures'

describe('messages', () => {
    it('assigns sequence numbers and snapshots the author name (FR-024)', () => {
        const { contents, ctx } = buildSample()
        const main = mainThread(contents.discussion)
        expect(main.messages.map((m) => m.sequence)).toEqual([0, 1, 2])

        const renamed = { ...anna, displayName: 'Анна Н.' }
        const r = appendMessage(ctx, contents.discussion, {
            threadId: main.threadId,
            author: renamed,
            content: simple('x')
        })
        const msgs = mainThread(r.discussion).messages
        expect(msgs[0]!.authorDisplayName).toBe('Анна') // old messages keep the old name
        expect(msgs[3]!.authorDisplayName).toBe('Анна Н.')
        expect(
            r.discussion.participants.find((p) => p.participantId === anna.participantId)
                ?.displayName
        ).toBe('Анна Н.')
    })

    it('adds a participant on first write', () => {
        const { contents, ctx } = buildSample()
        const main = mainThread(contents.discussion)
        const r = appendMessage(ctx, contents.discussion, {
            threadId: main.threadId,
            author: clara,
            content: simple('hi')
        })
        expect(r.discussion.participants.map((p) => p.participantId)).toContain(clara.participantId)
    })

    it('rejects empty messages and unregistered images', () => {
        const { contents, ctx } = buildSample()
        const threadId = mainThread(contents.discussion).threadId
        expect(() =>
            appendMessage(ctx, contents.discussion, {
                threadId,
                author: anna,
                content: richDoc(para())
            })
        ).toThrow(DomainError)
        expect(() =>
            appendMessage(ctx, contents.discussion, {
                threadId,
                author: anna,
                content: richDoc(para({ type: 'image', attrs: { assetId: 'missing' } }))
            })
        ).toThrow(/not registered/)
    })

    it('stores identical images once', () => {
        const { contents } = buildSample()
        const asset = {
            path: `assets/images/${'a'.repeat(64)}.png`,
            mediaType: 'image/png' as const,
            size: 10,
            sha256: 'a'.repeat(64)
        }
        const first = addAsset(contents.discussion, asset)
        const second = addAsset(first.discussion, asset)
        expect(second.discussion.assets).toHaveLength(1)
    })

    it('does not mutate its input', () => {
        const { contents, ctx } = buildSample()
        const before = structuredClone(contents.discussion)
        appendMessage(ctx, contents.discussion, {
            threadId: mainThread(contents.discussion).threadId,
            author: boris,
            content: simple('z')
        })
        expect(contents.discussion).toEqual(before)
    })
})

describe('branches', () => {
    it('stores the source message and quote (FR-051, FR-052)', () => {
        const { contents, ids } = buildSample()
        const branch = findThread(contents.discussion, ids.branch1)
        expect(branch.sourceMessageId).toBe(ids.mainMessages[1])
        expect(branch.quoteText).toBe('идеей про ёлку')
        expect(branch.parentThreadId).toBe(mainThread(contents.discussion).threadId)
        expect(branch.status).toBe('open')
    })

    it('rejects an empty quote and a bad selection', () => {
        const { contents, ctx, ids } = buildSample()
        const base = { sourceMessageId: ids.mainMessages[0]!, author: anna }
        expect(() => createBranch(ctx, contents.discussion, { ...base, quoteText: '   ' })).toThrow(
            /non-empty/
        )
        expect(() =>
            createBranch(ctx, contents.discussion, {
                ...base,
                quoteText: 'x',
                selectionStart: 5,
                selectionEnd: 2
            })
        ).toThrow(DomainError)
        expect(() =>
            createBranch(ctx, contents.discussion, {
                ...base,
                sourceMessageId: 'nope',
                quoteText: 'x'
            })
        ).toThrow(/not found/)
    })

    it('context of the main thread is empty', () => {
        const { contents } = buildSample()
        const c = resolveContext(contents.discussion, mainThread(contents.discussion).threadId)
        expect(c.inherited).toEqual([])
        expect(c.own).toHaveLength(3)
    })

    it('context = parent messages up to and including the source (4.5)', () => {
        const { contents, ids } = buildSample()
        const c = resolveContext(contents.discussion, ids.branch1)
        expect(c.inherited.map((m) => m.messageId)).toEqual([
            ids.mainMessages[0],
            ids.mainMessages[1]
        ]) // m3 excluded
        expect(c.own.map((m) => m.messageId)).toEqual(ids.branch1Messages)
    })

    it('context is recursive through nested branches', () => {
        const { contents, ids } = buildSample()
        const c = resolveContext(contents.discussion, ids.branch2) // from b1, the first message of branch1
        expect(c.inherited.map((m) => m.messageId)).toEqual([
            ids.mainMessages[0],
            ids.mainMessages[1],
            ids.branch1Messages[0] // b2 excluded: it came after the source message
        ])
        expect(c.path.map((t) => t.threadId)).toEqual([
            mainThread(contents.discussion).threadId,
            ids.branch1,
            ids.branch2
        ])
    })

    it('a branch created from inherited context becomes a sibling, not a child (FR-056)', () => {
        const { contents, ctx, ids } = buildSample()
        // m1 is shown inside branch1's inherited context, but it belongs to the main thread.
        const r = createBranch(ctx, contents.discussion, {
            sourceMessageId: ids.mainMessages[0]!,
            quoteText: 'первое',
            author: boris
        })
        expect(r.thread.parentThreadId).toBe(mainThread(contents.discussion).threadId)
        const c = resolveContext(r.discussion, r.thread.threadId)
        expect(c.inherited.map((m) => m.messageId)).toEqual([ids.mainMessages[0]])
    })

    it("sibling branches and later parent messages never leak into another branch's context", () => {
        const { contents, ctx, ids } = buildSample()
        const sibling = createBranch(ctx, contents.discussion, {
            sourceMessageId: ids.mainMessages[0]!,
            quoteText: 'x',
            author: anna
        })
        const c = resolveContext(sibling.discussion, sibling.thread.threadId)
        const all = [...c.inherited, ...c.own].map((m) => m.messageId)
        expect(all).not.toContain(ids.branch1Messages[0])
        expect(all).not.toContain(ids.mainMessages[2])
    })

    it('has no depth limit', () => {
        const ctx = makeCtx('deep') // distinct prefix: ids must not collide with the sample's ids
        const { contents } = buildSample()
        let d = contents.discussion
        let threadId = mainThread(d).threadId
        for (let depth = 0; depth < 200; depth++) {
            const msg = appendMessage(ctx, d, {
                threadId,
                author: anna,
                content: simple(`level ${depth}`)
            })
            d = msg.discussion
            const br = createBranch(ctx, d, {
                sourceMessageId: msg.message.messageId,
                quoteText: 'level',
                author: anna
            })
            d = br.discussion
            threadId = br.thread.threadId
        }
        expect(resolveContext(d, threadId).path).toHaveLength(201)
    })

    it('closes and reopens independently of parent and children (FR-064)', () => {
        const { contents, ctx, ids } = buildSample()
        let d = setThreadStatus(ctx, contents.discussion, ids.branch1, 'closed', anna.participantId)
        expect(findThread(d, ids.branch1).status).toBe('closed')
        expect(findThread(d, ids.branch2).status).toBe('open')
        expect(findThread(d, mainThread(d).threadId).status).toBe('open')
        d = setThreadStatus(ctx, d, ids.branch1, 'open', anna.participantId)
        expect(findThread(d, ids.branch1).status).toBe('open')
        expect(() =>
            setThreadStatus(ctx, d, mainThread(d).threadId, 'closed', anna.participantId)
        ).toThrow(/main thread/)
    })

    it('groups branches into active and closed', () => {
        const { contents, ctx, ids } = buildSample()
        const d = setThreadStatus(
            ctx,
            contents.discussion,
            ids.branch2,
            'closed',
            anna.participantId
        )
        const g = groupBranchesByStatus(d)
        expect(g.active.map((t) => t.threadId)).toEqual([ids.branch1])
        expect(g.closed.map((t) => t.threadId)).toEqual([ids.branch2])
    })

    it('sets and clears titles', () => {
        const { contents, ctx, ids } = buildSample()
        let d = setThreadTitle(
            ctx,
            contents.discussion,
            ids.branch1,
            '  Ёлка  ',
            anna.participantId
        )
        expect(findThread(d, ids.branch1).title).toBe('Ёлка')
        d = setThreadTitle(ctx, d, ids.branch1, '', anna.participantId)
        expect(findThread(d, ids.branch1).title).toBeUndefined()
    })

    it('builds the hierarchy and counts branches per message (FR-035)', () => {
        const { contents, ids } = buildSample()
        const h = buildHierarchy(contents.discussion)
        expect(h.children.map((c) => c.thread.threadId)).toEqual([ids.branch1])
        expect(h.children[0]!.children.map((c) => c.thread.threadId)).toEqual([ids.branch2])
        const counts = branchCountsByMessage(contents.discussion)
        expect(counts.get(ids.mainMessages[1]!)).toBe(1)
        expect(counts.get(ids.branch1Messages[0]!)).toBe(1)
        expect(counts.get(ids.mainMessages[0]!)).toBeUndefined()
    })
})
