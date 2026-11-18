import { useEffect, useMemo, useRef } from 'react'
import { mainThread } from '@shared/domain'
import { zoomKeyOfEvent } from '@shared/shortcuts'
import type { DocumentView, FocusRequest } from '@shared/types/ipc'
import { useApi } from './api'

/** FR-301: zoom keys that did not pass the main process, and Ctrl + mouse wheel (one step per notch). */
export function useZoomInput(): void {
    const api = useApi()
    useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
            const direction = zoomKeyOfEvent(e)
            if (!direction) return
            e.preventDefault()
            void api.zoom(direction)
        }
        let wheel = 0
        const onWheel = (e: WheelEvent): void => {
            if (!e.ctrlKey) return
            e.preventDefault()
            // a touchpad sends many small steps; one step needs 100 units
            wheel += e.deltaY
            if (Math.abs(wheel) < 100) return
            void api.zoom(wheel < 0 ? 'in' : 'out')
            wheel = 0
        }
        window.addEventListener('keydown', onKey, true)
        window.addEventListener('wheel', onWheel, { passive: false })
        return () => {
            window.removeEventListener('keydown', onKey, true)
            window.removeEventListener('wheel', onWheel)
        }
    }, [api])
}

/** A click on a notification (D-33): show that message. The request waits in the main process until this page asks. */
export function useFocusRequests(show: (request: FocusRequest) => void): void {
    const api = useApi()
    const showRef = useRef(show)
    showRef.current = show
    useEffect(() => {
        const pull = (): void =>
            void api.takeFocusRequest().then((r) => {
                if (r.ok && r.data) showRef.current(r.data)
            })
        pull()
        return api.onFocusRequest(pull)
    }, [api])
}

/** Which thread this window shows, and the message to open in it. */
export interface Navigation {
    documentId: string
    threadId: string
    focus?: string
}

/**
 * The thread shown for the discussion: the one asked for, else the one shown last time (FR-224: kept while the window
 * shows another discussion), else the main thread.
 */
export function useActiveThread(
    view: DocumentView | null | undefined,
    nav: Navigation | null
): string | null {
    const lastThread = useRef(new Map<string, string>())
    const active = useMemo(() => {
        if (!view) return null
        const wanted =
            nav?.documentId === view.documentId
                ? nav.threadId
                : lastThread.current.get(view.documentId)
        const exists =
            wanted !== undefined && view.discussion.threads.some((t) => t.threadId === wanted)
        return exists ? wanted : mainThread(view.discussion).threadId
    }, [view, nav])
    useEffect(() => {
        if (view && active) lastThread.current.set(view.documentId, active)
    }, [view, active])
    return active
}
