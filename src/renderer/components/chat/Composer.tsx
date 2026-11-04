import type { JSONContent } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import { ru } from '@shared/i18n/ru'
import { isRichDocBlank, sanitizeEditorDoc, type RichDoc } from '@shared/validation'
import { EditorToolbar } from '../editor/EditorToolbar'
import { LinkDialog } from '../editor/LinkDialog'
import { createExtensions } from '../editor/extensions'

interface Props {
  /** The thread the message will be written to. Each thread keeps its own unsent draft. */
  threadId: string
  /** Set when writing is not possible (a closed branch): shown instead of the editor. */
  blocked?: { message: string; actionLabel: string; onAction(): void } | undefined
  /** Called with the finished message; call `clear` once it was sent. */
  onSend(content: RichDoc, clear: () => void): void
}

/** True if a stored editor document has any visible text. */
function jsonHasText(node: unknown): boolean {
  if (typeof node !== 'object' || node === null) return false
  const n = node as { text?: unknown; content?: unknown }
  if (typeof n.text === 'string' && n.text.trim().length > 0) return true
  return Array.isArray(n.content) && n.content.some(jsonHasText)
}

interface LinkDraft {
  label: string
  href: string
  editing: boolean
}

export function Composer({ threadId, blocked, onSend }: Props): React.JSX.Element {
  const [hasDraft, setHasDraft] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null)
  const [otherDraft, setOtherDraft] = useState(false)
  // Unsent drafts of the threads that are not on screen, so moving between branches never loses what was typed.
  const drafts = useRef(new Map<string, JSONContent>())
  const activeThread = useRef(threadId)
  // The editor is created once; its callbacks reach the latest handlers through these refs.
  const sendRef = useRef<() => void>(() => undefined)
  const linkRef = useRef<() => void>(() => undefined)

  const editor = useEditor({
    extensions: createExtensions({
      placeholder: ru.composer.placeholder,
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
      }
    },
    autofocus: 'end',
    onUpdate: ({ editor: e }) => setHasDraft(e.getText().trim().length > 0)
  })

  // Switching threads: park the current draft, bring back the draft of the new thread.
  useEffect(() => {
    if (!editor || activeThread.current === threadId) return
    drafts.current.set(activeThread.current, editor.getJSON())
    activeThread.current = threadId
    editor.commands.setContent(drafts.current.get(threadId) ?? '', { emitUpdate: false })
    drafts.current.delete(threadId)
    setHasDraft(editor.getText().trim().length > 0)
    setOtherDraft([...drafts.current.values()].some(jsonHasText))
    if (!blocked) editor.commands.focus('end')
  }, [threadId, editor, blocked])

  // The main process needs to know about any unsent draft to warn when the window is closed (FR-008).
  const anyDraft = hasDraft || otherDraft
  useEffect(() => {
    void window.branchchat.setDraftState(anyDraft)
    return () => void window.branchchat.setDraftState(false)
  }, [anyDraft])

  sendRef.current = (): void => {
    if (!editor) return
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
      <EditorToolbar editor={editor} onLink={() => linkRef.current()} />
      <EditorContent editor={editor} className="editor" />
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="composer-actions">
        <small>{ru.composer.hint}</small>
        <button
          type="button"
          className="primary"
          data-testid="send"
          disabled={!hasDraft}
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
