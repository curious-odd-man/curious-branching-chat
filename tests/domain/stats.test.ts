import { describe, expect, it } from 'vitest'
import { discussionStats, markMessageRead, setThreadStatus } from '@shared/domain'
import type { Attachment } from '@shared/validation'
import { anna, buildSample } from '../helpers/fixtures'

describe('stats of a discussion (2026-11-23)', () => {
    it('counts messages by branch status and by read state of this person', () => {
        const s = buildSample()
        // main: m1 (Anna), m2 (Boris), m3 (Anna); branch 1: b1 (Anna), b2 (Boris); branch 2: empty
        let d = setThreadStatus(
            s.ctx,
            s.contents.discussion,
            s.ids.branch1,
            'closed',
            anna.participantId
        )
        const readState = markMessageRead(d, {}, anna.participantId, s.ids.mainMessages[1]!)
        const stats = discussionStats({
            discussion: d,
            readState,
            localParticipantId: anna.participantId,
            copies: {},
            loadingCount: 0
        })
        expect(stats).toMatchObject({
            messages: 5,
            inOpenBranches: 3,
            inClosedBranches: 2,
            read: 1,
            unread: 1,
            delivered: 3,
            waiting: 0,
            loading: 0,
            fileBytes: 0
        })
        d = s.contents.discussion
        expect(stats.textBytes).toBe(
            d.threads
                .flatMap((t) => t.messages)
                .reduce(
                    (n, m) =>
                        n +
                        new TextEncoder().encode(
                            (m.content.content[0] as { content: Array<{ text: string }> })
                                .content[0]!.text
                        ).length,
                    0
                )
        )
    })

    it('own messages wait while a member has no copy; files are images and attachments', () => {
        const s = buildSample()
        const [m1, , m3] = s.ids.mainMessages
        const file: Attachment = {
            name: 'a.pdf',
            size: 1500,
            type: 'application/pdf',
            sha256: 'a'.repeat(64)
        }
        const d = {
            ...s.contents.discussion,
            assets: [
                {
                    assetId: 'img-1',
                    path: 'assets/img-1.png',
                    mediaType: 'image/png' as const,
                    size: 500,
                    sha256: 'b'.repeat(64)
                }
            ],
            threads: s.contents.discussion.threads.map((t) => ({
                ...t,
                messages: t.messages.map((m) =>
                    m.messageId === m1 ? { ...m, attachments: [file] } : m
                )
            }))
        }
        const stats = discussionStats({
            discussion: d,
            readState: {},
            localParticipantId: anna.participantId,
            copies: {
                [m1!]: { 'p-boris': 'delivered' },
                [m3!]: { 'p-boris': 'written', 'p-clara': 'delivered' }
            },
            loadingCount: 2
        })
        expect(stats).toMatchObject({ delivered: 2, waiting: 1, loading: 2, fileBytes: 2000 })
    })
})
