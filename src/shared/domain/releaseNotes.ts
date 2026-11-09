/** Release notes as electron-updater delivers them: a string (often HTML from GitHub) or a list per version. */
export type RawReleaseNotes =
  string | readonly { version?: string; note?: string | null }[] | null | undefined

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code =
        body[1]?.toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole
    }
    return ENTITIES[body.toLowerCase()] ?? whole
  })
}

/**
 * Turns release notes into plain text for display. Notes come from the internet, so they are never shown as markup:
 * tags are removed (line breaks and list items keep their structure), entities are decoded, and the result is shown
 * as text only.
 */
export function releaseNotesToText(notes: RawReleaseNotes): string | null {
  if (notes === null || notes === undefined) return null
  const raw =
    typeof notes === 'string'
      ? notes
      : notes
          .map((n) => (n.note ? (n.version ? `${n.version}\n${n.note}` : n.note) : ''))
          .filter((s) => s.length > 0)
          .join('\n\n')
  const text = decodeEntities(
    raw
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\/\s*li\s*>\s*(?=<\s*li)/gi, '')
      .replace(/<\s*li[^>]*>/gi, '\n• ')
      .replace(/<\/\s*(ul|ol)\s*>/gi, '\n\n')
      .replace(/<\/\s*(p|div|h[1-6]|tr)\s*>/gi, '\n')
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, '')
      .replace(/<[^>]*>/g, '')
  )
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.length > 0 ? text : null
}
