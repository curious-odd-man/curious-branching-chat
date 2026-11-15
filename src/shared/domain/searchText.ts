/**
 * Text for the search index and for search queries (FR-211): lower case and ё → е. FTS5 `unicode61` folds the case of
 * Cyrillic letters, but not ё and е.
 */
export function normalizeSearchText(text: string): string {
    return text.toLowerCase().replace(/ё/g, 'е')
}
