import { Extension, Node as TiptapNode } from '@tiptap/core'
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
  /** Address of an embedded image, for display in the editor. */
  srcFor(assetId: string): string
  onSubmit(): void
  onLinkShortcut(): void
}

/** Ctrl+Enter sends the message; Ctrl+K opens the link dialog. */
const Shortcuts = Extension.create<Callbacks>({
  name: 'branchchatShortcuts',
  addOptions: () => ({
    placeholder: '',
    srcFor: () => '',
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

const IMAGE_ID = /^[0-9a-f]{64}$/

/**
 * An embedded image in a draft (FR-065 to FR-067). Images only come from the application's own image staging (paste,
 * drop, file chooser): pasted HTML cannot create one unless it carries the id of an image this app rendered, and an
 * id that was never staged is refused when the message is sent.
 */
const ImageNode = TiptapNode.create<{ srcFor(assetId: string): string }>({
  name: 'image',
  group: 'inline',
  inline: true,
  atom: true,
  draggable: true,
  selectable: true,
  addOptions: () => ({ srcFor: () => '' }),
  addAttributes() {
    return {
      assetId: { default: null, parseHTML: (el) => el.getAttribute('data-asset-id') },
      alt: { default: null }
    }
  },
  parseHTML() {
    return [
      {
        tag: 'img[data-asset-id]',
        getAttrs: (el) =>
          IMAGE_ID.test((el as HTMLElement).getAttribute('data-asset-id') ?? '') ? null : false
      }
    ]
  },
  renderHTML({ node }) {
    return [
      'img',
      {
        src: this.options.srcFor(String(node.attrs['assetId'])),
        alt: (node.attrs['alt'] as string | null) ?? '',
        'data-asset-id': String(node.attrs['assetId']),
        class: 'editor-image',
        draggable: 'false'
      }
    ]
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
    ImageNode.configure({ srcFor: callbacks.srcFor }),
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
