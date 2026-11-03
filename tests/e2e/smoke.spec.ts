import { spawn } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { cleanup, launchApp, type TestApp } from './helpers/app'

// Run through `npm run test:e2e`, which makes the test build first. In containers running as root, set
// BRANCHCHAT_NO_SANDBOX=1.
let t: TestApp

test.beforeEach(async () => {
  t = await launchApp()
})
test.afterEach(async () => {
  await t.close()
  await cleanup(t.userData)
})

test('starts, shows the Russian UI, and exposes only the narrow preload API', async () => {
  const win = await t.app.firstWindow()
  await expect(win.locator('h1')).toHaveText('BranchChat') // start window of the app
  await expect(win.locator('main')).toContainText('Обсуждения с ветвлением')
  await expect(win.locator('small')).toContainText('Версия 0.1.0') // round trip through IPC

  const surface = await win.evaluate(() => ({
    api: Object.keys(window.branchchat),
    hasRequire: typeof (window as unknown as { require?: unknown }).require,
    hasProcess: typeof (window as unknown as { process?: unknown }).process
  }))
  expect(surface.hasRequire).toBe('undefined')
  expect(surface.hasProcess).toBe('undefined')
  // exactly the functions of BranchChatApi — nothing else is reachable from the page
  expect(surface.api.sort()).toEqual(
    [
      'appendMessage',
      'getAppInfo',
      'getDocumentState',
      'getPathForFile',
      'getSettings',
      'newDocument',
      'onDocumentChanged',
      'onMenuCommand',
      'openDocumentDialog',
      'openPath',
      'retrySave',
      'setDisplayName',
      'setDraftState'
    ].sort()
  )
})

test('security: secure web preferences, blocked navigation, blocked popups', async () => {
  const win = await t.app.firstWindow()
  const prefs = await t.app.evaluate(({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0]!.webContents
    const p = (
      wc as unknown as { getLastWebPreferences(): Record<string, unknown> }
    ).getLastWebPreferences()
    return {
      contextIsolation: p.contextIsolation,
      nodeIntegration: p.nodeIntegration,
      sandbox: p.sandbox
    }
  })
  expect(prefs).toEqual({ contextIsolation: true, nodeIntegration: false, sandbox: true })

  const before = win.url()
  await win.evaluate(() => {
    window.location.href = 'https://example.com/'
  })
  await win.waitForTimeout(500)
  expect(win.url()).toBe(before)

  const popup = await win.evaluate(() => window.open('https://example.com/') === null)
  expect(popup).toBe(true)
  expect(t.app.windows()).toHaveLength(1)
})

test('only one application instance runs (a second launch exits and the first keeps one window)', async () => {
  await t.app.firstWindow()
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electronPath = require('electron') as unknown as string
  const args = ['.', ...(process.env['BRANCHCHAT_NO_SANDBOX'] ? ['--no-sandbox'] : [])]
  // Same profile as the running instance, so it shares the single-instance lock.
  const second = spawn(electronPath, [...args, 'C:\\Users\\Аня\\идея.branchchat'], {
    stdio: 'ignore',
    env: { ...process.env, BRANCHCHAT_USER_DATA: t.userData }
  })
  const code = await new Promise<number | null>((resolve) => {
    second.once('exit', (c) => resolve(c))
    setTimeout(() => {
      second.kill()
      resolve(-1)
    }, 15_000)
  })
  expect(code).toBe(0) // quit by itself because the first instance holds the lock
  expect(t.app.windows()).toHaveLength(1)
})
