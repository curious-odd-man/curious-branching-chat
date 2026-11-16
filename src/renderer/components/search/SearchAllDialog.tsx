import { useEffect, useMemo, useRef, useState } from 'react'
import { searchWords } from '@shared/domain'
import { ru } from '@shared/i18n/ru'
import type { SearchHit } from '@shared/types/ipc'
import { Modal } from '../Modal'
import { SearchHitView } from './SearchHitView'

interface Props {
    onShow(hit: SearchHit, words: string[]): void
    onClose(): void
}

/** FR-215: Ctrl+Shift+F: all discussions of the library, results grouped by discussion. */
export function SearchAllDialog({ onShow, onClose }: Props): React.JSX.Element {
    const [query, setQuery] = useState('')
    const [hits, setHits] = useState<SearchHit[] | null>(null)
    const seq = useRef(0)

    useEffect(() => {
        const n = ++seq.current
        if (searchWords(query).length === 0) {
            setHits(null)
            return
        }
        const timer = setTimeout(() => {
            void window.branchchat.searchAll(query).then((r) => {
                if (n === seq.current && r.ok) setHits(r.data)
            })
        }, 150)
        return () => clearTimeout(timer)
    }, [query])

    const groups = useMemo(() => {
        const out = new Map<string, { title: string; hits: SearchHit[] }>()
        for (const h of hits ?? []) {
            let g = out.get(h.discussionId)
            if (!g) out.set(h.discussionId, (g = { title: h.discussionTitle, hits: [] }))
            g.hits.push(h)
        }
        return [...out.entries()]
    }, [hits])

    return (
        <Modal labelledBy="search-all-title">
            <div className="dialog wide" data-testid="search-all">
                <h2 id="search-all-title">{ru.search.allTitle}</h2>
                <input
                    autoFocus
                    type="search"
                    data-testid="search-all-input"
                    placeholder={ru.search.allPlaceholder}
                    aria-label={ru.search.allPlaceholder}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') onClose()
                    }}
                />
                <p className="hint">{ru.search.hint}</p>
                {hits && hits.length === 0 && (
                    <p data-testid="search-all-nothing">{ru.search.nothing}</p>
                )}
                <div className="search-groups">
                    {groups.map(([id, g]) => (
                        <section key={id} data-testid="search-group" data-id={id}>
                            <h3>{g.title}</h3>
                            <ul className="search-results">
                                {g.hits.map((hit) => (
                                    <li key={`${hit.kind}:${hit.messageId ?? hit.threadId}`}>
                                        <button
                                            type="button"
                                            className="search-result"
                                            data-testid="search-all-result"
                                            onClick={() => onShow(hit, searchWords(query))}
                                        >
                                            <SearchHitView hit={hit} />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ))}
                </div>
                <div className="buttons">
                    <button type="button" data-testid="search-all-close" onClick={onClose}>
                        {ru.search.close}
                    </button>
                </div>
            </div>
        </Modal>
    )
}
