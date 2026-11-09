import type { MenuItemConstructorOptions, WebContents } from 'electron'
import { ru } from '@shared/i18n/ru'

export interface ContextParams {
  isEditable: boolean
  selectionText: string
  misspelledWord: string
  dictionarySuggestions: string[]
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean }
}

/**
 * The right-click menu: spelling suggestions for a misspelled word in the editor, then cut/copy/paste. Without it
 * Electron shows no menu at all, so spell checking would underline words but offer no correction.
 */
export function buildContextMenu(
  contents: Pick<WebContents, 'replaceMisspelling' | 'session'>,
  params: ContextParams
): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = []
  if (params.isEditable && params.misspelledWord) {
    for (const suggestion of params.dictionarySuggestions.slice(0, 6))
      items.push({ label: suggestion, click: () => contents.replaceMisspelling(suggestion) })
    if (params.dictionarySuggestions.length === 0)
      items.push({ label: ru.contextMenu.noSuggestions, enabled: false })
    items.push({
      label: ru.contextMenu.addToDictionary,
      click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
    })
    items.push({ type: 'separator' })
  }
  if (params.isEditable) {
    items.push(
      { label: ru.menu.cut, role: 'cut', enabled: params.editFlags.canCut },
      { label: ru.menu.copy, role: 'copy', enabled: params.editFlags.canCopy },
      { label: ru.menu.paste, role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { label: ru.menu.selectAll, role: 'selectAll', enabled: params.editFlags.canSelectAll }
    )
  } else if (params.selectionText) {
    items.push(
      { label: ru.menu.copy, role: 'copy' },
      { label: ru.menu.selectAll, role: 'selectAll' }
    )
  }
  return items
}
