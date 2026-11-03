import { useEditorState, type Editor } from '@tiptap/react'
import { ru } from '@shared/i18n/ru'
import { ColorMenu } from './ColorMenu'

const TEXT_COLORS = ['#d32f2f', '#ef6c00', '#2e7d32', '#1565c0', '#6a1b9a', '#616161'] as const
const BACKGROUND_COLORS = [
  '#fff59d',
  '#c8e6c9',
  '#bbdefb',
  '#f8bbd0',
  '#ffe0b2',
  '#e0e0e0'
] as const

interface Props {
  editor: Editor
  onLink(): void
}

interface ToolButtonProps {
  testId: string
  label: string
  active?: boolean
  disabled?: boolean
  onClick(): void
  children: React.ReactNode
}

function ToolButton({
  testId,
  label,
  active,
  disabled,
  onClick,
  children
}: ToolButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      data-testid={testId}
      className={active ? 'tool active' : 'tool'}
      // Keep the focus (and the selection) in the editor when a toolbar button is pressed.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export function EditorToolbar({ editor, onLink }: Props): React.JSX.Element {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      link: e.isActive('link'),
      canIndent: e.can().sinkListItem('listItem'),
      canOutdent: e.can().liftListItem('listItem'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo()
    })
  })
  const run = () => editor.chain().focus()

  return (
    <div className="toolbar" role="toolbar" aria-label={ru.editor.toolbar}>
      {([1, 2, 3] as const).map((level) => (
        <ToolButton
          key={level}
          testId={`tb-h${level}`}
          label={ru.editor.heading(level)}
          active={s[`h${level}`]}
          onClick={() => run().toggleHeading({ level }).run()}
        >
          H{level}
        </ToolButton>
      ))}
      <span className="sep" />
      <ToolButton
        testId="tb-bold"
        label={ru.editor.bold}
        active={s.bold}
        onClick={() => run().toggleBold().run()}
      >
        <b>Ж</b>
      </ToolButton>
      <ToolButton
        testId="tb-italic"
        label={ru.editor.italic}
        active={s.italic}
        onClick={() => run().toggleItalic().run()}
      >
        <i>К</i>
      </ToolButton>
      <ToolButton
        testId="tb-underline"
        label={ru.editor.underline}
        active={s.underline}
        onClick={() => run().toggleUnderline().run()}
      >
        <u>Ч</u>
      </ToolButton>
      <span className="sep" />
      <ToolButton
        testId="tb-bullet"
        label={ru.editor.bulletList}
        active={s.bullet}
        onClick={() => run().toggleBulletList().run()}
      >
        •≡
      </ToolButton>
      <ToolButton
        testId="tb-ordered"
        label={ru.editor.orderedList}
        active={s.ordered}
        onClick={() => run().toggleOrderedList().run()}
      >
        1.≡
      </ToolButton>
      <ToolButton
        testId="tb-indent"
        label={ru.editor.indent}
        disabled={!s.canIndent}
        onClick={() => run().sinkListItem('listItem').run()}
      >
        →
      </ToolButton>
      <ToolButton
        testId="tb-outdent"
        label={ru.editor.outdent}
        disabled={!s.canOutdent}
        onClick={() => run().liftListItem('listItem').run()}
      >
        ←
      </ToolButton>
      <span className="sep" />
      <ColorMenu
        testId="tb-textcolor"
        label={ru.editor.textColor}
        glyph={<span className="glyph-text-color">A</span>}
        colors={TEXT_COLORS}
        onPick={(color) => (color ? run().setColor(color).run() : run().unsetColor().run())}
      />
      <ColorMenu
        testId="tb-bgcolor"
        label={ru.editor.backgroundColor}
        glyph={<span className="glyph-bg-color">A</span>}
        colors={BACKGROUND_COLORS}
        onPick={(color) =>
          color ? run().setBackgroundColor(color).run() : run().unsetBackgroundColor().run()
        }
      />
      <ToolButton testId="tb-link" label={ru.editor.link} active={s.link} onClick={onLink}>
        🔗
      </ToolButton>
      <span className="sep" />
      <ToolButton
        testId="tb-undo"
        label={ru.editor.undo}
        disabled={!s.canUndo}
        onClick={() => run().undo().run()}
      >
        ↶
      </ToolButton>
      <ToolButton
        testId="tb-redo"
        label={ru.editor.redo}
        disabled={!s.canRedo}
        onClick={() => run().redo().run()}
      >
        ↷
      </ToolButton>
    </div>
  )
}
