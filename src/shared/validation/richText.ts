import {z} from 'zod'

/**
 * Stored rich-text format: a documented subset of the ProseMirror/TipTap JSON document.
 *
 * Nodes:  doc, paragraph, heading (level 1-3), bulletList, orderedList, listItem, image, hardBreak, text
 * Marks:  bold, italic, underline, link (href: http/https/mailto), textColor, backgroundColor
 *
 * Anything outside this subset is rejected on load (never rendered as HTML).
 * Changing this subset requires a schemaVersion change.
 */

export const ALLOWED_LINK_PROTOCOLS = ['http:', 'https:', 'mailto:'] as const

const colorSchema = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'invalid color')

export function isAllowedLinkHref(href: string): boolean {
  try {
    const url = new URL(href)
    return (ALLOWED_LINK_PROTOCOLS as readonly string[]).includes(url.protocol)
  } catch {
    return false
  }
}

const linkHrefSchema = z.string().refine(isAllowedLinkHref, 'link protocol not allowed')

export const markSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bold') }).strict(),
  z.object({ type: z.literal('italic') }).strict(),
  z.object({ type: z.literal('underline') }).strict(),
  z
    .object({ type: z.literal('link'), attrs: z.object({ href: linkHrefSchema }).strict() })
    .strict(),
  z
    .object({ type: z.literal('textColor'), attrs: z.object({ color: colorSchema }).strict() })
    .strict(),
  z
    .object({
      type: z.literal('backgroundColor'),
      attrs: z.object({ color: colorSchema }).strict()
    })
    .strict()
])
export type RichMark = z.infer<typeof markSchema>

export type RichNode =
  | { type: 'text'; text: string; marks?: RichMark[] }
  | { type: 'hardBreak' }
  | { type: 'image'; attrs: { assetId: string; alt?: string } }
  | { type: 'paragraph'; content?: RichNode[] }
  | { type: 'heading'; attrs: { level: 1 | 2 | 3 }; content?: RichNode[] }
  | { type: 'bulletList'; content: RichNode[] }
  | { type: 'orderedList'; content: RichNode[] }
  | { type: 'listItem'; content: RichNode[] }

export interface RichDoc {
  type: 'doc'
  content: RichNode[]
}

const textNode = z
  .object({
    type: z.literal('text'),
    text: z.string().min(1),
    marks: z.array(markSchema).optional()
  })
  .strict()
const hardBreak = z.object({ type: z.literal('hardBreak') }).strict()
const image = z
  .object({
    type: z.literal('image'),
    attrs: z.object({ assetId: z.string().min(1), alt: z.string().optional() }).strict()
  })
  .strict()

export const richNodeSchema: z.ZodType<RichNode> = z.lazy(() =>
  z.union([
    textNode,
    hardBreak,
    image,
    z
      .object({ type: z.literal('paragraph'), content: z.array(richNodeSchema).optional() })
      .strict(),
    z
      .object({
        type: z.literal('heading'),
        attrs: z.object({ level: z.union([z.literal(1), z.literal(2), z.literal(3)]) }).strict(),
        content: z.array(richNodeSchema).optional()
      })
      .strict(),
    z.object({ type: z.literal('bulletList'), content: z.array(richNodeSchema) }).strict(),
    z.object({ type: z.literal('orderedList'), content: z.array(richNodeSchema) }).strict(),
    z.object({ type: z.literal('listItem'), content: z.array(richNodeSchema) }).strict()
  ])
) as z.ZodType<RichNode>

export const richDocSchema: z.ZodType<RichDoc> = z
  .object({ type: z.literal('doc'), content: z.array(richNodeSchema) })
  .strict() as z.ZodType<RichDoc>

/** Plain text of a rich-text document: blocks and list items are separated by newlines. */
export function richTextToPlain(doc: RichDoc): string {
  const parts: string[] = []
  const walk = (n: RichNode): void => {
    switch (n.type) {
      case 'text':
        parts.push(n.text)
        return
      case 'hardBreak':
        parts.push('\n')
        return
      case 'image':
        return
      case 'bulletList':
      case 'orderedList':
      case 'listItem':
        n.content.forEach(walk)
        return
      case 'paragraph':
      case 'heading':
        ;(n.content ?? []).forEach(walk)
        parts.push('\n')
        return
    }
  }
  doc.content.forEach(walk)
  return parts.join('').replace(/\n+$/, '')
}

/** All image asset IDs referenced from a rich-text document, in order, without duplicates. */
export function collectImageAssetIds(doc: RichDoc): string[] {
  const ids: string[] = []
  const walk = (n: RichNode): void => {
    if (n.type === 'image') {
      if (!ids.includes(n.attrs.assetId)) ids.push(n.attrs.assetId)
      return
    }
    if ('content' in n && n.content) n.content.forEach(walk)
  }
  doc.content.forEach(walk)
  return ids
}
