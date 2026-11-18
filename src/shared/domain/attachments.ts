import {
    MAX_ATTACHMENT_NAME,
    UNSAFE_NAME_CHARS,
    type Attachment,
    type Message
} from '../validation/schemas'
import { richTextToPlain } from '../validation/richText'
import { texts } from '../i18n'

/** File attachments (FR-261 to FR-268a): names, warned types, icons. */

/** FR-267: types that can run code. "Открыть" warns for them; nothing is blocked. Part of the app, not a setting. */
const RISKY_EXTENSIONS = [
    'exe',
    'bat',
    'cmd',
    'ps1',
    'js',
    'vbs',
    'msi',
    'lnk',
    'docm',
    'xlsm'
] as const

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
const UNSAFE_GLOBAL = new RegExp(UNSAFE_NAME_CHARS.source, 'g')

/** The extension in lower case without the dot ('' when there is none). */
export function extensionOf(name: string): string {
    const dot = name.lastIndexOf('.')
    return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : ''
}

export function isRiskyAttachment(name: string): boolean {
    return (RISKY_EXTENSIONS as readonly string[]).includes(extensionOf(name))
}

/**
 * A file name that is safe on Windows and in the export (security review of attachments): no control or direction
 * characters, no path separators or reserved characters, no reserved device names, no dots or spaces at the end, at
 * most 200 characters (the extension is kept). An empty result becomes "файл" ("file" in English).
 */
export function safeAttachmentName(raw: string): string {
    let name = raw.normalize('NFC').replace(UNSAFE_GLOBAL, '_').trim()
    name = name.replace(/[. ]+$/, '').trim()
    if (RESERVED.test(name)) name = `_${name}`
    if (name.length > MAX_ATTACHMENT_NAME) {
        const ext = extensionOf(name)
        const keep = ext && ext.length < 20 ? `.${ext}` : ''
        name = name.slice(0, MAX_ATTACHMENT_NAME - keep.length).replace(/[. ]+$/, '') + keep
    }
    return name || texts().attachments.defaultName
}

export type AttachmentKind =
    | 'document'
    | 'sheet'
    | 'slides'
    | 'pdf'
    | 'archive'
    | 'image'
    | 'audio'
    | 'video'
    | 'text'
    | 'program'
    | 'other'

const KIND_BY_EXT: Record<string, AttachmentKind> = {
    doc: 'document',
    docx: 'document',
    docm: 'document',
    odt: 'document',
    rtf: 'document',
    xls: 'sheet',
    xlsx: 'sheet',
    xlsm: 'sheet',
    ods: 'sheet',
    csv: 'sheet',
    ppt: 'slides',
    pptx: 'slides',
    odp: 'slides',
    pdf: 'pdf',
    zip: 'archive',
    '7z': 'archive',
    rar: 'archive',
    gz: 'archive',
    tar: 'archive',
    txt: 'text',
    md: 'text',
    log: 'text',
    json: 'text',
    xml: 'text'
}

/** FR-262: the icon group of an attachment, from the extension, then from the type. */
export function attachmentKind(a: Pick<Attachment, 'name' | 'type'>): AttachmentKind {
    const ext = extensionOf(a.name)
    if (isRiskyAttachment(a.name) && !KIND_BY_EXT[ext]) return 'program'
    const byExt = KIND_BY_EXT[ext]
    if (byExt) return byExt
    if (a.type.startsWith('image/')) return 'image'
    if (a.type.startsWith('audio/')) return 'audio'
    if (a.type.startsWith('video/')) return 'video'
    if (a.type.startsWith('text/')) return 'text'
    return 'other'
}

export const ATTACHMENT_ICONS: Record<AttachmentKind, string> = {
    document: '📝',
    sheet: '📊',
    slides: '📽️',
    pdf: '📕',
    archive: '🗜️',
    image: '🖼️',
    audio: '🎵',
    video: '🎬',
    text: '📄',
    program: '⚙️',
    other: '📎'
}

/** FR-214: the searched text of a message: its text, then the names of its files. */
export function messageSearchText(m: Message): string {
    const text = richTextToPlain(m.content)
    const names = (m.attachments ?? []).map((a) => a.name).join(' ')
    return names ? (text ? `${text} ${names}` : names) : text
}
