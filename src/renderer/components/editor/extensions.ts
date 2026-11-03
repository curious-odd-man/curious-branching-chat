import { Extension } from '@tiptap/core'
import Bold from '@tiptap/extension-bold'
import Document from '@tiptap/extension-document'
import HardBreak from '@tiptap/extension-hard-break'
import Heading from '@tiptap/extension-heading'
import Italic from '@tiptap/extension-italic'
import Link from '@tiptap/extension-link'
import { BulletList, ListItem, OrderedList } from '@tiptap/extension-list'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { BackgroundColor, Color, TextStyle } from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import { Placeholder, UndoRedo } from '@tiptap/extensions'
import { isAllowedLinkHref } from '@shared/validation'

interface Callbacks {
  placeholder: string
  onSubmit(): void
  onLinkShortcut(): void
}

/** Ctrl+Enter sends the message; Ctrl+K opens the link dialog. */
const Shortcuts = Extension.create<Callbacks>({
  name: 'branchchatShortcuts',
  addOptions: () => ({
    placeholder: '',
    onSubmit: () => undefined,
    onLinkShortcut: () => undefined
  }),
  addKeyboardShortcuts() {
    return {
      'Mod-Enter': () => {
        this.options.onSubmit()
        return true
      },
      'Mod-k': () => {
        this.options.onLinkShortcut()
        return true
      }
    }
  }
})

/**
 * The editor supports exactly the formatting of requirements 4.3 and nothing else. Everything else (code blocks,
 * quotes, strike-through, images, ...) is simply not part of the schema, so it cannot be typed or pasted.
 */
export function createExtensions(callbacks: Callbacks) {
  return [
    Document,
    Paragraph,
    Text,
    HardBreak,
    Heading.configure({ levels: [1, 2, 3] }),
    Bold,
    Italic,
    Underline,
    BulletList,
    OrderedList,
    ListItem,
    TextStyle,
    Color,
    BackgroundColor,
    Link.configure({
      openOnClick: false,
      autolink: true, // plain URLs become links (FR-072)
      linkOnPaste: true,
      defaultProtocol: 'https',
      protocols: ['mailto'],
      HTMLAttributes: { rel: 'noopener noreferrer', target: null },
      isAllowedUri: (url, ctx) =>
        ctx.defaultValidate(url) && (!/^[a-z][a-z0-9+.-]*:/i.test(url) || isAllowedLinkHref(url))
    }),
    UndoRedo,
    Placeholder.configure({ placeholder: callbacks.placeholder }),
    Shortcuts.configure(callbacks)
  ]
}
