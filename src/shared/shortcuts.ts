/**
 * FR-311, FR-312: every keyboard shortcut of the application, in one table. The menu (accelerators), the editor
 * (key bindings), the button texts, and the shortcut list (F1) all read this table, so the list is always complete.
 */

export type ShortcutGroup = 'window' | 'messages' | 'search' | 'editor' | 'dialogs'

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
    'window',
    'messages',
    'search',
    'editor',
    'dialogs'
]

export interface Shortcut {
    id: ShortcutId
    group: ShortcutGroup
    /** What the person presses, as shown (alternatives separated). */
    keys: readonly string[]
    /** Electron menu accelerator, if a menu item has this shortcut. */
    accelerator?: string
    /** TipTap key binding, if the editor handles it (`Mod` = Ctrl on Windows). */
    editorKey?: string
}

export type ShortcutId =
    | 'newDiscussion'
    | 'open'
    | 'settings'
    | 'zoomIn'
    | 'zoomOut'
    | 'zoomReset'
    | 'shortcuts'
    | 'jumpToDate'
    | 'find'
    | 'findAll'
    | 'findNext'
    | 'findPrevious'
    | 'branchMap'
    | 'send'
    | 'newLine'
    | 'pasteImage'
    | 'link'
    | 'bold'
    | 'italic'
    | 'underline'
    | 'undo'
    | 'redo'
    | 'indent'
    | 'outdent'
    | 'confirm'
    | 'close'

export const SHORTCUTS: readonly Shortcut[] = [
    { id: 'newDiscussion', group: 'window', keys: ['Ctrl+N'], accelerator: 'CmdOrCtrl+N' },
    { id: 'open', group: 'window', keys: ['Ctrl+O'], accelerator: 'CmdOrCtrl+O' },
    { id: 'settings', group: 'window', keys: ['Ctrl+,'], accelerator: 'CmdOrCtrl+,' },
    // the zoom keys are handled for every window (several keys and the mouse wheel), see src/main/windows/zoom.ts
    { id: 'zoomIn', group: 'window', keys: ['Ctrl++', 'Ctrl+='], accelerator: 'CmdOrCtrl+Plus' },
    { id: 'zoomOut', group: 'window', keys: ['Ctrl+-'], accelerator: 'CmdOrCtrl+-' },
    { id: 'zoomReset', group: 'window', keys: ['Ctrl+0'], accelerator: 'CmdOrCtrl+0' },
    { id: 'shortcuts', group: 'window', keys: ['F1'], accelerator: 'F1' },
    { id: 'jumpToDate', group: 'messages', keys: ['Ctrl+G'], accelerator: 'CmdOrCtrl+G' },
    { id: 'find', group: 'search', keys: ['Ctrl+F'], accelerator: 'CmdOrCtrl+F' },
    { id: 'findAll', group: 'search', keys: ['Ctrl+Shift+F'], accelerator: 'CmdOrCtrl+Shift+F' },
    { id: 'findNext', group: 'search', keys: ['Enter'] },
    { id: 'findPrevious', group: 'search', keys: ['Shift+Enter'] },
    {
        id: 'branchMap',
        group: 'messages',
        keys: ['Ctrl+Shift+M'],
        accelerator: 'CmdOrCtrl+Shift+M'
    },
    { id: 'send', group: 'messages', keys: ['Ctrl+Enter'], editorKey: 'Mod-Enter' },
    { id: 'newLine', group: 'messages', keys: ['Enter'] },
    { id: 'pasteImage', group: 'messages', keys: ['Ctrl+V'] },
    { id: 'link', group: 'editor', keys: ['Ctrl+K'], editorKey: 'Mod-k' },
    // the editor's own bindings (TipTap StarterKit), listed for the person
    { id: 'bold', group: 'editor', keys: ['Ctrl+B'] },
    { id: 'italic', group: 'editor', keys: ['Ctrl+I'] },
    { id: 'underline', group: 'editor', keys: ['Ctrl+U'] },
    { id: 'undo', group: 'editor', keys: ['Ctrl+Z'] },
    { id: 'redo', group: 'editor', keys: ['Ctrl+Y'] },
    { id: 'indent', group: 'editor', keys: ['Tab'] },
    { id: 'outdent', group: 'editor', keys: ['Shift+Tab'] },
    { id: 'confirm', group: 'dialogs', keys: ['Enter'] },
    { id: 'close', group: 'dialogs', keys: ['Esc'] }
]

function shortcut(id: ShortcutId): Shortcut {
    const found = SHORTCUTS.find((s) => s.id === id)
    if (!found) throw new Error(`unknown shortcut ${id}`)
    return found
}

/** The keys as shown, for example "Ctrl+B" (the first alternative). */
export function keysOf(id: ShortcutId): string {
    return shortcut(id).keys[0]!
}

/** "Жирный" + bold → "Жирный (Ctrl+B)". */
export function withKeys(label: string, id: ShortcutId): string {
    return `${label} (${keysOf(id)})`
}

export function acceleratorOf(id: ShortcutId): string {
    const a = shortcut(id).accelerator
    if (!a) throw new Error(`shortcut ${id} has no menu accelerator`)
    return a
}

export function editorKeyOf(id: ShortcutId): string {
    const k = shortcut(id).editorKey
    if (!k) throw new Error(`shortcut ${id} has no editor key`)
    return k
}

/** Text size (FR-301): 80 % to 200 % in steps of 10 %. */
export const TEXT_SIZE_MIN = 80
export const TEXT_SIZE_MAX = 200
export const TEXT_SIZE_STEP = 10
export const TEXT_SIZE_DEFAULT = 100

export function clampTextSize(percent: number): number {
    if (!Number.isFinite(percent)) return TEXT_SIZE_DEFAULT
    const stepped = Math.round(percent / TEXT_SIZE_STEP) * TEXT_SIZE_STEP
    return Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_MIN, stepped))
}

export function nextTextSize(percent: number, direction: 'in' | 'out' | 'reset'): number {
    if (direction === 'reset') return TEXT_SIZE_DEFAULT
    return clampTextSize(percent + (direction === 'in' ? TEXT_SIZE_STEP : -TEXT_SIZE_STEP))
}

/** The page side of the zoom keys (FR-301): the same keys as the main process uses. */
export function zoomKeyOfEvent(e: {
    ctrlKey: boolean
    metaKey: boolean
    altKey: boolean
    key: string
    code: string
}): 'in' | 'out' | 'reset' | null {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return null
    if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') return 'in'
    if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') return 'out'
    if (e.key === '0' || e.code === 'Numpad0' || e.code === 'Digit0') return 'reset'
    return null
}
