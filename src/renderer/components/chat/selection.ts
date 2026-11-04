/**
 * Turns the selection in the page into a passage of a message, expressed as offsets in the message's plain text
 * (the coordinate system of `linearize`, see src/shared/validation/richText.ts).
 *
 * Every piece of message text is rendered as `<span data-o="N">`; N is its offset. A selection edge inside such text
 * maps directly; an edge on an element boundary (for example "the start of the next paragraph") moves to the nearest
 * text inside the selection, so selections never include line breaks at their ends.
 */
export interface MessageSelection {
  messageId: string
  start: number
  end: number
  /** Where the selection is on screen, to place the "Reply to this" button. */
  rect: DOMRect
}

function elementOf(node: Node): Element | null {
  return node instanceof Element ? node : node.parentElement
}

function textOf(span: Element): Text | null {
  const first = span.firstChild
  return first instanceof Text ? first : null
}

function boundaryOffset(
  spans: Element[],
  container: Node,
  offset: number,
  edge: 'start' | 'end'
): number | null {
  // Inside a piece of text: direct.
  if (container instanceof Text) {
    const span = container.parentElement?.closest('[data-o]')
    if (span && textOf(span) === container) return Number(span.getAttribute('data-o')) + offset
  }
  // On an element boundary (or in text outside the message body): nearest text on the inner side.
  const probe = document.createRange()
  probe.setStart(container, offset)
  probe.collapse(true)
  if (edge === 'start') {
    for (const span of spans) {
      const text = textOf(span)
      if (text && probe.comparePoint(text, 0) >= 0) return Number(span.getAttribute('data-o'))
    }
    return null
  }
  for (let i = spans.length - 1; i >= 0; i--) {
    const span = spans[i]!
    const text = textOf(span)
    if (text && probe.comparePoint(text, text.length) <= 0)
      return Number(span.getAttribute('data-o')) + text.length
  }
  return null
}

/** The current selection if it lies within one message of `root`; otherwise null. */
export function readMessageSelection(root: HTMLElement): MessageSelection | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)

  const startArticle = elementOf(range.startContainer)?.closest('[data-message-id]') ?? null
  const endArticle = elementOf(range.endContainer)?.closest('[data-message-id]') ?? null
  if (!startArticle || startArticle !== endArticle || !root.contains(startArticle)) return null
  const messageId = startArticle.getAttribute('data-message-id')
  const body = startArticle.querySelector('.rich')
  if (!messageId || !body) return null

  const spans = Array.from(body.querySelectorAll('[data-o]'))
  const start = boundaryOffset(spans, range.startContainer, range.startOffset, 'start')
  const end = boundaryOffset(spans, range.endContainer, range.endOffset, 'end')
  if (start === null || end === null || end <= start) return null
  return { messageId, start, end, rect: range.getBoundingClientRect() }
}
