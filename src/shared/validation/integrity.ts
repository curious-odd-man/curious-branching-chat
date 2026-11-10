import type { DiscussionData } from './schemas'
import { collectImageAssetIds } from './richText'
import { orderProblems } from './order'

/** Cross-reference checks that a plain schema cannot express. Returns a list of problems (empty = valid). */
export function checkDiscussionIntegrity(d: DiscussionData): string[] {
    const problems: string[] = []
    const participantIds = new Set<string>()
    for (const p of d.participants) {
        if (participantIds.has(p.participantId))
            problems.push(`duplicate participant ${p.participantId}`)
        participantIds.add(p.participantId)
    }

    const threadsById = new Map<string, DiscussionData['threads'][number]>()
    for (const t of d.threads) {
        if (threadsById.has(t.threadId)) problems.push(`duplicate thread ${t.threadId}`)
        threadsById.set(t.threadId, t)
    }

    const mains = d.threads.filter((t) => t.parentThreadId === undefined)
    if (mains.length !== 1) problems.push(`expected exactly one main thread, found ${mains.length}`)
    for (const t of d.threads) {
        if (t.parentThreadId === undefined && t.clock !== 0)
            problems.push(`main thread ${t.threadId} must have clock 0`)
        if (t.parentThreadId !== undefined && t.clock === 0)
            problems.push(`branch ${t.threadId} must have a clock above 0`)
    }
    problems.push(...orderProblems(d))

    const assetIds = new Set(d.assets.map((a) => a.assetId))
    const seenMessages = new Set<string>()

    for (const t of d.threads) {
        if (!participantIds.has(t.createdBy)) problems.push(`thread ${t.threadId}: unknown creator`)
        t.messages.forEach((m, index) => {
            if (seenMessages.has(m.messageId)) problems.push(`duplicate message ${m.messageId}`)
            seenMessages.add(m.messageId)
            if (m.threadId !== t.threadId)
                problems.push(`message ${m.messageId}: threadId mismatch`)
            if (m.sequence !== index)
                problems.push(`message ${m.messageId}: sequence ${m.sequence} should be ${index}`)
            if (!participantIds.has(m.authorId))
                problems.push(`message ${m.messageId}: unknown author`)
            for (const assetId of collectImageAssetIds(m.content)) {
                if (!m.assetReferences.includes(assetId))
                    problems.push(`message ${m.messageId}: image ${assetId} not in assetReferences`)
            }
            for (const ref of m.assetReferences) {
                if (!assetIds.has(ref))
                    problems.push(`message ${m.messageId}: unknown asset ${ref}`)
            }
        })
    }

    for (const t of d.threads) {
        if (t.parentThreadId === undefined) {
            if (t.sourceMessageId !== undefined)
                problems.push(`main thread ${t.threadId} has a source message`)
            continue
        }
        const parent = threadsById.get(t.parentThreadId)
        if (!parent) {
            problems.push(`thread ${t.threadId}: unknown parent ${t.parentThreadId}`)
            continue
        }
        if (t.sourceMessageId === undefined) {
            problems.push(`branch ${t.threadId}: missing sourceMessageId`)
        } else if (!parent.messages.some((m) => m.messageId === t.sourceMessageId)) {
            problems.push(`branch ${t.threadId}: source message not in parent thread`)
        }
        if (t.quoteText === undefined || t.quoteText.length === 0)
            problems.push(`branch ${t.threadId}: missing quoteText`)
        if (
            t.selectionStart !== undefined &&
            t.selectionEnd !== undefined &&
            t.selectionEnd < t.selectionStart
        )
            problems.push(`branch ${t.threadId}: selectionEnd before selectionStart`)
    }

    for (const t of d.threads) {
        const seen = new Set<string>()
        let cur: string | undefined = t.threadId
        while (cur !== undefined) {
            if (seen.has(cur)) {
                problems.push(`cycle in thread hierarchy at ${t.threadId}`)
                break
            }
            seen.add(cur)
            cur = threadsById.get(cur)?.parentThreadId
        }
    }
    return problems
}
