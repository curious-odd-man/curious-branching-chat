import { useEffect, useRef, useState } from 'react'
import { localDayKey } from '@shared/domain'

/** The local day; checked every minute, so "Сегодня" moves at midnight. */
export function useToday(): string {
    const [today, setToday] = useState(() => localDayKey(new Date().toISOString()))
    useEffect(() => {
        const timer = setInterval(() => setToday(localDayKey(new Date().toISOString())), 60_000)
        return () => clearInterval(timer)
    }, [])
    return today
}

/**
 * A part of the screen that a menu command opens (Ctrl+F, Ctrl+G, Ctrl+Shift+M): each new value of `request` opens it.
 * Only a new value counts: the screen can mount again with the old value, after a jump.
 */
export function useOpenOnRequest(request: number | undefined): [boolean, (open: boolean) => void] {
    const [open, setOpen] = useState(false)
    const handled = useRef(request)
    useEffect(() => {
        if (request === handled.current) return
        handled.current = request
        setOpen(true)
    }, [request])
    return [open, setOpen]
}
