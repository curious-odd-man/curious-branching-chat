import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import { ru } from '@shared/i18n/ru'
import { isRichDocBlank, sanitizeEditorDoc, type RichDoc } from '@shared/validation'
import { EditorToolbar } from '../editor/EditorToolbar'
import { LinkDialog } from '../editor/LinkDialog'
import { createExtensions } from '../editor/extensions'

interface Props {
  /** Called with the finished message; call `clear` once it was sent. */
  onSend(content: RichDoc, clear: () => void): void
}

interface LinkDraft {
  label: string
  href: string
  editing: boolean
}

export function Composer({ onSend }: Props): React.JSX.Element {
  const [hasDraft, setHasDraft] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null)
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

  // The main process needs to know about an unsent draft to warn when the window is closed (FR-008).
  useEffect(() => {
    void window.branchchat.setDraftState(hasDraft)
    return () => void window.branchchat.setDraftState(false)
  }, [hasDraft])

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
