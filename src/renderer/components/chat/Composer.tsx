import type { JSONContent } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import { texts } from '@shared/i18n'
import { keysOf } from '@shared/shortcuts'
import { assetUrl } from '@shared/types/assets'
import {
    MAX_ATTACHMENTS_PER_MESSAGE,
    isRichDocBlank,
    sanitizeEditorDoc,
    type Attachment,
    type RichDoc
} from '@shared/validation'
import { ATTACHMENT_ICONS, attachmentKind } from '@shared/domain'
import type { AttachResult, SmallLimit } from '@shared/types/ipc'
import { DISCUSSION_EXTENSION } from '@shared/types/constants'
import { Modal } from '../Modal'
import { EditorToolbar } from '../editor/EditorToolbar'
import { LinkDialog } from '../editor/LinkDialog'
import { createExtensions } from '../editor/extensions'

interface Props {
    /** Identifies this window's discussion in image addresses. */
    sessionId: string
    /** The thread the message will be written to. Each thread keeps its own unsent draft. */
    threadId: string
    /** Set when writing is not possible (a closed branch): shown instead of the editor. */
    blocked?: { message: string; actionLabel: string; onAction(): void } | undefined
    /** FR-268: a synchronized discussion warns before a file that some members will not get. */
    synced?: boolean
    /** Called with the finished message and its files; call `clear` once it was sent. */
    onSend(content: RichDoc, attachments: Attachment[], clear: () => void): void
}

/** The text of the refused files of an attach (FR-265: the limit is named). */
function refusedText(r: AttachResult): string | null {
    const lines: string[] = []
    const big = r.refused.filter((x) => x.reason === 'too-large').map((x) => x.name)
    const bad = r.refused.filter((x) => x.reason === 'unreadable').map((x) => x.name)
    if (big.length > 0) lines.push(texts().attachments.tooLarge(big.join(', '), r.limitMb))
    if (bad.length > 0) lines.push(texts().attachments.unreadable(bad.join(', ')))
    if (r.refused.some((x) => x.reason === 'too-many'))
        lines.push(texts().attachments.tooMany(MAX_ATTACHMENTS_PER_MESSAGE))
    return lines.length > 0 ? lines.join(' ') : null
}

const EMPTY_DOC: RichDoc = { type: 'doc', content: [{ type: 'paragraph' }] }

/** True if an editor document has visible text or an image: something worth sending (or losing). */
function jsonHasContent(node: unknown): boolean {
    if (typeof node !== 'object' || node === null) return false
    const n = node as { type?: unknown; text?: unknown; content?: unknown }
    if (n.type === 'image') return true
    if (typeof n.text === 'string' && n.text.trim().length > 0) return true
    return Array.isArray(n.content) && n.content.some(jsonHasContent)
}

const IMAGE_NAME = /\.(png|jpe?g|gif|webp|bmp|svg|tiff?|ico|avif|heic)$/i
/** Files that look like pictures; unsupported kinds (SVG, BMP, ...) are still taken so the person is told why not. */
const isImageFile = (file: File): boolean =>
    file.type.startsWith('image/') || IMAGE_NAME.test(file.name)

function groupLimits(limits: SmallLimit[]): Array<{ mb: number; names: string[] }> {
    const by = new Map<number, string[]>()
    for (const l of limits) by.set(l.maxFileMb, [...(by.get(l.maxFileMb) ?? []), l.displayName])
    return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([mb, names]) => ({ mb, names }))
}

interface LinkDraft {
    label: string
    href: string
    editing: boolean
}

