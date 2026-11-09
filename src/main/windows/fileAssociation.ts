import { execFile } from 'node:child_process'
import { ru } from '@shared/i18n/ru'
import type { AssociationState } from '@shared/types/ipc'
import { DISCUSSION_EXTENSION } from '@shared/types/constants'

/** Names used in the registry. The installer script (build/installer.nsh) writes exactly the same keys. */
export const PROG_ID = 'BranchChat.Discussion'
export const EXT_KEY = `HKCU\\Software\\Classes\\${DISCUSSION_EXTENSION}`
export const PROG_ID_KEY = `HKCU\\Software\\Classes\\${PROG_ID}`
export const USER_CHOICE_KEY = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${DISCUSSION_EXTENSION}\\UserChoice`
/** Set (to 1) once the question about the association was settled, by the installer or by the application. */
export const ASKED_KEY = 'HKCU\\Software\\BranchChat'
export const ASKED_VALUE = 'AssociationAsked'

/** The few registry operations needed. `name` undefined means the key's default value. */
export interface Registry {
  /** Returns the string value, or null if the key or value does not exist. */
  get(key: string, name?: string): Promise<string | null>
  set(key: string, name: string | undefined, value: string): Promise<void>
  /** Deletes the key and everything below it. A missing key is not an error. */
  deleteTree(key: string): Promise<void>
}

export class AssociationBlockedError extends Error {
  constructor() {
    super('The file type is held by another program')
    this.name = 'AssociationBlockedError'
  }
}

/**
 * The .branchchat file association for the current Windows user (HKCU only, no administrator rights).
 * BranchChat never takes over a type that another program holds (FR-090).
 */
export class FileAssociation {
  constructor(
    private readonly registry: Registry,
    private readonly exePath: string,
    private readonly iconPath: string
  ) {}

  async state(): Promise<Exclude<AssociationState, 'unsupported'>> {
    const owner = await this.registry.get(EXT_KEY)
    // Windows remembers a program the person picked in "Open with" here; it overrides everything else.
    const choice = await this.registry.get(USER_CHOICE_KEY, 'ProgId')
    if (choice && choice !== PROG_ID) return 'other-app'
    if (owner === PROG_ID) return 'on'
    if (owner && owner.length > 0) return 'other-app'
    return 'off'
  }

  /** Registers the type for BranchChat. Throws AssociationBlockedError if another program holds it. */
  async enable(): Promise<void> {
    const state = await this.state()
    if (state === 'other-app') throw new AssociationBlockedError()
    await this.registry.set(PROG_ID_KEY, undefined, ru.fileType.name)
    await this.registry.set(`${PROG_ID_KEY}\\DefaultIcon`, undefined, `${this.iconPath},0`)
    await this.registry.set(
      `${PROG_ID_KEY}\\shell\\open\\command`,
      undefined,
      `"${this.exePath}" "%1"`
    )
    await this.registry.set(EXT_KEY, undefined, PROG_ID)
  }

  /** Removes the registration, but only if it is ours. */
  async disable(): Promise<void> {
    const owner = await this.registry.get(EXT_KEY)
    if (owner === PROG_ID) await this.registry.deleteTree(EXT_KEY)
    await this.registry.deleteTree(PROG_ID_KEY)
  }

  async wasAsked(): Promise<boolean> {
    return (await this.registry.get(ASKED_KEY, ASKED_VALUE)) === '1'
  }

  async markAsked(): Promise<void> {
    await this.registry.set(ASKED_KEY, ASKED_VALUE, '1')
  }
}

function run(args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile('reg.exe', args, { windowsHide: true, encoding: 'utf8' }, (err, stdout) => {
      if (!err) return resolve({ code: 0, stdout })
      const code = (err as NodeJS.ErrnoException & { code?: number | string }).code
      if (typeof code === 'number') return resolve({ code, stdout: stdout ?? '' })
      reject(err)
    })
  })
}

/** Extracts the string value from `reg query` output; null if no string value is shown. */
export function parseRegQuery(stdout: string): string | null {
  const match = /REG_(?:EXPAND_)?SZ[ \t]+(.*?)\r?$/m.exec(stdout)
  const value = match ? (match[1] ?? '').trim() : null
  // An unset default value is listed as this placeholder (in English; reg.exe prints it untranslated).
  return value === '(value not set)' ? null : value
}

/** Registry access through the built-in reg.exe (no native module). Windows only. */
export class RegExeRegistry implements Registry {
  async get(key: string, name?: string): Promise<string | null> {
    const { code, stdout } = await run([
      'query',
      key,
      ...(name === undefined ? ['/ve'] : ['/v', name])
    ])
    if (code !== 0) return null
    return parseRegQuery(stdout)
  }

  async set(key: string, name: string | undefined, value: string): Promise<void> {
    const { code } = await run([
      'add',
      key,
      ...(name === undefined ? ['/ve'] : ['/v', name]),
      '/t',
      'REG_SZ',
      '/d',
      value,
      '/f'
    ])
    if (code !== 0) throw new Error(`reg add failed (${code})`)
  }

  async deleteTree(key: string): Promise<void> {
    const { code } = await run(['delete', key, '/f'])
    // Exit code 1 also means "key not found", which is fine here.
    if (code !== 0 && code !== 1) throw new Error(`reg delete failed (${code})`)
  }
}
