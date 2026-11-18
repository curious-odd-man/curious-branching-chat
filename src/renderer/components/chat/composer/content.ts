import { texts } from '@shared/i18n'
import type { AttachResult, SmallLimit } from '@shared/types/ipc'
import { MAX_ATTACHMENTS_PER_MESSAGE, type RichDoc } from '@shared/validation'

export const EMPTY_DOC: RichDoc = { type: 'doc', content: [{ type: 'paragraph' }] }

/** True if an editor document has visible text or an image: something worth sending (or losing). */
export function jsonHasContent(node: unknown): boolean {
    if (typeof node !== 'object' || node === null) return false
    const n = node as { type?: unknown; text?: unknown; content?: unknown }
    if (n.type === 'image') return true
    if (typeof n.text === 'string' && n.text.trim().length > 0) return true
    return Array.isArray(n.content) && n.content.some(jsonHasContent)
}

const IMAGE_NAME = /\.(png|jpe?g|gif|webp|bmp|svg|tiff?|ico|avif|heic)$/i
/** Files that look like pictures; unsupported kinds (SVG, BMP, ...) are still taken so the person is told why not. */
export const isImageFile = (file: File): boolean =>
    file.type.startsWith('image/') || IMAGE_NAME.test(file.name)

/** The text of the refused files of an attach (FR-265: the limit is named). */
export function refusedText(r: AttachResult): string | null {
    const lines: string[] = []
    const big = r.refused.filter((x) => x.reason === 'too-large').map((x) => x.name)
    const bad = r.refused.filter((x) => x.reason === 'unreadable').map((x) => x.name)
    if (big.length > 0) lines.push(texts().attachments.tooLarge(big.join(', '), r.limitMb))
    if (bad.length > 0) lines.push(texts().attachments.unreadable(bad.join(', ')))
    if (r.refused.some((x) => x.reason === 'too-many'))
        lines.push(texts().attachments.tooMany(MAX_ATTACHMENTS_PER_MESSAGE))
    return lines.length > 0 ? lines.join(' ') : null
}

/** FR-268: the members with a smaller limit, grouped by limit, smallest first. */
export function groupLimits(limits: readonly SmallLimit[]): Array<{ mb: number; names: string[] }> {
    const by = new Map<number, string[]>()
    for (const l of limits) by.set(l.maxFileMb, [...(by.get(l.maxFileMb) ?? []), l.displayName])
    return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([mb, names]) => ({ mb, names }))
}
