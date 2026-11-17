import { mergeReactions } from '@shared/domain'
import {
    isLaterStamp,
    normalizeOrder,
    type DiscussionData,
    type DocumentContents,
    type ReadState,
    type Thread
} from '@shared/validation'

export interface MergeResult {
    contents: DocumentContents
    /** Messages of the file that the library did not have. */
    addedMessages: number
    /** False: the file had nothing new; `contents` is the base object. */
    changed: boolean
}

/**
 * Merge on import (ADR-003, Q-03): messages, branches, participants, and images are matched by ID and new ones are
 * added; a message that exists keeps its content. Read marks: union. Branch title and state: the later change stamp
 * wins (`titleSet`, `statusSet`); without a stamp in the file, the library keeps its value. The result is in clock
 * order (`normalizeOrder`), so it passes the same integrity check as a file.
 */
export function mergeDiscussion(base: DocumentContents, incoming: DocumentContents): MergeResult {
    const b = base.discussion
    const f = incoming.discussion
    let addedMessages = 0
    let changed = false

    const participants = [...b.participants]
    const knownPeople = new Set(participants.map((p) => p.participantId))
    for (const p of f.participants)
        if (!knownPeople.has(p.participantId)) {
            participants.push(p)
            changed = true
        }

    const assets = [...b.assets]
    const knownAssets = new Set(assets.map((a) => a.assetId))
    for (const a of f.assets)
        if (!knownAssets.has(a.assetId)) {
            assets.push(a)
            changed = true
        }

    const incomingThreads = new Map(f.threads.map((t) => [t.threadId, t]))
    const threads: Thread[] = b.threads.map((t) => {
        const other = incomingThreads.get(t.threadId)
        if (!other) return t
        incomingThreads.delete(t.threadId)
        let next = t
        // release 2.4: reactions of a message that both have (last change of a person wins), and its files
        const otherById = new Map(other.messages.map((m) => [m.messageId, m]))
        let touchedMessages = false
        const kept = t.messages.map((m) => {
            const o = otherById.get(m.messageId)
            if (!o) return m
            let out = o.reactions ? mergeReactions(m, o) : m
            if (out.attachments === undefined && o.attachments !== undefined)
                out = { ...out, attachments: o.attachments }
            if (out !== m) touchedMessages = true
            return out
        })
        if (touchedMessages) next = { ...next, messages: kept }
        const known = new Set(t.messages.map((m) => m.messageId))
        const fresh = other.messages.filter((m) => !known.has(m.messageId))
        if (fresh.length > 0) {
            next = {
                ...next,
                messages: [...next.messages, ...fresh.map((m) => ({ ...m, threadId: t.threadId }))]
            }
            addedMessages += fresh.length
        }
        if (other.titleSet && (!t.titleSet || isLaterStamp(other.titleSet, t.titleSet))) {
            const { title: _old, ...rest } = next
            next = {
                ...rest,
                ...(other.title !== undefined ? { title: other.title } : {}),
                titleSet: other.titleSet
            }
        }
        if (other.statusSet && (!t.statusSet || isLaterStamp(other.statusSet, t.statusSet)))
            next = { ...next, status: other.status, statusSet: other.statusSet }
        if (next !== t) changed = true
        return next
    })
    for (const t of incomingThreads.values()) {
        threads.push(t)
        addedMessages += t.messages.length
        changed = true
    }

    const readState = unionMarks(base.readState, incoming.readState)
    if (readState !== base.readState) changed = true

    if (!changed) return { contents: base, addedMessages: 0, changed: false }
    const discussion: DiscussionData = normalizeOrder({ ...b, participants, assets, threads })
    return {
        contents: {
            ...base,
            discussion: { ...discussion, updatedAt: laterOf(b.updatedAt, f.updatedAt) },
            readState
        },
        addedMessages,
        changed: true
    }
}

function unionMarks(base: ReadState, incoming: ReadState): ReadState {
    let out: ReadState | null = null
    for (const [p, ids] of Object.entries(incoming)) {
        const have = base[p]
        if (!have) {
            out ??= { ...base }
            out[p] = [...ids]
            continue
        }
        const known = new Set(have)
        const fresh = ids.filter((id) => !known.has(id))
        if (fresh.length === 0) continue
        out ??= { ...base }
        out[p] = [...have, ...fresh]
    }
    return out ?? base
}

function laterOf(a: string, b: string): string {
    return a >= b ? a : b
}
