import { dialog, shell } from 'electron'

interface Answers {
  save: string[]
  open: string[]
  box: number[]
}
type DialogLog = { kind: 'save' | 'open' | 'box'; [key: string]: unknown }[]

/**
 * End-to-end test hooks: native dialogs never block, and tests queue answers and read what was shown.
 * This module is only included in builds made with `--mode e2e`; release builds do not contain it.
 */
export function installE2eHooks(): void {
  const g = globalThis as unknown as {
    __dialogLog: DialogLog
    __answers: Answers
    __openedLinks: string[]
  }
  g.__openedLinks = []
  g.__dialogLog = []
  g.__answers = { save: [], open: [], box: [] }
  const d = dialog as unknown as Record<string, unknown>

  // Never launch a real browser from tests; record what would have been opened.
  ;(shell as unknown as Record<string, unknown>)['openExternal'] = async (url: string) => {
    g.__openedLinks.push(url)
  }

  d['showSaveDialog'] = async () => {
    g.__dialogLog.push({ kind: 'save' })
    const filePath = g.__answers.save.shift()
    return filePath ? { canceled: false, filePath } : { canceled: true, filePath: undefined }
  }
  d['showOpenDialog'] = async () => {
    g.__dialogLog.push({ kind: 'open' })
    const filePath = g.__answers.open.shift()
    return filePath ? { canceled: false, filePaths: [filePath] } : { canceled: true, filePaths: [] }
  }
  d['showMessageBox'] = async (...args: unknown[]) => {
    const options = (args.find((a) => typeof a === 'object' && a !== null && 'message' in a) ??
      {}) as {
      type?: string
      title?: string
      message?: string
      detail?: string
    }
    g.__dialogLog.push({
      kind: 'box',
      type: options.type,
      title: options.title,
      message: options.message,
      detail: options.detail
    })
    return { response: g.__answers.box.shift() ?? 0, checkboxChecked: false }
  }
}
