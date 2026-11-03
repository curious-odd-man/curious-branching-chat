import { isAllowedLinkHref } from './richText'

/**
 * Turns what a person typed into a link address, or returns null if it is not an allowed link.
 *   "example.com/page"  -> https://example.com/page
 *   "anna@example.com"  -> mailto:anna@example.com
 *   "https://…" / "mailto:…" are kept; "javascript:…", "file:…", "ftp:…" and so on are rejected.
 */
export function normalizeLinkInput(input: string): string | null {
  const text = input.trim()
  if (text.length === 0 || /\s/.test(text)) return null
  let candidate: string
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[^/@:]+:\d+(\/|$)/.test(text)) candidate = text
  else if (text.includes('@') && !text.includes('/')) candidate = `mailto:${text}`
  else candidate = `https://${text}`
  return isAllowedLinkHref(candidate) ? candidate : null
}
