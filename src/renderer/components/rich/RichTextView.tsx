import { Fragment, useMemo, type ReactNode } from 'react'
import {
  isAllowedLinkHref,
  linearize,
  normalizeColor,
  type RichDoc,
  type RichMark,
  type RichNode
} from '@shared/validation'
import { ru } from '@shared/i18n/ru'

export interface Highlight {
  start: number
  end: number
}

interface Props {
  doc: RichDoc
  /** Called when the user clicks a link. Links are never followed by the page itself. */
  onOpenLink(href: string): void
  /** A passage (offsets in the message's plain text) to mark as the quoted part of a branch (FR-054). */
  highlight?: Highlight | null
}

/**
 * Read-only rendering of a stored message (FR-047, FR-114).
 *
 * The content is built from React elements, never from HTML strings, so message text can never become markup.
 * The data was validated when the file was opened; this component is a second line of defense and ignores anything
 * unexpected (unknown node types, unsafe links, non-plain colors).
 *
 * Every piece of text is in a `<span data-o="N">` where N is the offset of its first character in the message's plain
 * text. That is how a selection in the page is turned into the offsets stored with a branch (see ../selection.ts).
 */
export function RichTextView({ doc, onOpenLink, highlight = null }: Props): React.JSX.Element {
  const offsets = useMemo(
    () => new Map(linearize(doc).runs.map((run) => [run.node, run.start])),
    [doc]
  )
  const ctx: Ctx = { offsets, highlight, onOpenLink }
  return <div className="rich">{doc.content.map((node, i) => renderNode(node, i, ctx))}</div>
}

interface Ctx {
  offsets: Map<RichNode, number>
  highlight: Highlight | null
  onOpenLink(href: string): void
}

function renderNode(node: RichNode, key: number, ctx: Ctx): ReactNode {
  const children = (nodes: RichNode[] | undefined): ReactNode[] =>
    (nodes ?? []).map((child, i) => renderNode(child, i, ctx))

  switch (node.type) {
    case 'text': {
      const start = ctx.offsets.get(node) ?? 0
      return (
        <Fragment key={key}>
          {wrapMarks(segments(node.text, start, ctx.highlight), node.marks ?? [], ctx.onOpenLink)}
        </Fragment>
      )
    }
    case 'hardBreak':
      return <br key={key} />
    case 'paragraph':
      return (
        <p key={key}>{node.content && node.content.length > 0 ? children(node.content) : <br />}</p>
      )
    case 'heading': {
      const level = node.attrs.level
      const Tag = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3'
      return <Tag key={key}>{children(node.content)}</Tag>
    }
    case 'bulletList':
      return <ul key={key}>{children(node.content)}</ul>
    case 'orderedList':
      return <ol key={key}>{children(node.content)}</ol>
    case 'listItem':
      return <li key={key}>{children(node.content)}</li>
    case 'image':
      // Images arrive in phase 6.
      return null
    default:
      return null
  }
}

/** Splits one text node at the edges of the highlighted passage; each piece knows its own offset. */
function segments(text: string, start: number, highlight: Highlight | null): ReactNode[] {
  const end = start + text.length
  if (!highlight || highlight.end <= start || highlight.start >= end)
    return [
      <span key="all" data-o={start}>
        {text}
      </span>
    ]
  const from = Math.max(highlight.start, start) - start
  const to = Math.min(highlight.end, end) - start
  const out: ReactNode[] = []
  if (from > 0)
    out.push(
      <span key="before" data-o={start}>
        {text.slice(0, from)}
      </span>
    )
  out.push(
    <mark key="quote" className="quote">
      <span data-o={start + from}>{text.slice(from, to)}</span>
    </mark>
  )
  if (to < text.length)
    out.push(
      <span key="after" data-o={start + to}>
        {text.slice(to)}
      </span>
    )
  return out
}

function wrapMarks(
  content: ReactNode,
  marks: RichMark[],
  onOpenLink: (href: string) => void
): ReactNode {
  let out: ReactNode = content
  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
        out = <strong>{out}</strong>
        break
      case 'italic':
        out = <em>{out}</em>
        break
      case 'underline':
        out = <u>{out}</u>
        break
      case 'textColor': {
        const color = normalizeColor(mark.attrs.color)
        if (color) out = <span style={{ color }}>{out}</span>
        break
      }
      case 'backgroundColor': {
        const color = normalizeColor(mark.attrs.color)
        if (color)
          out = (
            <span className="bg-mark" style={{ backgroundColor: color }}>
              {out}
            </span>
          )
        break
      }
      case 'link': {
        const href = mark.attrs.href
        if (!isAllowedLinkHref(href)) break
        out = (
          <a
            href={href}
            title={ru.message.linkTitle(href)}
            rel="noopener noreferrer"
            onClick={(event) => {
              event.preventDefault()
              onOpenLink(href)
            }}
            onAuxClick={(event) => event.preventDefault()}
          >
            {out}
          </a>
        )
        break
      }
    }
  }
  return out
}
