import { useEffect, useRef, useState } from 'react'
import { searchWords } from '@shared/domain'
import { texts } from '@shared/i18n'
import { withKeys } from '@shared/shortcuts'
import type { SearchHit } from '@shared/types/ipc'
import { SearchHitView } from './SearchHitView'

interface Props {
    /** Opens the branch and shows the message (or only the branch for a branch title). */
    onShow(hit: SearchHit, words: string[]): void
    onClose(): void
}

/** FR-211 to FR-213: Ctrl+F in a discussion; Enter and Shift+Enter (or the arrows) go to the next and previous result. */
export function SearchBar({ onShow, onClose }: Props): React.JSX.Element {
    const [query, setQuery] = useState('')
    const [hits, setHits] = useState<SearchHit[] | null>(null)
    const [current, setCurrent] = useState(-1)
    const seq = useRef(0)
    const input = useRef<HTMLInputElement>(null)

    useEffect(() => {
        const n = ++seq.current
        if (searchWords(query).length === 0) {
            setHits(null)
            setCurrent(-1)
            return
        }
        const timer = setTimeout(() => {
            void window.branchchat.searchDiscussion(query).then((r) => {
                if (n !== seq.current || !r.ok) return
                setHits(r.data)
                setCurrent(-1)
            })
        }, 150)
        return () => clearTimeout(timer)
    }, [query])

    const go = (index: number): void => {
        if (!hits || hits.length === 0) return
        const i = (index + hits.length) % hits.length
        setCurrent(i)
        onShow(hits[i]!, searchWords(query))
    }

    return (
        <div className="search-bar" data-testid="search-bar" role="search">
            <div className="search-row">
                <input
                    ref={input}
                    autoFocus
                    type="search"
                    data-testid="search-input"
                    placeholder={texts().search.placeholder}
                    aria-label={texts().search.placeholder}
                    title={texts().search.hint}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault()
                            go(e.shiftKey ? current - 1 : current + 1)
                        } else if (e.key === 'ArrowDown') {
                            e.preventDefault()
                            go(current + 1)
                        } else if (e.key === 'ArrowUp') {
                            e.preventDefault()
                            go(current - 1)
                        } else if (e.key === 'Escape') onClose()
                    }}
                />
                <span className="search-count" data-testid="search-count">
                    {hits === null
                        ? ''
                        : hits.length === 0
                          ? texts().search.nothing
                          : texts().search.count(current + 1, hits.length)}
                </span>
                <button
                    type="button"
                    data-testid="search-previous"
                    title={withKeys(texts().search.previous, 'findPrevious')}
                    aria-label={texts().search.previous}
                    disabled={!hits?.length}
                    onClick={() => go(current - 1)}
                >
                    ↑
                </button>
                <button
                    type="button"
                    data-testid="search-next"
                    title={withKeys(texts().search.next, 'findNext')}
                    aria-label={texts().search.next}
                    disabled={!hits?.length}
                    onClick={() => go(current + 1)}
                >
                    ↓
                </button>
                <button
                    type="button"
                    data-testid="search-close"
                    aria-label={texts().search.close}
                    onClick={onClose}
                >
                    ×
                </button>
            </div>
            {hits && hits.length > 0 && (
                <ul className="search-results" data-testid="search-results">
                    {hits.map((hit, i) => (
                        <li key={`${hit.kind}:${hit.messageId ?? hit.threadId}`}>
                            <button
                                type="button"
                                className={
                                    i === current ? 'search-result current' : 'search-result'
                                }
                                data-testid="search-result"
                                aria-current={i === current ? 'true' : undefined}
                                onClick={() => go(i)}
                            >
                                <SearchHitView hit={hit} />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
