/**
 * Text for the search index and for search queries (FR-211): lower case and ё → е. FTS5 `unicode61` folds the case of
 * Cyrillic letters, but not ё and е.
 */
export function normalizeSearchText(text: string): string {
    return text.toLowerCase().replace(/ё/g, 'е')
}

/** The words of a search query, normalized (FR-212); each word is searched as the start of a word. */
export function searchWords(query: string): string[] {
    return normalizeSearchText(query)
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length > 0)
        .slice(0, 10)
}

/**
 * The places in `text` where a word starts with one of `words` (both compared normalized), as [start, end) pairs, in
 * order and not overlapping. Used for the text around a match and for the highlight (FR-213).
 */
export function matchRanges(text: string, words: readonly string[]): Array<[number, number]> {
    const norm = normalizeSearchText(text)
    if (norm.length !== text.length || words.length === 0) return []
    const out: Array<[number, number]> = []
    const wordStart = /[\p{L}\p{N}]+/gu
    for (let m = wordStart.exec(norm); m; m = wordStart.exec(norm)) {
        const best = words.filter((w) => m[0].startsWith(w)).sort((a, b) => b.length - a.length)[0]
        if (best) out.push([m.index, m.index + best.length])
    }
    return out
}
