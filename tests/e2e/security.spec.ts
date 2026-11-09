import { expect, test, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import yazl from 'yazl'
import { cleanup, launchApp, tempDir, type TestApp } from './helpers/app'
import { doc, link, p, simple, t, writeDiscussionFile } from './helpers/craft'
import { startFeed, type Feed } from './helpers/feed'
import { readEntries } from './helpers/readFile'

// Security review (phase 9, ADR section 7): what a received file or a compromised page could do to the running app.

const apps: TestApp[] = []
const dirs: string[] = []
let feed: Feed | null = null
test.afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()))
  await cleanup(...dirs.splice(0))
  await feed?.close()
  feed = null
})

async function workDir(): Promise<string> {
  const d = await tempDir('bc-sec-')
  dirs.push(d)
  return d
}
async function start(files: string[] = []): Promise<{ app: TestApp; win: Page }> {
  const app = await launchApp({ files })
  apps.push(app)
  dirs.push(app.userData)
  const win = await app.app.firstWindow()
  await expect(win.locator('#root')).not.toBeEmpty()
  return { app, win }
}
async function zipOf(entries: [string, Buffer | string][]): Promise<Buffer> {
  const z = new yazl.ZipFile()
  for (const [name, data] of entries) z.addBuffer(Buffer.from(data), name)
  z.end()
  const chunks: Buffer[] = []
  for await (const c of z.outputStream) chunks.push(c as Buffer)
  return Buffer.concat(chunks)
}
/** A valid file written by the test helpers, as the raw entries of its ZIP. */
async function validEntries(dir: string): Promise<Map<string, Buffer>> {
  const file = join(dir, 'valid.branchchat')
  await writeDiscussionFile(file, [
    { id: 'main', messages: [{ id: 'm1', author: 'boris', content: simple('Привет') }] }
  ])
  return readEntries(file)
}
const without = (entries: Map<string, Buffer>, name: string): [string, Buffer][] =>
  [...entries].filter(([n]) => n !== name)

