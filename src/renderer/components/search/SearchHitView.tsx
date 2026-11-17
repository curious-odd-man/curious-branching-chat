import { texts } from '@shared/i18n'
import type { SearchHit } from '@shared/types/ipc'
import { formatTimestamp } from '../../i18n/format'

/** One result: author, time, branch, and the text around the match with the matches marked (FR-213). */
export function SearchHitView({ hit }: { hit: SearchHit }): React.JSX.Element {
    const parts: React.ReactNode[] = []
    let at = 0
    hit.marks.forEach(([start, end], i) => {
        if (start > at) parts.push(hit.snippet.slice(at, start))
        parts.push(
            <mark key={i} className="search-mark">
                {hit.snippet.slice(start, end)}
            </mark>
        )
        at = end
    })
    if (at < hit.snippet.length) parts.push(hit.snippet.slice(at))
    const where =
        hit.kind === 'branch'
            ? texts().search.branchTitle
            : hit.threadLabel
              ? texts().search.branch(hit.threadLabel)
              : texts().search.main
    return (
        <span className="search-hit">
            <span className="search-meta">
                {hit.authorName && <strong>{hit.authorName}</strong>}{' '}
                {hit.kind === 'message' && (
                    <time dateTime={hit.createdAt}>{formatTimestamp(hit.createdAt)}</time>
                )}{' '}
                <span className="search-where">{where}</span>
            </span>
            <span className="search-snippet">{parts}</span>
        </span>
    )
}
