import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface DialogLogEntry {
  kind: 'save' | 'open' | 'box'
  type?: string
  title?: string
  message?: string
  detail?: string
}

export interface TestApp {
  app: ElectronApplication
  userData: string
  /** Answer the next dialogs: save/open paths, and message-box button indexes (0 = first button). */
  answer(answers: { save?: string[]; open?: string[]; box?: number[] }): Promise<void>
  dialogs(): Promise<DialogLogEntry[]>
  /** What the (in-memory) test registry holds: key -> value name ('' = default) -> value. */
  registry(): Promise<Record<string, Record<string, string>>>
  /** Wait until the app has this many windows and return them. */
  windows(count: number): Promise<Page[]>
  close(): Promise<void>
}

export async function tempDir(prefix = 'bc-e2e-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

/** Launches the built app with an isolated profile and all native dialogs stubbed. */
export async function launchApp(
  options: { userData?: string; files?: string[]; env?: Record<string, string> } = {}
): Promise<TestApp> {
  const userData = options.userData ?? (await tempDir('bc-profile-'))
  const args = [
    '.',
    ...(process.env['BRANCHCHAT_NO_SANDBOX'] ? ['--no-sandbox'] : []),
    ...(options.files ?? [])
  ]
  const app = await electron.launch({
    args,
    env: {
      ...(process.env as Record<string, string>),
      ...(options.env ?? {}),
      BRANCHCHAT_USER_DATA: userData
    }
  })
  return {
    app,
    userData,
    answer: (answers) =>
      app.evaluate((_electron, a) => {
        const store = (
          globalThis as unknown as { __answers: { save: string[]; open: string[]; box: number[] } }
        ).__answers
        store.save.push(...(a.save ?? []))
        store.open.push(...(a.open ?? []))
        store.box.push(...(a.box ?? []))
      }, answers),
    dialogs: () =>
      app.evaluate(() => (globalThis as unknown as { __dialogLog: DialogLogEntry[] }).__dialogLog),
    registry: () =>
      app.evaluate(() =>
        (
          globalThis as unknown as {
            __registry: { dump(): Record<string, Record<string, string>> }
          }
        ).__registry.dump()
      ),
    windows: async (count) => {
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        if (app.windows().length === count) return app.windows()
        await new Promise((r) => setTimeout(r, 100))
      }
      throw new Error(`expected ${count} windows, have ${app.windows().length}`)
    },
    close: async () => {
      await app.close().catch(() => undefined)
    }
  }
}

/**
 * Removes temporary folders. On Windows, Chromium's helper processes can keep files in a profile folder locked for a
 * moment after the application has closed (EPERM/EBUSY), so removal is retried; a folder that still cannot be removed
 * is left behind in the temp directory and must never make a test fail.
 */
export async function cleanup(...dirs: string[]): Promise<void> {
  await Promise.all(
    dirs.map((d) =>
      rm(d, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 }).catch(
        () => undefined
      )
    )
  )
}
