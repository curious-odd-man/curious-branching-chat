import { useState } from 'react'
import { texts } from '@shared/i18n'
import { withKeys } from '@shared/shortcuts'
import type { DocumentView } from '@shared/types/ipc'
import type { Message } from '@shared/validation'
import { useApi } from '../../api'
import { formatTimestamp } from '../../i18n/format'
import { RosterDialog, type ReinviteTarget } from '../wizard/SharedWizard'
import { JumpToDateDialog } from './JumpToDateDialog'
import { StatsLine } from './StatsLine'

interface Props {
    view: DocumentView
    today: string
    /** FR-242: the days of the thread, with the first message of each day. */
    days: ReadonlyMap<string, Message>
    /** FR-242: "Перейти к дате…" is open. */
    showJump: boolean
    setShowJump(open: boolean): void
    /** All unread messages of the discussion (FR-110). */
    unreadTotal: number
    onMarkAllRead(): void
    onOpenSearch(): void
    onOpenMap(): void
    /** Shows a message of the current thread (the first message of the chosen day). */
    onShowMessage(messageId: string): void
    onInvite(): void
    onReinvite(target: ReinviteTarget): void
}

/**
 * The header of a discussion: the title, the buttons for search, branch map, jump to date, members and sync check, the
 * save state, and the count of unread messages.
 */
export function DiscussionHeader({
    view,
    today,
    days,
    showJump,
    setShowJump,
    unreadTotal,
    onMarkAllRead,
    onOpenSearch,
    onOpenMap,
    onShowMessage,
    onInvite,
    onReinvite
}: Props): React.JSX.Element {
    const api = useApi()
    const [showRoster, setShowRoster] = useState(false)
    const [checking, setChecking] = useState(false)
    const status = view.saveError
        ? null
        : view.saving
          ? texts().discussion.saving
          : texts().discussion.saved

    return (
        <header className="discussion-header">
            <h1 data-testid="discussion-title">{view.discussion.title}</h1>
            <button
                type="button"
                className="roster-button"
                data-testid="open-search"
                title={withKeys(texts().search.open, 'find')}
                aria-label={texts().search.open}
                onClick={onOpenSearch}
            >
                🔍
            </button>
            <button
                type="button"
                className="roster-button"
                data-testid="open-branch-map"
                title={withKeys(texts().branchMap.button, 'branchMap')}
                aria-label={texts().branchMap.button}
                onClick={onOpenMap}
            >
                🌳
            </button>
            <button
                type="button"
                className="roster-button"
                data-testid="jump-to-date"
                title={withKeys(texts().days.jumpTitle, 'jumpToDate')}
                aria-label={texts().days.jumpTitle}
                onClick={() => setShowJump(true)}
            >
                📅
            </button>
            {view.synced && (
                <button
                    type="button"
                    className="roster-button"
                    data-testid="roster-button"
                    title={texts().shared.rosterTitle}
                    onClick={() => setShowRoster(true)}
                >
                    👥 {view.knownParticipants.length}
                </button>
            )}
            {view.synced && (
                <button
                    type="button"
                    className="roster-button"
                    data-testid="sync-check"
                    title={
                        view.syncStatus?.lastScanAt
                            ? texts().syncStatus.lastScan(
                                  formatTimestamp(view.syncStatus.lastScanAt)
                              )
                            : texts().syncStatus.check
                    }
                    disabled={checking}
                    onClick={() => {
                        setChecking(true)
                        void api.checkSyncNow().finally(() => setChecking(false))
                    }}
                >
                    {checking ? texts().syncStatus.checking : `⟳ ${texts().syncStatus.check}`}
                </button>
            )}
            {showJump && (
                <JumpToDateDialog
                    days={new Set(days.keys())}
                    today={today}
                    onClose={() => setShowJump(false)}
                    onPick={(day) => {
                        setShowJump(false)
                        const message = days.get(day)
                        if (message) onShowMessage(message.messageId)
                    }}
                />
            )}
            {showRoster && (
                <RosterDialog
                    onClose={() => setShowRoster(false)}
                    onInvite={() => {
                        setShowRoster(false)
                        onInvite()
                    }}
                    onReinvite={(target) => {
                        setShowRoster(false)
                        onReinvite(target)
                    }}
                />
            )}
            {status && (
                <span className="status" data-testid="status">
                    {status}
                </span>
            )}
            {unreadTotal > 0 && (
                <span className="unread-total">
                    <span data-testid="unread-total">{texts().unread.total(unreadTotal)}</span>
                    <button type="button" data-testid="mark-all-read" onClick={onMarkAllRead}>
                        {texts().unread.markAll}
                    </button>
                </span>
            )}
            <StatsLine view={view} />
        </header>
    )
}
