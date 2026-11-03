import type { RichDoc, RichNode } from '../validation/richText'

/** Turns text typed in a plain box into a rich-text document: one paragraph per line, blank lines preserved. */
export function plainTextToRichDoc(text: string): RichDoc {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\s+$/, '').split('\n')
  const content: RichNode[] = lines.map((line) =>
    line.length > 0
      ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
      : { type: 'paragraph' }
  )
  return { type: 'doc', content }
}
