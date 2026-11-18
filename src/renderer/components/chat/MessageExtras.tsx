import { useEffect, useRef, useState } from 'react'
import { ATTACHMENT_ICONS, attachmentKind, reactionCounts } from '@shared/domain'
import { texts } from '@shared/i18n'
import { REACTION_EMOJI, type Message, type ReactionEmoji } from '@shared/validation'

/** What a message needs for its reactions and files. */
export interface MessageExtrasContext {
    localId: string
    /** Display names by participant ID (for "who reacted", FR-232). */
    names: ReadonlyMap<string, string>
    onToggleReaction(messageId: string, emoji: ReactionEmoji): void
    /** Hashes of files whose bytes are not here. */
    missing: ReadonlySet<string>
    synced: boolean
    /** FR-268a: the own file size limit of the shared folder, in MB. */
    receiveLimitMb: number
    onSave(messageId: string, index: number): void
    onOpen(messageId: string, index: number): void
    onChangeLimit(): void
}

/**
 * FR-231, FR-232: the reactions under a message (emoji and count; the names on mouse-over) and the button that opens
 * the small picker. The button shows on mouse-over and when it has the keyboard focus (Tab); the picker works with the
 * arrow keys, Enter, and Escape.
 */
export function ReactionBar({
    message,
    ctx
}: {
    message: Message
    ctx: MessageExtrasContext
}): React.JSX.Element | null {
    const [open, setOpen] = useState(false)
    const counts = reactionCounts(message, ctx.localId)
    const pickerRef = useRef<HTMLDivElement>(null)
    const buttonRef = useRef<HTMLButtonElement>(null)
    useEffect(() => {
        if (open) pickerRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    }, [open])
    const close = (): void => {
        setOpen(false)
        buttonRef.current?.focus()
    }
    const pick = (emoji: ReactionEmoji): void => {
        ctx.onToggleReaction(message.messageId, emoji)
        close()
    }
    const onPickerKey = (e: React.KeyboardEvent): void => {
        const buttons = [
            ...(pickerRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
        ]
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
        if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            close()
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault()
            const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
            buttons[next]?.focus()
        }
    }
    const nameList = (ids: string[]): string[] => ids.map((id) => ctx.names.get(id) ?? id)
    return (
        <div className="reactions" data-testid="reactions">
            {counts.map((c) => (
                <button
                    key={c.emoji}
                    type="button"
                    className={`reaction${c.mine ? ' mine' : ''}`}
                    data-testid="reaction"
                    data-emoji={c.emoji}
                    aria-pressed={c.mine}
                    aria-label={texts().reactions.count(c.emoji, c.by.length, nameList(c.by))}
                    title={texts().reactions.names(nameList(c.by))}
                    onClick={() => ctx.onToggleReaction(message.messageId, c.emoji)}
                >
                    <span aria-hidden="true">{c.emoji}</span>{' '}
                    <span className="reaction-count">{c.by.length}</span>
                </button>
            ))}
            <span className="reaction-add-wrap">
                <button
                    ref={buttonRef}
                    type="button"
                    className="reaction-add"
                    data-testid="reaction-add"
                    aria-label={texts().reactions.add}
                    title={texts().reactions.add}
                    aria-expanded={open}
                    aria-haspopup="true"
                    onClick={() => setOpen((v) => !v)}
                >
                    ☺+
                </button>
                {open && (
                    <div
                        ref={pickerRef}
                        className="reaction-picker"
                        data-testid="reaction-picker"
                        role="group"
                        aria-label={texts().reactions.picker}
                        onKeyDown={onPickerKey}
                        onBlur={(e) => {
                            if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false)
                        }}
                    >
                        {REACTION_EMOJI.map((emoji) => {
                            const mine = counts.some((c) => c.emoji === emoji && c.mine)
                            return (
                                <button
                                    key={emoji}
                                    type="button"
                                    data-testid="reaction-choice"
                                    data-emoji={emoji}
                                    aria-pressed={mine}
                                    aria-label={texts().reactions.toggle(emoji, mine)}
                                    title={texts().reactions.toggle(emoji, mine)}
                                    onClick={() => pick(emoji)}
                                >
                                    {emoji}
                                </button>
                            )
                        })}
                    </div>
                )}
            </span>
        </div>
    )
}

/** FR-262, FR-268a: the files of a message, with name, size, and icon; or why a file is not here. */
export function AttachmentList({
    message,
    ctx
}: {
    message: Message
    ctx: MessageExtrasContext
}): React.JSX.Element | null {
    const list = message.attachments ?? []
    if (list.length === 0) return null
    return (
        <ul className="attachments" data-testid="attachments" aria-label={texts().attachments.list}>
            {list.map((a, index) => {
                const missing = ctx.missing.has(a.sha256)
                const tooLarge = missing && ctx.synced && a.size > ctx.receiveLimitMb * 1024 * 1024
                return (
                    <li
                        key={`${index}:${a.sha256}`}
                        className={`attachment${missing ? ' missing' : ''}`}
                        data-testid="attachment"
                        data-name={a.name}
                    >
                        <span className="attachment-icon" aria-hidden="true">
                            {ATTACHMENT_ICONS[attachmentKind(a)]}
                        </span>
                        <span className="attachment-name" data-testid="attachment-name">
                            {a.name}
                        </span>
                        <span className="attachment-size">{texts().attachments.size(a.size)}</span>
                        {!missing ? (
                            <span className="attachment-actions">
                                <button
                                    type="button"
                                    data-testid="attachment-open"
                                    onClick={() => ctx.onOpen(message.messageId, index)}
                                >
                                    {texts().attachments.open}
                                </button>
                                <button
                                    type="button"
                                    data-testid="attachment-save"
                                    onClick={() => ctx.onSave(message.messageId, index)}
                                >
                                    {texts().attachments.save}
                                </button>
                            </span>
                        ) : tooLarge ? (
                            <span className="attachment-state" data-testid="attachment-too-large">
                                {texts().attachments.tooLargeForYou(
                                    Math.ceil(a.size / (1024 * 1024))
                                )}{' '}
                                <button
                                    type="button"
                                    className="link-button"
                                    data-testid="attachment-change-limit"
                                    onClick={ctx.onChangeLimit}
                                >
                                    {texts().attachments.changeLimit}
                                </button>
                            </span>
                        ) : (
                            <span
                                className="attachment-state"
                                data-testid={
                                    ctx.synced ? 'attachment-loading' : 'attachment-missing'
                                }
                                title={ctx.synced ? undefined : texts().attachments.missingHint}
                            >
                                {ctx.synced
                                    ? texts().attachments.loading
                                    : texts().attachments.missing}
                            </span>
                        )}
                    </li>
                )
            })}
        </ul>
    )
}
