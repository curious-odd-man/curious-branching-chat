import { useEffect, useRef, useState } from 'react'
import { branchLabel } from '@shared/domain'
import { ru } from '@shared/i18n/ru'
import type { Thread } from '@shared/types'

interface Props {
    branches: Thread[]
    onOpen(threadId: string): void
}

/** Shows how many branches start from a message (FR-035); opens the branch, or a short list if there are several. */
export function BranchBadge({ branches, onOpen }: Props): React.JSX.Element | null {
    const [open, setOpen] = useState(false)
    const root = useRef<HTMLSpanElement>(null)

    useEffect(() => {
        if (!open) return
        const close = (event: MouseEvent): void => {
            if (!root.current?.contains(event.target as Node)) setOpen(false)
        }
        document.addEventListener('mousedown', close)
        return () => document.removeEventListener('mousedown', close)
    }, [open])

    if (branches.length === 0) return null
    const only = branches.length === 1 ? branches[0] : undefined

    return (
        <span className="branch-badge-wrap" ref={root}>
            <button
                type="button"
                className="branch-badge"
                data-testid="branch-badge"
                title={
                    only
                        ? ru.branches.openBranch(branchLabel(only))
                        : ru.branches.branchCount(branches.length)
                }
                onClick={() => (only ? onOpen(only.threadId) : setOpen(!open))}
            >
                ↳ {branches.length}
            </button>
            {open && (
                <span className="badge-menu" role="menu">
                    {branches.map((thread) => (
                        <button
                            key={thread.threadId}
                            type="button"
                            role="menuitem"
                            data-testid="branch-badge-item"
                            onClick={() => {
                                setOpen(false)
                                onOpen(thread.threadId)
                            }}
                        >
                            {branchLabel(thread)}
                            {thread.status === 'closed' ? ' ✓' : ''}
                        </button>
                    ))}
                </span>
            )}
        </span>
    )
}