test('malicious and malformed files are refused with a clear message, never executed, and the app keeps running (acceptance 23)', async () => {
  const dir = await workDir()
  const valid = await validEntries(dir)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixtures mutate arbitrary JSON
  const discussion = (mutate: (d: Record<string, any>) => void): Buffer => {
    const d = JSON.parse(valid.get('discussion.json')!.toString('utf8'))
    mutate(d)
    return Buffer.from(JSON.stringify(d))
  }
  const withDiscussion = (data: Buffer | string): [string, Buffer | string][] =>
    valid.get('manifest.json')
      ? [
          ['manifest.json', valid.get('manifest.json')!],
          ['discussion.json', data],
          ['readstate.json', valid.get('readstate.json')!]
        ]
      : []

  // zip-slip: an entry name that would leave the extraction folder (same length, patched into the finished archive)
  const slip = await zipOf([...valid, ['assets/xxxx/evil.txt', 'pwn']])
  const needle = Buffer.from('assets/xxxx/evil.txt')
  for (let i = slip.indexOf(needle); i !== -1; i = slip.indexOf(needle, i + 1))
    Buffer.from('../../../evil.txtxxx').copy(slip, i)

  const png1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  )
  const cases: { name: string; bytes: Buffer; code: string }[] = [
    { name: 'not-a-zip', bytes: Buffer.from('MZ this is not an archive'), code: 'NOT_AN_ARCHIVE' },
    { name: 'empty', bytes: Buffer.alloc(0), code: 'NOT_AN_ARCHIVE' },
    {
      name: 'truncated',
      bytes: (await zipOf([...valid])).subarray(0, 120),
      code: 'NOT_AN_ARCHIVE'
    },
    { name: 'zip-slip', bytes: slip, code: 'UNSAFE_ENTRY' },
    {
      name: 'duplicate-entry',
      bytes: await zipOf([...valid, ['manifest.json', valid.get('manifest.json')!]]),
      code: 'DUPLICATE_ENTRY'
    },
    {
      name: 'no-discussion',
      bytes: await zipOf(without(valid, 'discussion.json')),
      code: 'MISSING_ENTRY'
    },
    { name: 'bad-json', bytes: await zipOf(withDiscussion('{"title": ')), code: 'INVALID_JSON' },
    {
      name: 'javascript-link',
      bytes: await zipOf(
        withDiscussion(
          discussion((d) => {
            d.threads[0].messages[0].content = doc(
              p({ type: 'text', text: 'x', marks: [link('javascript:alert(1)')] })
            )
          })
        )
      ),
      code: 'INVALID_SCHEMA'
    },
    {
      name: 'file-link',
      bytes: await zipOf(
        withDiscussion(
          discussion((d) => {
            d.threads[0].messages[0].content = doc(
              p({ type: 'text', text: 'x', marks: [link('file:///C:/Windows/System32/cmd.exe')] })
            )
          })
        )
      ),
      code: 'INVALID_SCHEMA'
    },
    {
      name: 'script-node',
      bytes: await zipOf(
        withDiscussion(
          discussion((d) => {
            d.threads[0].messages[0].content = {
              type: 'doc',
              content: [{ type: 'script', src: 'x' }]
            }
          })
        )
      ),
      code: 'INVALID_SCHEMA'
    },
    {
      name: 'dangling-source',
      bytes: await zipOf(
        withDiscussion(
          discussion((d) => {
            d.threads.push({
              ...d.threads[0],
              threadId: 'ghost',
              parentThreadId: 'main',
              sourceMessageId: 'no-such-message',
              quoteText: 'q',
              selectionStart: 0,
              selectionEnd: 1,
              messages: []
            })
          })
        )
      ),
      code: 'INVALID_STRUCTURE'
    },
    {
      // an SVG with a script, declared as an image of the discussion
      name: 'svg-asset',
      bytes: await zipOf([
        ...withDiscussion(
          discussion((d) => {
            d.assets = [
              {
                assetId: 'a1',
                path: 'assets/images/a1.svg',
                mediaType: 'image/svg+xml',
                size: 10,
                sha256: 'a'.repeat(64)
              }
            ]
          })
        ),
        [
          'assets/images/a1.svg',
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
        ]
      ]),
      code: 'INVALID_SCHEMA'
    }
  ]
  void png1

  const { app, win } = await start()
  for (const c of cases) {
    const file = join(dir, `${c.name}.branchchat`)
    await fs.writeFile(file, c.bytes)
    const result = await win.evaluate((path) => window.branchchat.openPath(path), file)
    expect(result, c.name).toEqual({ ok: true, data: { status: 'failed', errorCode: c.code } })
  }
  const boxes = (await app.dialogs()).filter((d) => d.kind === 'box')
  expect(boxes).toHaveLength(cases.length)
  expect(boxes.every((b) => b.type === 'error')).toBe(true)
  // nothing was extracted anywhere, and the application is still a working start window
  await expect(win.getByTestId('launcher-new')).toBeVisible()
  for (const where of [dir, join(dir, '..')])
    expect((await fs.readdir(where)).filter((n) => n.startsWith('evil'))).toEqual([])
})

test('text that looks like markup is shown as text and runs nothing; stored links open only after a click (FR-065, NFR-014)', async () => {
  const dir = await workDir()
  const file = join(dir, 'markup.branchchat')
  const payload =
    '<img src=x onerror="window.__pwned=1"> <script>window.__pwned=2</script> &lt;b&gt;'
  await writeDiscussionFile(file, [
    {
      id: 'main',
      messages: [
        { id: 'm1', author: 'boris', content: doc(p(t(payload))) },
        {
          id: 'm2',
          author: 'boris',
          content: doc(
            p(
              t('сайт', [link('https://example.com/a?b=1')]),
              t(' и '),
              t('почта', [link('mailto:a@example.com')])
            )
          )
        }
      ]
    }
  ])
  const { app, win } = await start([file])
  const first = win.getByTestId('message').first()
  await expect(first).toContainText('<img src=x onerror=')
  expect(await first.locator('img, script').count()).toBe(0)
  expect(
    await win.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)
  ).toBeUndefined()

  // rendering a message with links opens nothing
  await expect(win.getByTestId('message').nth(1)).toContainText('сайт')
  expect(
    await app.app.evaluate(
      () => (globalThis as unknown as { __openedLinks: string[] }).__openedLinks
    )
  ).toEqual([])
  await win.getByTestId('message').nth(1).getByText('сайт').click()
  await expect
    .poll(() =>
      app.app.evaluate(() => (globalThis as unknown as { __openedLinks: string[] }).__openedLinks)
    )
    .toEqual(['https://example.com/a?b=1'])
  // the page itself did not navigate
  await expect(win.getByTestId('message').first()).toBeVisible()
})

