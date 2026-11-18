import type { Editor, JSONContent } from '@tiptap/core'
import { useEffect, useRef, type RefObject } from 'react'
import type { Attachment } from '@shared/validation'
import { useApi } from '../../../api'
import { jsonHasContent } from './content'

/**
 * The unsent draft of each thread. The drafts of the threads that are not on screen are parked here, so moving between
 * branches never loses what was typed; at the start they come back from the library (FR-251, also after a restart).
 */
export function useThreadDrafts({
    editor,
    threadId,
    activeThread,
    blocked,
    files,
    onDraftShown
}: {
    editor: Editor | null
    threadId: string
    /** The thread whose draft is in the editor; the editor reads it when the text changes. */
    activeThread: RefObject<string>
    /** No focus in the editor when writing is not possible. */
    blocked: boolean
    files: { current(): Attachment[]; replace(files: Attachment[]): void }
    /** A draft was put in the editor: does it have content? */
    onDraftShown(hasContent: boolean): void
}): void {
    const api = useApi()
    const parked = useRef(new Map<string, { content: JSONContent; files: Attachment[] }>())
    const filesRef = useRef(files)
    filesRef.current = files
    const shownRef = useRef(onDraftShown)
    shownRef.current = onDraftShown

    useEffect(() => {
        if (!editor) return
        let cancelled = false
        void api.getDrafts().then((r) => {
            if (cancelled || !r.ok) return
            for (const [thread, draft] of Object.entries(r.data)) {
                const content = draft.content as JSONContent
                if (thread === activeThread.current) {
                    if (editor.isEmpty && filesRef.current.current().length === 0) {
                        editor.commands.setContent(content, { emitUpdate: false })
                        shownRef.current(jsonHasContent(editor.getJSON()))
                        filesRef.current.replace(draft.attachments)
                        editor.commands.focus('end')
                    }
                } else if (!parked.current.has(thread)) {
                    parked.current.set(thread, { content, files: draft.attachments })
                }
            }
        })
        return () => {
            cancelled = true
        }
    }, [api, editor, activeThread])

    // Switching threads: park the current draft, bring back the draft of the new thread.
    useEffect(() => {
        if (!editor || activeThread.current === threadId) return
        parked.current.set(activeThread.current, {
            content: editor.getJSON(),
            files: filesRef.current.current()
        })
        activeThread.current = threadId
        const next = parked.current.get(threadId)
        parked.current.delete(threadId)
        editor.commands.setContent(next?.content ?? '', { emitUpdate: false })
        filesRef.current.replace(next?.files ?? [])
        shownRef.current(jsonHasContent(editor.getJSON()))
        if (!blocked) editor.commands.focus('end')
    }, [threadId, editor, blocked, activeThread])
}
