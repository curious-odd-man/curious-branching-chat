import type { JSONContent } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import { ru } from '@shared/i18n/ru'
import { assetUrl } from '@shared/types/assets'
import { isRichDocBlank, sanitizeEditorDoc, type RichDoc } from '@shared/validation'
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
    /** Called with the finished message; call `clear` once it was sent. */
    onSend(content: RichDoc, clear: () => void): void
}

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

interface LinkDraft {
    label: string
    href: string
    editing: boolean
}

export function Composer({ sessionId, threadId, blocked, onSend }: Props): React.JSX.Element {
    const [hasDraft, setHasDraft] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null)
    const [otherDraft, setOtherDraft] = useState(false)
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

    const editor = useEditor({
        extensions: createExtensions({
            placeholder: ru.composer.placeholder,
            srcFor: (assetId) => assetUrl(sessionRef.current, assetId),
            onSubmit: () => sendRef.current(),
            onLinkShortcut: () => linkRef.current()
        }),
        editorProps: {
            attributes: {
                'data-testid': 'composer',
                role: 'textbox',
                'aria-multiline': 'true',
                'aria-label': ru.composer.ariaLabel,
                class: 'editor-content'
            },
            // Pasting a picture (a screenshot, an image copied from a browser): text wins when the clipboard has both,
            // as when copying cells from a spreadsheet (FR-130).
            handlePaste: (_view, event) => {
                const data = event.clipboardData
                if (!data) return false
                const files = Array.from(data.files).filter(isImageFile)
                if (files.length === 0 || data.getData('text/plain').trim().length > 0) return false
                event.preventDefault()
                void addImagesRef.current(files)
                return true
            },
            // Dropping picture files into the draft, at the place they were dropped (FR-065).
            handleDrop: (view, event, _slice, moved) => {
                if (moved) return false
                const files = Array.from(event.dataTransfer?.files ?? []).filter(isImageFile)
                if (files.length === 0) return false
                event.preventDefault()
                event.stopPropagation()
                const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
                void addImagesRef.current(files, at)
                return true
            }
        },
        autofocus: 'end',
        onUpdate: ({ editor: e }) => setHasDraft(jsonHasContent(e.getJSON()))
    })

    // Switching threads: park the current draft, bring back the draft of the new thread.
    useEffect(() => {
        if (!editor || activeThread.current === threadId) return
        drafts.current.set(activeThread.current, editor.getJSON())
        activeThread.current = threadId
        editor.commands.setContent(drafts.current.get(threadId) ?? '', { emitUpdate: false })
        drafts.current.delete(threadId)
        setHasDraft(jsonHasContent(editor.getJSON()))
        setOtherDraft([...drafts.current.values()].some(jsonHasContent))
        if (!blocked) editor.commands.focus('end')
    }, [threadId, editor, blocked])

    // The main process needs to know about any unsent draft to warn when the window is closed (FR-008).
    const anyDraft = hasDraft || otherDraft
    useEffect(() => {
        void window.branchchat.setDraftState(anyDraft)
        return () => void window.branchchat.setDraftState(false)
    }, [anyDraft])

    sendRef.current = (): void => {
        if (!editor || uploadingRef.current > 0) return
        try {
            const content = sanitizeEditorDoc(editor.getJSON())
            if (isRichDocBlank(content)) return
            setError(null)
            onSend(content, () => {
                editor.commands.clearContent(true)
                editor.commands.focus()
            })
        } catch {
            setError(ru.composer.cannotSend)
        }
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
    return (
        <footer className="composer">
            <EditorToolbar
                editor={editor}
                onLink={() => linkRef.current()}
                onImage={() => void pickImage()}
            />
            <EditorContent editor={editor} className="editor" />
            {error && (
                <p className="field-error" role="alert">
                    {error}
                </p>
            )}
            <div className="composer-actions">
                <small>{uploading > 0 ? ru.images.uploading : ru.composer.hint}</small>
                <button
                    type="button"
                    className="primary"
                    data-testid="send"
                    disabled={!hasDraft || uploading > 0}
                    onClick={() => sendRef.current()}
                >
                    {ru.composer.send}
                </button>
            </div>
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
