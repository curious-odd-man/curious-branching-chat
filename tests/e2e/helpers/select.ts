import type { Locator } from '@playwright/test'

/**
 * Selects text inside a message the way a person drags the mouse: from the first occurrence of `from` to the end of
 * the first occurrence of `to` after it (default: just `from`). Works on the visible text only, so it is independent of
 * how the application maps selections. Finishes with a mouse-up, which is when the application looks at the selection.
 */
export async function selectText(
    message: Locator,
    from: string,
    to: string = from
): Promise<string> {
    return message.locator('.rich').evaluate(
        (root, { from, to }) => {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
            const nodes: Text[] = []
            for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text)
            const startNode = nodes.find((n) => n.data.includes(from))
            if (!startNode) throw new Error(`text not found: ${from}`)
            const startIdx = startNode.data.indexOf(from)
            let endNode: Text | undefined
            let endIdx = -1
            for (const node of nodes.slice(nodes.indexOf(startNode))) {
                const searchFrom = node === startNode ? (to === from ? startIdx : startIdx + 1) : 0
                const idx = node.data.indexOf(to, searchFrom)
                if (idx >= 0) {
                    endNode = node
                    endIdx = idx + to.length
                    break
                }
            }
            if (!endNode) throw new Error(`end text not found: ${to}`)
            const range = document.createRange()
            range.setStart(startNode, startIdx)
            range.setEnd(endNode, endIdx)
            const selection = window.getSelection()!
            selection.removeAllRanges()
            selection.addRange(range)
            document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
            return range.toString()
        },
        { from, to }
    )
}