test('the page cannot reach the network, run eval, or ask for permissions (CSP, request filter, permission handlers)', async () => {
  feed = await startFeed({ version: '9.9.9' })
  const { win } = await start()
  const result = await win.evaluate(async (url) => {
    const out: Record<string, unknown> = {}
    try {
      await fetch(`${url}latest.yml`)
      out['fetch'] = 'allowed'
    } catch {
      out['fetch'] = 'blocked'
    }
    out['image'] = await new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve('loaded')
      img.onerror = () => resolve('blocked')
      img.src = `${url}pixel.png`
    })
    try {
      new Function('return 1')()
      out['eval'] = 'allowed'
    } catch {
      out['eval'] = 'blocked'
    }
    out['notifications'] = await Notification.requestPermission()
    out['geolocation'] = await new Promise((resolve) =>
      navigator.geolocation.getCurrentPosition(
        () => resolve('allowed'),
        (e) => resolve(`denied:${e.code}`)
      )
    )
    out['csp'] = document
      .querySelector('meta[http-equiv="Content-Security-Policy"]')
      ?.getAttribute('content')
    return out
  }, feed.url)
  expect(result['fetch']).toBe('blocked')
  expect(result['image']).toBe('blocked')
  expect(result['eval']).toBe('blocked')
  expect(result['notifications']).toBe('denied')
  expect(String(result['geolocation'])).toMatch(/^denied/)
  expect(result['csp']).toContain("default-src 'self'")
  expect(result['csp']).toContain("connect-src 'none'")
  expect(result['csp']).toContain("object-src 'none'")
  expect(feed.requests).toEqual([]) // nothing reached the server
})

test('the page cannot navigate away, open windows or attach frames (navigation blocking)', async () => {
  feed = await startFeed({ version: '9.9.9' })
  const { app, win } = await start()
  const before = win.url()
  await win.evaluate((url) => {
    location.href = url
  }, feed.url)
  await win.evaluate((url) => {
    window.open(url)
    const frame = document.createElement('iframe')
    frame.src = url
    document.body.append(frame)
  }, feed.url)
  await new Promise((r) => setTimeout(r, 500))
  expect(win.url()).toBe(before)
  expect(app.app.windows()).toHaveLength(1)
  expect(feed.requests).toEqual([])
})

test('every window has the secure web preferences, including windows opened later', async () => {
  const dir = await workDir()
  const a = join(dir, 'a.branchchat')
  const b = join(dir, 'b.branchchat')
  for (const f of [a, b])
    await writeDiscussionFile(f, [
      { id: 'main', messages: [{ id: 'm1', author: 'boris', content: simple('x') }] }
    ])
  const { app, win } = await start([a])
  await win.evaluate((path) => window.branchchat.openPath(path), b)
  const prefs = await app.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => {
      const p = (
        w.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> }
      ).getLastWebPreferences()
      return {
        contextIsolation: p['contextIsolation'],
        nodeIntegration: p['nodeIntegration'],
        sandbox: p['sandbox'],
        webSecurity: p['webSecurity'],
        webviewTag: p['webviewTag'] ?? false
      }
    })
  )
  expect(prefs.length).toBeGreaterThanOrEqual(2)
  for (const p of prefs)
    expect(p).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false
    })
})

