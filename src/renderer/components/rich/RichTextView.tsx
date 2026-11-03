import type { ReactNode } from 'react'
import {
  isAllowedLinkHref,
  normalizeColor,
  type RichDoc,
  type RichMark,
  type RichNode
} from '@shared/validation'
import { ru } from '@shared/i18n/ru'

interface Props {
  doc: RichDoc
  /** Called when the user clicks a link. Links are never followed by the page itself. */
  onOpenLink(href: string): void
}

/**
 * Read-only rendering of a stored message (FR-047, FR-114).
 *
 * The content is built from React elements, never from HTML strings, so message text can never become markup.
 * The data was validated when the file was opened; this component is a second line of defense and ignores anything
 * unexpected (unknown node types, unsafe links, non-plain colors).
 */
export function RichTextView({ doc, onOpenLink }: Props): React.JSX.Element {
  return <div className="rich">{doc.content.map((node, i) => renderNode(node, i, onOpenLink))}</div>
}

function renderNode(node: RichNode, key: number, onOpenLink: (href: string) => void): ReactNode {
  const children = (nodes: RichNode[] | undefined): ReactNode[] =>
    (nodes ?? []).map((child, i) => renderNode(child, i, onOpenLink))

  switch (node.type) {
    case 'text':
      return <span key={key}>{wrapMarks(node.text, node.marks ?? [], onOpenLink)}</span>
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

function wrapMarks(text: string, marks: RichMark[], onOpenLink: (href: string) => void): ReactNode {
  let out: ReactNode = text
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
