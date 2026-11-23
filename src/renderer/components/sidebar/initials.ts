/** The letters of the small icon of a discussion: the first letter of the first two words. */
export function initialsOf(title: string): string {
    const words = title.split(/[\s\-_.,:;«»"'()[\]]+/u).filter((w) => /[\p{L}\p{N}]/u.test(w))
    const first = (w: string): string => Array.from(w.replace(/^[^\p{L}\p{N}]+/u, ''))[0] ?? ''
    const letters = words.slice(0, 2).map(first).join('')
    return (letters || Array.from(title.trim())[0] || '?').toLocaleUpperCase()
}

/** A color from the title, the same at each start; dark enough for white letters. */
export function colorOf(title: string): string {
    let hash = 0
    for (const ch of title) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
    return `hsl(${hash % 360} 55% 36%)`
}
