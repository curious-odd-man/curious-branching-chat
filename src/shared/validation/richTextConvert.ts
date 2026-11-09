import {
    isAllowedLinkHref,
    richDocSchema,
    type RichDoc,
    type RichMark,
    type RichNode
} from './richText'

/**
 * Converts the editor's JSON (TipTap/ProseMirror) into the strict stored format (src/shared/validation/richText.ts).
 *
 * - Unknown attributes are dropped (links keep only `href`; lists keep none).
 * - TipTap's single `textStyle` mark becomes our separate `textColor` and `backgroundColor` marks.
 * - Links whose protocol is not http, https or mailto lose the link (the text stays); invalid colors are dropped.
 * - Trailing empty paragraphs are removed.
 * - Nodes outside the supported subset are an error: the editor is configured so they cannot occur.
 */

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const RGB = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/i

/** Returns a lower-case hex color, or null if the value is not a plain color (no CSS injection possible). */
export function normalizeColor(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const v = value.trim()
    if (HEX.test(v)) return v.toLowerCase()
    const m = RGB.exec(v)
    if (!m) return null
    const channels = [m[1], m[2], m[3]].map((c) => Number(c))
    if (channels.some((c) => c > 255)) return null
    return '#' + channels.map((c) => c.toString(16).padStart(2, '0')).join('')
}

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

function convertMarks(marks: unknown): RichMark[] {
    if (!Array.isArray(marks)) return []
    const out: RichMark[] = []
    const add = (mark: RichMark): void => {
        if (!out.some((m) => m.type === mark.type)) out.push(mark)
    }
    for (const raw of marks) {
        if (!isObject(raw)) continue
        const attrs = isObject(raw['attrs']) ? raw['attrs'] : {}
        switch (raw['type']) {
            case 'bold':
                add({ type: 'bold' })
                break
            case 'italic':
                add({ type: 'italic' })
                break
            case 'underline':
                add({ type: 'underline' })
                break
            case 'link': {
                const href = attrs['href']
                if (typeof href === 'string' && isAllowedLinkHref(href))
                    add({ type: 'link', attrs: { href } })
                break
            }
            case 'textStyle': {
                const color = normalizeColor(attrs['color'])
                const background = normalizeColor(attrs['backgroundColor'])
                if (color) add({ type: 'textColor', attrs: { color } })
                if (background) add({ type: 'backgroundColor', attrs: { color: background } })
                break
            }
            default:
                throw new Error(`unsupported mark: ${String(raw['type'])}`)
        }
    }
    return out
}

function convertChildren(content: unknown): RichNode[] {
    if (content === undefined) return []
    if (!Array.isArray(content)) throw new Error('content must be an array')
    const out: RichNode[] = []
    for (const child of content) {
        const converted = convertNode(child)
        if (converted) out.push(converted)
    }
    return out
}

function convertNode(raw: unknown): RichNode | null {
    if (!isObject(raw)) throw new Error('node must be an object')
    const attrs = isObject(raw['attrs']) ? raw['attrs'] : {}
    switch (raw['type']) {
        case 'text': {
            const text = raw['text']
            if (typeof text !== 'string' || text.length === 0) return null
            const marks = convertMarks(raw['marks'])
            return marks.length > 0 ? { type: 'text', text, marks } : { type: 'text', text }
        }
        case 'hardBreak':
            return { type: 'hardBreak' }
        case 'paragraph': {
            const content = convertChildren(raw['content'])
            return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' }
        }
        case 'heading': {
            const level = attrs['level']
            if (level !== 1 && level !== 2 && level !== 3)
                throw new Error('unsupported heading level')
            const content = convertChildren(raw['content'])
            return content.length > 0
                ? { type: 'heading', attrs: { level }, content }
                : { type: 'heading', attrs: { level } }
        }
        case 'bulletList':
        case 'orderedList':
        case 'listItem':
            return { type: raw['type'], content: convertChildren(raw['content']) }
        case 'image': {
            const assetId = attrs['assetId']
            if (typeof assetId !== 'string' || assetId.length === 0)
                throw new Error('image without assetId')
            return typeof attrs['alt'] === 'string' && attrs['alt'].length > 0
                ? { type: 'image', attrs: { assetId, alt: attrs['alt'] } }
                : { type: 'image', attrs: { assetId } }
        }
        default:
            throw new Error(`unsupported node: ${String(raw['type'])}`)
    }
}

function isEmptyParagraph(node: RichNode): boolean {
    return node.type === 'paragraph' && (!node.content || node.content.length === 0)
}

/** @throws Error if the document contains something outside the supported subset. */
export function sanitizeEditorDoc(json: unknown): RichDoc {
    if (!isObject(json) || json['type'] !== 'doc') throw new Error('not a document')
    const content = convertChildren(json['content'])
    while (content.length > 0 && isEmptyParagraph(content[content.length - 1]!)) content.pop()
    return richDocSchema.parse({ type: 'doc', content })
}

/** True if the document has no text and no image (only formatting or empty paragraphs). */
export function isRichDocBlank(doc: RichDoc): boolean {
    const walk = (nodes: RichNode[]): boolean =>
        nodes.every((n) => {
            if (n.type === 'text') return n.text.trim().length === 0
            if (n.type === 'image') return false
            if ('content' in n && n.content) return walk(n.content)
            return true
        })
    return walk(doc.content)
}
