import type { RichDoc, RichNode } from '../validation/richText'
import { ru } from '../i18n/ru'

/** Longest notification text, in characters, before "…" (D-38). */
export const NOTIFICATION_TEXT_MAX = 100

/** More new messages than this in one discussion in one scan give one summary notification (D-42). */
export const NOTIFICATION_SUMMARY_ABOVE = 3

/**
 * The plain text of a message for a notification (D-38): the same text as for quotes, but each image is
 * "[изображение]". Line breaks and runs of spaces become one space. Longer than `max`: cut at a word boundary, with "…".
 */
export function notificationExcerpt(doc: RichDoc | undefined, max = NOTIFICATION_TEXT_MAX): string {
    if (!doc) return ''
    const parts: string[] = []
    const walk = (n: RichNode): void => {
        switch (n.type) {
            case 'text':
                parts.push(n.text)
                return
            case 'hardBreak':
                parts.push(' ')
                return
            case 'image':
                parts.push(` ${ru.notifications.image} `)
                return
            case 'bulletList':
            case 'orderedList':
            case 'listItem':
                n.content.forEach(walk)
                return
            case 'paragraph':
            case 'heading':
                ;(n.content ?? []).forEach(walk)
                parts.push(' ')
                return
        }
    }
    doc.content.forEach(walk)
    const text = parts.join('').replace(/\s+/g, ' ').trim()
    if (text.length <= max) return text
    const head = text.slice(0, max)
    // cut at the last space inside the limit; a single long word is cut at the limit
    const space = head.lastIndexOf(' ')
    const cut = space > 0 ? head.slice(0, space) : head
    return `${cut.replace(/[\s.,;:!?-]+$/, '')}…`
}

export interface NewMessage {
    messageId: string
    threadId: string
    authorName: string
    content?: RichDoc
}

export interface PlannedNotification {
    title: string
    body: string
    /** The message that a click opens. */
    messageId: string
    threadId: string
}

/**
 * The notifications for the new messages of one discussion from one scan (D-33, D-38, D-42). Up to three messages:
 * one notification each. More: one summary that opens the first of them. With `showText` off, no message text.
 */
export function planNotifications(
    discussionName: string,
    messages: readonly NewMessage[],
    showText: boolean
): PlannedNotification[] {
    if (messages.length === 0) return []
    if (messages.length > NOTIFICATION_SUMMARY_ABOVE) {
        const first = messages[0]!
        return [
            {
                title: discussionName,
                body: ru.notifications.summary(messages.length),
                messageId: first.messageId,
                threadId: first.threadId
            }
        ]
    }
    return messages.map((m) => {
        const text = showText ? notificationExcerpt(m.content) : ''
        return {
            title: ru.notifications.title(m.authorName, discussionName),
            body: text.length > 0 ? text : ru.notifications.noText,
            messageId: m.messageId,
            threadId: m.threadId
        }
    })
}
