import { describe, expect, it } from 'vitest'
import { notificationExcerpt, planNotifications, plainTextToRichDoc } from '@shared/domain'
import type { RichDoc } from '@shared/validation'

const doc = (text: string): RichDoc => plainTextToRichDoc(text)

describe('notification text (D-38)', () => {
    it('joins lines with one space and keeps short text whole', () => {
        expect(notificationExcerpt(doc('Привет!\n\nКак дела?'))).toBe('Привет! Как дела?')
    })

    it('shows images as [изображение]', () => {
        const withImage: RichDoc = {
            type: 'doc',
            content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Смотри:' }] },
                { type: 'image', attrs: { assetId: 'a'.repeat(64) } } as never,
                { type: 'paragraph', content: [{ type: 'text', text: 'красиво' }] }
            ]
        }
        expect(notificationExcerpt(withImage)).toBe('Смотри: [изображение] красиво')
    })

    it('cuts at a word boundary within 100 characters, with "…"', () => {
        const words = Array.from({ length: 40 }, (_, i) => `слово${i}`).join(' ')
        const text = notificationExcerpt(doc(words))
        expect(text.endsWith('…')).toBe(true)
        const body = text.slice(0, -1)
        expect(body.length).toBeLessThanOrEqual(100)
        expect(words.startsWith(body)).toBe(true)
        expect(words[body.length]).toBe(' ') // a whole word
    })

    it('cuts one very long word at the limit', () => {
        const text = notificationExcerpt(doc('я'.repeat(150)))
        expect(text).toBe(`${'я'.repeat(100)}…`)
    })

    it('does not leave a comma before "…"', () => {
        const text = notificationExcerpt(doc(`${'а'.repeat(95)}, бббббббббб`))
        expect(text).toBe(`${'а'.repeat(95)}…`)
    })
})

describe('notification plan (D-33, D-42)', () => {
    const m = (i: number) => ({
        messageId: `m${i}`,
        threadId: 't',
        authorName: 'Борис',
        content: doc(`текст ${i}`)
    })

    it('up to three messages: one notification each, with author, discussion, and text', () => {
        const plan = planNotifications('Отпуск', [m(1), m(2), m(3)], true)
        expect(plan).toEqual([
            { title: 'Борис — Отпуск', body: 'текст 1', messageId: 'm1', threadId: 't' },
            { title: 'Борис — Отпуск', body: 'текст 2', messageId: 'm2', threadId: 't' },
            { title: 'Борис — Отпуск', body: 'текст 3', messageId: 'm3', threadId: 't' }
        ])
    })

    it('more than three: one summary that opens the first message', () => {
        const plan = planNotifications('Отпуск', [m(1), m(2), m(3), m(4)], true)
        expect(plan).toEqual([
            { title: 'Отпуск', body: 'Новых сообщений: 4', messageId: 'm1', threadId: 't' }
        ])
    })

    it('with the text setting off, no message text', () => {
        const [only] = planNotifications('Отпуск', [m(1)], false)
        expect(only?.body).toBe('Новое сообщение')
        expect(only?.title).toBe('Борис — Отпуск')
    })

    it('a message with only an image shows [изображение]; an empty one shows "Новое сообщение"', () => {
        const image = {
            ...m(1),
            content: {
                type: 'doc',
                content: [{ type: 'image', attrs: { assetId: 'b'.repeat(64) } }]
            } as never
        }
        expect(planNotifications('X', [image], true)[0]?.body).toBe('[изображение]')
        expect(planNotifications('X', [{ ...m(2), content: doc('') }], true)[0]?.body).toBe(
            'Новое сообщение'
        )
    })
})