export function Composer({
    sessionId,
    threadId,
    blocked,
    synced = false,
    onSend
}: Props): React.JSX.Element {
    const [hasDraft, setHasDraft] = useState(false)
    // FR-261: the files of the draft of the shown branch (the others are kept in `fileDrafts`)
    const [files, setFiles] = useState<Attachment[]>([])
    const filesRef = useRef<Attachment[]>([])
    filesRef.current = files
    const fileDrafts = useRef(new Map<string, Attachment[]>())
    const [attaching, setAttaching] = useState(0)
    const [smallLimits, setSmallLimits] = useState<{
        limits: SmallLimit[]
        send: () => void
    } | null>(null)
    const addFilesRef = useRef<(files: File[]) => Promise<void>>(async () => undefined)
    const [error, setError] = useState<string | null>(null)
    const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null)
    const [uploading, setUploading] = useState(0)
    // Unsent drafts of the threads that are not on screen, so moving between branches never loses what was typed.
    const drafts = useRef(new Map<string, JSONContent>())
    const activeThread = useRef(threadId)
    // The editor is created once; its callbacks reach the latest handlers through these refs.
    const sendRef = useRef<() => void>(() => undefined)
    const linkRef = useRef<() => void>(() => undefined)
    const addImagesRef = useRef<(files: File[], at?: number) => Promise<void>>(
        async () => undefined
    )
    const sessionRef = useRef(sessionId)
    sessionRef.current = sessionId
    const uploadingRef = useRef(0)
    uploadingRef.current = uploading
    // FR-251: drafts are saved in the library a moment after the last change (and at once when asked)
    const pendingSave = useRef(
        new Map<string, { content: JSONContent | null; files: Attachment[] }>()
    )
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const flushDrafts = useRef<() => Promise<void>>(async () => undefined)
    flushDrafts.current = async (): Promise<void> => {
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = null
        const waiting = [...pendingSave.current]
        pendingSave.current.clear()
        await Promise.all(
            waiting.map(([thread, d]) => window.branchchat.saveDraft(thread, d.content, d.files))
        )
    }
    const scheduleSave = (thread: string, content: JSONContent, withFiles: Attachment[]): void => {
        pendingSave.current.set(thread, {
            content: jsonHasContent(content) || withFiles.length > 0 ? content : null,
            files: withFiles
        })
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => void flushDrafts.current(), 400)
    }
    const scheduleRef = useRef(scheduleSave)
    scheduleRef.current = scheduleSave

    const editor = useEditor({
        extensions: createExtensions({
            placeholder: texts().composer.placeholder,
            srcFor: (assetId) => assetUrl(sessionRef.current, assetId),
            onSubmit: () => sendRef.current(),
            onLinkShortcut: () => linkRef.current()
        }),
        editorProps: {
            attributes: {
                'data-testid': 'composer',
                role: 'textbox',
                'aria-multiline': 'true',
                'aria-label': texts().composer.ariaLabel,
                class: 'editor-content'
            },
            // Pasting a picture (a screenshot, an image copied from a browser): text wins when the clipboard has both,
            // as when copying cells from a spreadsheet (FR-130).
            handlePaste: (_view, event) => {
                const data = event.clipboardData
                if (!data) return false
                const all = Array.from(data.files)
                const files = all.filter(isImageFile)
                const others = all.filter((f) => !isImageFile(f))
                if (all.length === 0 || data.getData('text/plain').trim().length > 0) return false
                event.preventDefault()
                if (files.length > 0) void addImagesRef.current(files)
                // FR-261: other files become attachments
                if (others.length > 0) void addFilesRef.current(others)
                return true
            },
            // Dropping picture files into the draft, at the place they were dropped (FR-065).
            handleDrop: (view, event, _slice, moved) => {
                if (moved) return false
                const all = Array.from(event.dataTransfer?.files ?? [])
                const files = all.filter(isImageFile)
                const others = all.filter(
                    (f) => !isImageFile(f) && !f.name.toLowerCase().endsWith(DISCUSSION_EXTENSION)
                )
                if (files.length === 0 && others.length === 0) return false
                event.preventDefault()
                event.stopPropagation()
                const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
                if (files.length > 0) void addImagesRef.current(files, at)
                if (others.length > 0) void addFilesRef.current(others)
                return true
            }
        },
        autofocus: 'end',
        onUpdate: ({ editor: e }) => {
            const json = e.getJSON()
            setHasDraft(jsonHasContent(json))
            scheduleRef.current(activeThread.current, json, filesRef.current)
        }
    })

    // FR-251: the drafts of this discussion come back from the library (also after a restart)
    useEffect(() => {
        if (!editor) return
        let cancelled = false
        void window.branchchat.getDrafts().then((r) => {
            if (cancelled || !r.ok) return
            for (const [thread, draft] of Object.entries(r.data)) {
                const content = draft.content as JSONContent
                if (thread === activeThread.current) {
                    if (editor.isEmpty && filesRef.current.length === 0) {
                        editor.commands.setContent(content, { emitUpdate: false })
                        setHasDraft(jsonHasContent(editor.getJSON()))
                        setFiles(draft.attachments)
                        editor.commands.focus('end')
                    }
                } else if (!drafts.current.has(thread)) {
                    drafts.current.set(thread, content)
                    fileDrafts.current.set(thread, draft.attachments)
                }
            }
        })
        return () => {
            cancelled = true
        }
    }, [editor])

    // The window closes or shows another discussion: the main process asks for the waiting drafts first.
    useEffect(
        () =>
            window.branchchat.onDraftsFlushRequest((token) => {
                void flushDrafts
                    .current()
                    .finally(() => void window.branchchat.draftsFlushed(token))
            }),
        []
    )
    useEffect(() => () => void flushDrafts.current(), [])

    // Switching threads: park the current draft, bring back the draft of the new thread.
    useEffect(() => {
        if (!editor || activeThread.current === threadId) return
        drafts.current.set(activeThread.current, editor.getJSON())
        fileDrafts.current.set(activeThread.current, filesRef.current)
        activeThread.current = threadId
        editor.commands.setContent(drafts.current.get(threadId) ?? '', { emitUpdate: false })
        drafts.current.delete(threadId)
        setFiles(fileDrafts.current.get(threadId) ?? [])
        fileDrafts.current.delete(threadId)
        setHasDraft(jsonHasContent(editor.getJSON()))
        if (!blocked) editor.commands.focus('end')
    }, [threadId, editor, blocked])

    const attachingRef = useRef(0)
    attachingRef.current = attaching
    sendRef.current = (): void => {
        if (!editor || uploadingRef.current > 0 || attachingRef.current > 0) return
        try {
            const sanitized = sanitizeEditorDoc(editor.getJSON())
            const withFiles = filesRef.current
            if (isRichDocBlank(sanitized) && withFiles.length === 0) return
            const content = isRichDocBlank(sanitized) ? EMPTY_DOC : sanitized
            setError(null)
            const send = (): void =>
                onSend(content, withFiles, () => {
                    editor.commands.clearContent(true)
                    setFiles([])
                    editor.commands.focus()
                })
            if (!synced || withFiles.length === 0) return send()
            // FR-268: members whose limit is smaller than the largest file are named first
            const largest = Math.max(...withFiles.map((f) => f.size))
            void window.branchchat.attachmentReceivers(largest).then((r) => {
                if (r.ok && r.data.length > 0) setSmallLimits({ limits: r.data, send })
                else send()
            })
        } catch {
            setError(texts().composer.cannotSend)
        }
    }

    /** FR-261: files (dropped, pasted, or chosen) are stored by the main process and listed in the draft. */
    const takeResult = (r: AttachResult): void => {
        setError(refusedText(r))
        if (r.added.length === 0) return
        const next = [...filesRef.current, ...r.added].slice(0, MAX_ATTACHMENTS_PER_MESSAGE)
        setFiles(next)
        filesRef.current = next
        if (editor) scheduleRef.current(activeThread.current, editor.getJSON(), next)
    }
    addFilesRef.current = async (list: File[]): Promise<void> => {
        setAttaching((n) => n + 1)
        try {
            const paths: string[] = []
            for (const file of list) {
                const path = window.branchchat.getPathForFile(file)
                if (path) paths.push(path)
                else {
                    const r = await window.branchchat.addAttachmentBytes(
                        file.name,
                        file.type,
                        new Uint8Array(await file.arrayBuffer())
                    )
                    if (r.ok) takeResult(r.data)
                    else setError(r.error.message)
                }
            }
            if (paths.length > 0) {
                const r = await window.branchchat.addAttachmentPaths(paths)
                if (r.ok) takeResult(r.data)
                else setError(r.error.message)
            }
        } finally {
            setAttaching((n) => n - 1)
        }
    }
    const pickFiles = async (): Promise<void> => {
        setAttaching((n) => n + 1)
        try {
            const r = await window.branchchat.pickAttachments()
            if (r.ok) takeResult(r.data)
            else setError(r.error.message)
        } finally {
            setAttaching((n) => n - 1)
        }
    }
    const removeFile = (index: number): void => {
        const next = filesRef.current.filter((_, i) => i !== index)
        setFiles(next)
        filesRef.current = next
        if (editor) scheduleRef.current(activeThread.current, editor.getJSON(), next)
    }

    /** Adds pictures to the draft: the main process checks the type and keeps them until a message is sent. */
    addImagesRef.current = async (files: File[], at?: number): Promise<void> => {
        if (!editor) return
        setUploading((n) => n + files.length)
        let position = at
        try {
            for (const file of files) {
                const result = await window.branchchat.stageImage(
                    new Uint8Array(await file.arrayBuffer())
                )
                if (!result.ok) {
                    setError(result.error.message)
                    continue
                }
                setError(null)
                const image = { type: 'image', attrs: { assetId: result.data.assetId } }
                const chain = editor.chain().focus()
                if (position === undefined) chain.insertContent(image).run()
                else {
                    chain.insertContentAt(position, image).run()
                    position += 1
                }
            }
        } finally {
            setUploading((n) => n - files.length)
        }
    }

    /** "Insert image…": the person chooses a file (FR-067). */
    const pickImage = async (): Promise<void> => {
        if (!editor) return
        setUploading((n) => n + 1)
        try {
            const result = await window.branchchat.pickImage()
            if (!result.ok) return setError(result.error.message)
            if (!result.data) return // cancelled
            setError(null)
            editor
                .chain()
                .focus()
                .insertContent({ type: 'image', attrs: { assetId: result.data.assetId } })
                .run()
        } finally {
            setUploading((n) => n - 1)
        }
    }

    linkRef.current = (): void => {
        if (!editor) return
        const existing = editor.isActive('link')
        if (existing) editor.chain().extendMarkRange('link').run()
        const { from, to, empty } = editor.state.selection
        setLinkDraft({
            label: empty ? '' : editor.state.doc.textBetween(from, to, ' '),
            href: existing ? String(editor.getAttributes('link')['href'] ?? '') : '',
            editing: existing
        })
    }

    const applyLink = (label: string, href: string): void => {
        if (!editor) return
        const { from, to, empty } = editor.state.selection
        const selected = empty ? '' : editor.state.doc.textBetween(from, to, ' ')
        const text = label.trim() || href
        if (!empty && text === selected) {
            editor.chain().focus().setLink({ href }).run() // keeps the formatting of the selected text
        } else {
            editor
                .chain()
                .focus()
                .insertContentAt(
                    { from, to },
                    { type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }
                )
                .run()
        }
        setLinkDraft(null)
    }

    const removeLink = (): void => {
        editor?.chain().focus().extendMarkRange('link').unsetLink().run()
        setLinkDraft(null)
    }

    if (!editor) return <footer className="composer" />
    if (blocked)
        return (
            <footer className="composer closed-notice" data-testid="closed-notice" role="status">
                <span>{blocked.message}</span>
                <button type="button" data-testid="reopen-from-composer" onClick={blocked.onAction}>
                    {blocked.actionLabel}
                </button>
            </footer>
        )
    const canSend = (hasDraft || files.length > 0) && uploading === 0 && attaching === 0
    return (
        <footer
            className="composer"
            onDragOver={(e) => {
                if (e.dataTransfer.types.includes('Files')) e.preventDefault()
            }}
            onDrop={(e) => {
                // FR-261: files dropped next to the editor become attachments (a .branchchat file is imported)
                const others = Array.from(e.dataTransfer.files).filter(
                    (f) => !f.name.toLowerCase().endsWith(DISCUSSION_EXTENSION)
                )
                if (others.length === 0) return
                e.preventDefault()
                e.stopPropagation()
                const images = others.filter(isImageFile)
                if (images.length > 0) void addImagesRef.current(images)
                const rest = others.filter((f) => !isImageFile(f))
                if (rest.length > 0) void addFilesRef.current(rest)
            }}
        >
            <EditorToolbar
                editor={editor}
                onLink={() => linkRef.current()}
                onImage={() => void pickImage()}
            />
            <EditorContent editor={editor} className="editor" />
            {files.length > 0 && (
                <ul
                    className="draft-files"
                    data-testid="draft-files"
                    aria-label={texts().attachments.list}
                >
                    {files.map((f, i) => (
                        <li key={`${i}:${f.sha256}`} data-testid="draft-file" data-name={f.name}>
                            <span aria-hidden="true">{ATTACHMENT_ICONS[attachmentKind(f)]}</span>
                            <span className="attachment-name">{f.name}</span>
                            <span className="attachment-size">
                                {texts().attachments.size(f.size)}
                            </span>
                            <button
                                type="button"
                                className="draft-file-remove"
                                data-testid="draft-file-remove"
                                aria-label={texts().attachments.remove(f.name)}
                                title={texts().attachments.remove(f.name)}
                                onClick={() => removeFile(i)}
                            >
                                ×
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {error && (
                <p className="field-error" role="alert">
                    {error}
                </p>
            )}
            <div className="composer-actions">
                <small>
                    {uploading > 0
                        ? texts().images.uploading
                        : attaching > 0
                          ? texts().attachments.adding
                          : `${keysOf('send')} — ${texts().composer.hint}`}
                </small>
                <button
                    type="button"
                    className="attach-button"
                    data-testid="attach"
                    title={texts().attachments.attach}
                    aria-label={texts().attachments.attach}
                    disabled={attaching > 0}
                    onClick={() => void pickFiles()}
                >
                    📎
                </button>
                <button
                    type="button"
                    className="primary"
                    data-testid="send"
                    disabled={!canSend}
                    onClick={() => sendRef.current()}
                >
                    {texts().composer.send}
                </button>
            </div>
            {smallLimits && (
                <Modal labelledBy="small-limits-title" onEscape={() => setSmallLimits(null)}>
                    <div
                        className="dialog"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="small-limits-title"
                        data-testid="small-limits"
                    >
                        <h2 id="small-limits-title">{texts().attachments.smallLimitsTitle}</h2>
                        {groupLimits(smallLimits.limits).map((g) => (
                            <p key={g.mb}>
                                {g.names.length === 1
                                    ? texts().attachments.smallLimitsOne(g.names[0]!, g.mb)
                                    : texts().attachments.smallLimits(
                                          texts().attachments.joinNames(g.names),
                                          g.mb
                                      )}
                            </p>
                        ))}
                        <p className="hint">{texts().attachments.smallLimitsHint}</p>
                        <div className="dialog-actions">
                            <button
                                type="button"
                                className="primary"
                                data-testid="send-anyway"
                                autoFocus
                                onClick={() => {
                                    const go = smallLimits.send
                                    setSmallLimits(null)
                                    go()
                                }}
                            >
                                {texts().attachments.sendAnyway}
                            </button>
                            <button type="button" onClick={() => setSmallLimits(null)}>
                                {texts().attachments.cancel}
                            </button>
                        </div>
                    </div>
                </Modal>
            )}
            {linkDraft && (
                <LinkDialog
                    initialLabel={linkDraft.label}
                    initialHref={linkDraft.href}
                    onApply={applyLink}
                    {...(linkDraft.editing ? { onRemove: removeLink } : {})}
                    onCancel={() => {
                        setLinkDraft(null)
                        editor.commands.focus()
                    }}
                />
            )}
        </footer>
    )
}
