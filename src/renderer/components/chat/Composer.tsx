import type { JSONContent } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { useRef, useState } from 'react'
import { texts } from '@shared/i18n'
import { keysOf } from '@shared/shortcuts'
import { assetUrl } from '@shared/types/assets'
import {
    isRichDocBlank,
    sanitizeEditorDoc,
    type Attachment,
    type RichDoc
} from '@shared/validation'
import type { SmallLimit } from '@shared/types/ipc'
import { DISCUSSION_EXTENSION } from '@shared/types/constants'
import { useApi } from '../../api'
import { EditorToolbar } from '../editor/EditorToolbar'
import { LinkDialog } from '../editor/LinkDialog'
import { createExtensions } from '../editor/extensions'
import { EMPTY_DOC, isImageFile, jsonHasContent } from './composer/content'
import { DraftFiles } from './composer/DraftFiles'
import { SmallLimitsDialog } from './composer/SmallLimitsDialog'
import { useAttachments } from './composer/useAttachments'
import { useDraftSaving } from './composer/useDraftSaving'
import { useImageUpload } from './composer/useImageUpload'
import { useThreadDrafts } from './composer/useThreadDrafts'

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

interface LinkDraft {
    label: string
    href: string
    editing: boolean
}

/**
 * The editor of a new message, with its files. Drafts (`useThreadDrafts`, `useDraftSaving`), files (`useAttachments`)
 * and pictures (`useImageUpload`) are kept in own hooks (code review 4.4).
 */
export function Composer({
    sessionId,
    threadId,
    blocked,
    synced = false,
    onSend
}: Props): React.JSX.Element {
    const api = useApi()
    const [hasDraft, setHasDraft] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null)
    const [smallLimits, setSmallLimits] = useState<{
        limits: SmallLimit[]
        send: () => void
    } | null>(null)
    const activeThread = useRef(threadId)
    const { schedule } = useDraftSaving()
    const editorRef = useRef<{ getJSON(): JSONContent } | null>(null)
    const attachments = useAttachments({
        setError,
        onChange: (next) => {
            if (editorRef.current) schedule(activeThread.current, editorRef.current.getJSON(), next)
        }
    })
    // The editor is created once; its callbacks reach the latest handlers through this ref.
    const handlers = useRef({
        send: (): void => undefined,
        link: (): void => undefined,
        addImages: async (_files: File[], _at?: number): Promise<void> => undefined,
        addFiles: async (_files: File[]): Promise<void> => undefined,
        changed: (_json: JSONContent): void => undefined
    })
    const sessionRef = useRef(sessionId)
    sessionRef.current = sessionId

    const editor = useEditor({
        extensions: createExtensions({
            placeholder: texts().composer.placeholder,
            srcFor: (assetId) => assetUrl(sessionRef.current, assetId),
            onSubmit: () => handlers.current.send(),
            onLinkShortcut: () => handlers.current.link()
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
                if (files.length > 0) void handlers.current.addImages(files)
                // FR-261: other files become attachments
                if (others.length > 0) void handlers.current.addFiles(others)
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
                if (files.length > 0) void handlers.current.addImages(files, at)
                if (others.length > 0) void handlers.current.addFiles(others)
                return true
            }
        },
        autofocus: 'end',
        onUpdate: ({ editor: e }) => handlers.current.changed(e.getJSON())
    })
    editorRef.current = editor
    const images = useImageUpload({ editor, setError })
    useThreadDrafts({
        editor,
        threadId,
        activeThread,
        blocked: Boolean(blocked),
        files: attachments,
        onDraftShown: setHasDraft
    })

    const send = (): void => {
        if (!editor || images.isUploading() || attachments.isAttaching()) return
        try {
            const sanitized = sanitizeEditorDoc(editor.getJSON())
            const withFiles = attachments.current()
            if (isRichDocBlank(sanitized) && withFiles.length === 0) return
            const content = isRichDocBlank(sanitized) ? EMPTY_DOC : sanitized
            setError(null)
            const go = (): void =>
                onSend(content, withFiles, () => {
                    // the files first: clearing the text saves the (now empty) draft with the files of that moment
                    attachments.replace([])
                    editor.commands.clearContent(true)
                    editor.commands.focus()
                })
            if (!synced || withFiles.length === 0) return go()
            // FR-268: members whose limit is smaller than the largest file are named first
            const largest = Math.max(...withFiles.map((f) => f.size))
            void api.attachmentReceivers(largest).then((r) => {
                if (r.ok && r.data.length > 0) setSmallLimits({ limits: r.data, send: go })
                else go()
            })
        } catch {
            setError(texts().composer.cannotSend)
        }
    }

    const link = (): void => {
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

    handlers.current = {
        send,
        link,
        addImages: images.addImages,
        addFiles: attachments.addFiles,
        changed: (json) => {
            setHasDraft(jsonHasContent(json))
            schedule(activeThread.current, json, attachments.current())
        }
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
    const { files, attaching } = attachments
    const canSend = (hasDraft || files.length > 0) && !images.uploading && !attaching
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
                const pictures = others.filter(isImageFile)
                if (pictures.length > 0) void images.addImages(pictures)
                const rest = others.filter((f) => !isImageFile(f))
                if (rest.length > 0) void attachments.addFiles(rest)
            }}
        >
            <EditorToolbar editor={editor} onLink={link} onImage={() => void images.pickImage()} />
            <EditorContent editor={editor} className="editor" />
            <DraftFiles files={files} onRemove={attachments.removeFile} />
            {error && (
                <p className="field-error" role="alert">
                    {error}
                </p>
            )}
            <div className="composer-actions">
                <small>
                    {images.uploading
                        ? texts().images.uploading
                        : attaching
                          ? texts().attachments.adding
                          : `${keysOf('send')} — ${texts().composer.hint}`}
                </small>
                <button
                    type="button"
                    className="attach-button"
                    data-testid="attach"
                    title={texts().attachments.attach}
                    aria-label={texts().attachments.attach}
                    disabled={attaching}
                    onClick={() => void attachments.pickFiles()}
                >
                    📎
                </button>
                <button
                    type="button"
                    className="primary"
                    data-testid="send"
                    disabled={!canSend}
                    onClick={send}
                >
                    {texts().composer.send}
                </button>
            </div>
            {smallLimits && (
                <SmallLimitsDialog
                    limits={smallLimits.limits}
                    onCancel={() => setSmallLimits(null)}
                    onSend={() => {
                        const go = smallLimits.send
                        setSmallLimits(null)
                        go()
                    }}
                />
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