test('every IPC call validates its input: wrong types, extra fields, empty values and hostile links are refused', async () => {
  const { app, win } = await start()
  const results = await win.evaluate(async () => {
    const api = window.branchchat as unknown as Record<
      string,
      (...args: unknown[]) => Promise<{ ok: boolean; error?: { code: string }; data?: unknown }>
    >
    const code = async (name: string, ...args: unknown[]): Promise<string> => {
      const r = await api[name]!(...args)
      return r.ok ? `ok:${JSON.stringify(r.data)}` : (r.error?.code ?? 'error')
    }
    return {
      emptyPath: await code('openPath', ''),
      numberPath: await code('openPath', 42),
      objectName: await code('setDisplayName', { a: 1 }),
      blankName: await code('setDisplayName', '   '),
      badStatus: await code('setBranchStatus', 't', 'deleted'),
      badSelection: await code('createBranch', 'm', -1, 'x'),
      badContent: await code('appendMessage', 't', { type: 'doc', content: [{ type: 'script' }] }),
      notAnImage: await code('stageImage', new Uint8Array([1, 2, 3, 4])),
      svgImage: await code(
        'stageImage',
        new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')
      ),
      noDocument: await code('markAllRead'),
      jsLink: await code('openLink', 'javascript:alert(1)'),
      fileLink: await code('openLink', 'file:///C:/Windows/System32/cmd.exe'),
      ftpLink: await code('openLink', 'ftp://example.com/x'),
      notBool: await code('setAssociation', 'yes'),
      notBoolUpdate: await code('setAutoUpdateCheck', 1)
    }
  })
  expect(results.emptyPath).toBe('INVALID_REQUEST')
  expect(results.numberPath).toBe('INVALID_REQUEST')
  expect(results.objectName).toBe('INVALID_REQUEST')
  expect(results.blankName).toBe('INVALID_REQUEST')
  expect(results.badStatus).toBe('INVALID_REQUEST')
  expect(results.badSelection).toBe('INVALID_REQUEST')
  expect(results.badContent).toBe('INVALID_REQUEST')
  expect(results.notAnImage).not.toMatch(/^ok:/)
  expect(results.svgImage).not.toMatch(/^ok:/)
  expect(results.noDocument).toBe('NO_DOCUMENT')
  expect(results.jsLink).toBe('ok:false')
  expect(results.fileLink).toBe('ok:false')
  expect(results.ftpLink).toBe('ok:false')
  expect(results.notBool).toBe('INVALID_REQUEST')
  expect(results.notBoolUpdate).toBe('INVALID_REQUEST')
  expect(
    await app.app.evaluate(
      () => (globalThis as unknown as { __openedLinks: string[] }).__openedLinks
    )
  ).toEqual([])
})

test('the right-click menu offers spelling suggestions in the editor and copy for selected text', async () => {
  const { app } = await start()
  const menus = async (params: Record<string, unknown>): Promise<string[][]> => {
    await app.app.evaluate(({ BrowserWindow }, p) => {
      BrowserWindow.getAllWindows()[0]!.webContents.emit('context-menu', {}, p)
    }, params)
    return app.app.evaluate(
      () => (globalThis as unknown as { __contextMenus: string[][] }).__contextMenus
    )
  }
  const flags = { canCut: true, canCopy: true, canPaste: true, canSelectAll: true }
  const shown = await menus({
    isEditable: true,
    selectionText: '',
    misspelledWord: 'превет',
    dictionarySuggestions: ['привет', 'превед'],
    editFlags: flags
  })
  expect(shown.at(-1)).toEqual([
    'привет',
    'превед',
    'Добавить в словарь',
    '---',
    'Вырезать',
    'Копировать',
    'Вставить',
    '---',
    'Выделить всё'
  ])
  const readOnly = await menus({
    isEditable: false,
    selectionText: 'текст',
    misspelledWord: '',
    dictionarySuggestions: [],
    editFlags: flags
  })
  expect(readOnly.at(-1)).toEqual(['Копировать', 'Выделить всё'])
  const nothing = await menus({
    isEditable: false,
    selectionText: '',
    misspelledWord: '',
    dictionarySuggestions: [],
    editFlags: flags
  })
  expect(nothing).toHaveLength(2) // no menu for a click on empty space
})
