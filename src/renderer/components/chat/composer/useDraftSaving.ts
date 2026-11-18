import type { JSONContent } from '@tiptap/core'
import { useCallback, useEffect, useRef } from 'react'
import type { Attachment } from '@shared/validation'
import { useApi } from '../../../api'
import { jsonHasContent } from './content'

const SAVE_DELAY_MS = 400

/**
 * FR-251: drafts are saved in the library a moment after the last change, and at once when the main process asks
 * (the window closes or shows another discussion) or the composer goes away.
 */
export function useDraftSaving(): {
    schedule(threadId: string, content: JSONContent, files: Attachment[]): void
} {
    const api = useApi()
    const pending = useRef(new Map<string, { content: JSONContent | null; files: Attachment[] }>())
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const flush = useCallback(async (): Promise<void> => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = null
        const waiting = [...pending.current]
        pending.current.clear()
        await Promise.all(waiting.map(([thread, d]) => api.saveDraft(thread, d.content, d.files)))
    }, [api])

    const schedule = useCallback(
        (threadId: string, content: JSONContent, files: Attachment[]): void => {
            pending.current.set(threadId, {
                content: jsonHasContent(content) || files.length > 0 ? content : null,
                files
            })
            if (timer.current) clearTimeout(timer.current)
            timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS)
        },
        [flush]
    )

    useEffect(
        () =>
            api.onDraftsFlushRequest((token) => {
                void flush().finally(() => void api.draftsFlushed(token))
            }),
        [api, flush]
    )
    useEffect(() => () => void flush(), [flush])

    return { schedule }
}
