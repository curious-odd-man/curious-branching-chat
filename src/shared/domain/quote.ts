import type { Message } from '../validation/schemas'
import { richTextToPlain } from '../validation/richText'
import { DomainError } from './errors'

export interface QuoteRange {
    start: number
    end: number
}

export interface StoredQuote {
    quoteText?: string
    selectionStart?: number
    selectionEnd?: number
}

/**
 * Where a branch's quoted passage sits in its source message (FR-054, FR-055).
 * The stored range is used when it still matches the quote; otherwise the quote text is searched for (first match);
 * if it cannot be found, there is nothing to highlight and null is returned.
 */
export function resolveQuoteRange(plainText: string, quote: StoredQuote): QuoteRange | null {
    const text = quote.quoteText
    if (!text) return null
    const { selectionStart: start, selectionEnd: end } = quote
    if (start !== undefined && end !== undefined && plainText.slice(start, end) === text)
        return { start, end }
    const index = plainText.indexOf(text)
    return index >= 0 ? { start: index, end: index + text.length } : null
}

/**
 * Validates a selection received from the page against the stored message and returns the quoted text.
 * The quote is always taken from the stored message, never from what the page claims.
 */
export function quoteFromSelection(message: Message, start: number, end: number): string {
    const plain = richTextToPlain(message.content)
    if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        end <= start ||
        end > plain.length
    )
        throw new DomainError('INVALID_SELECTION', 'the selection is outside the message')
    const quote = plain.slice(start, end)
    if (quote.trim().length === 0)
        throw new DomainError('EMPTY_QUOTE', 'a branch needs a non-empty selected passage')
    return quote
}
