import { expect, test, type Locator, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { cleanup, launchApp, tempDir, type TestApp } from './helpers/app'
import { doc, img, p, sha256, simple, t, writeDiscussionFile } from './helpers/craft'
import { makePng } from './helpers/png'
import { plainTextOf, readDiscussionFile, readEntries } from './helpers/readFile'
import { selectText } from './helpers/select'

const apps: TestApp[] = []
const dirs: string[] = []
test.afterEach(async () => {
    await Promise.all(apps.splice(0).map((a) => a.close()))
    await cleanup(...dirs.splice(0))
})

async function workDir(): Promise<string> {
    const d = await tempDir()
    dirs.push(d)
    return d
}
async function profile(): Promise<string> {
    const dir = await tempDir('bc-profile-')
    dirs.push(dir)
    await fs.writeFile(
        join(dir, 'settings.json'),
        JSON.stringify({
            participantId: 'p-local',
            displayName: 'Вера',
            readNoticeAcknowledged: true
        })
    )
    return dir
}
async function open(file: string, userData?: string): Promise<{ t: TestApp; win: Page }> {
    const t = await launchApp({ userData: userData ?? (await profile()), files: [file] })
    apps.push(t)
    return { t, win: await t.app.firstWindow() }
}
/** A new discussion created through the UI, with the composer ready. */
async function newDiscussion(file: string): Promise<{ t: TestApp; win: Page }> {
    const t = await launchApp({ userData: await profile() })
    apps.push(t)
    const win = await t.app.firstWindow()
    await t.answer({ save: [file] })
    await win.getByTestId('launcher-new').click()
    await expect(win.getByTestId('composer')).toBeVisible()
    return { t, win }
}

const composer = (win: Page): Locator => win.getByTestId('composer')
const draftImages = (win: Page): Locator => composer(win).locator('img.editor-image')
const messageImages = (win: Page): Locator => win.getByTestId('message-image')
const assetEntries = async (file: string): Promise<string[]> =>
    [...(await readEntries(file)).keys()].filter((n) => n.startsWith('assets/')).sort()
const savedThread = async (file: string) => (await readDiscussionFile(file)).discussion.threads[0]!
const naturalWidth = (image: Locator): Promise<number> =>
    image.evaluate((el) => (el as HTMLImageElement).naturalWidth)

/** Waits until the element has not moved or changed size for a short while. */
async function expectLayoutSettled(locator: Locator): Promise<void> {
    let previous = ''
    let same = 0
    await expect
        .poll(
            async () => {
                const box = JSON.stringify(await locator.boundingBox())
                same = box === previous ? same + 1 : 0
                previous = box
                return same
            },
            { intervals: [100] }
        )
        .toBeGreaterThanOrEqual(4)
}

type Pic = { data: Buffer; name: string; type: string }
const png = (color: [number, number, number], size = 40, name = 'снимок.png'): Pic => ({
    data: makePng(size, size, color),
    name,
    type: 'image/png'
})

/** Pastes files the way the browser delivers a pasted screenshot. */
async function paste(win: Page, ...pics: Pic[]): Promise<void> {
    await composer(win).click()
    await win.evaluate(
        (items) => {
            const dt = new DataTransfer()
            for (const it of items)
                dt.items.add(
                    new File([Uint8Array.from(atob(it.b64), (c) => c.charCodeAt(0))], it.name, {
                        type: it.type
                    })
                )
            document.querySelector('[data-testid=composer]')!.dispatchEvent(
                new ClipboardEvent('paste', {
                    clipboardData: dt,
                    bubbles: true,
                    cancelable: true
                })
            )
        },
        pics.map((x) => ({ b64: x.data.toString('base64'), name: x.name, type: x.type }))
    )
}

/** Drops files onto the draft, at the middle of the editor. */
async function drop(win: Page, ...pics: Pic[]): Promise<void> {
    await win.evaluate(
        (items) => {
            const editor = document.querySelector('[data-testid=composer]') as HTMLElement
            const box = editor.getBoundingClientRect()
            const dt = new DataTransfer()
            for (const it of items)
                dt.items.add(
                    new File([Uint8Array.from(atob(it.b64), (c) => c.charCodeAt(0))], it.name, {
                        type: it.type
                    })
                )
            editor.dispatchEvent(
                new DragEvent('drop', {
                    dataTransfer: dt,
                    bubbles: true,
                    cancelable: true,
                    clientX: box.left + 20,
                    clientY: box.top + box.height / 2
                })
            )
        },
        pics.map((x) => ({ b64: x.data.toString('base64'), name: x.name, type: x.type }))
    )
}

const send = async (win: Page): Promise<void> => {
    await win.getByTestId('send').click()
}

test('a pasted picture is shown in the draft, sent, saved in the file, and shown again after reopening (FR-065, FR-066, FR-068)', async () => {
    const dir = await workDir()
    const file = join(dir, 'картинки.branchchat')
    const { t, win } = await newDiscussion(file)
    const pic = png([200, 40, 40])

    await paste(win, pic)
    await expect(draftImages(win)).toHaveCount(1)
    await expect(draftImages(win)).toHaveAttribute(
        'src',
        /^bcasset:\/\/asset\/[0-9a-f-]+\/[0-9a-f]{64}$/
    )
    await expect.poll(() => naturalWidth(draftImages(win))).toBe(40) // the draft shows the real picture
    await composer(win).pressSequentially(' подпись')
    await send(win)

    const image = messageImages(win)
    await expect(image).toHaveCount(1)
    await expect.poll(() => naturalWidth(image)).toBe(40)
    await expect(win.getByTestId('message')).toContainText('подпись')
    await expect(win.getByTestId('status')).toHaveText('Сохранено')

    // in the file: one asset, content-addressed, with the exact bytes, referenced by the message
    const sha = sha256(pic.data)
    expect(await assetEntries(file)).toEqual([`assets/images/${sha}.png`])
    expect((await readEntries(file)).get(`assets/images/${sha}.png`)!.equals(pic.data)).toBe(true)
    const saved = (await readDiscussionFile(file)).discussion as unknown as {
        assets: { assetId: string; mediaType: string }[]
    }
    expect(saved.assets).toMatchObject([{ assetId: sha, mediaType: 'image/png' }])

    // reopen the application
    await t.close()
    const again = await open(file, t.userData)
    await expect(messageImages(again.win)).toHaveCount(1)
    await expect.poll(() => naturalWidth(messageImages(again.win))).toBe(40)

    // a copy of the file on another computer shows the same picture: the data travels inside the file
    const elsewhere = join(await workDir(), 'копия.branchchat')
    await fs.copyFile(file, elsewhere)
    const other = await open(elsewhere)
    await expect.poll(() => naturalWidth(messageImages(other.win))).toBe(40)
})

test('a picture copied to the real system clipboard can be pasted with Ctrl+V', async () => {
    const { t, win } = await newDiscussion(join(await workDir(), 'буфер.branchchat'))
    const pic = png([20, 120, 200], 64)
    // This Electron version has the asynchronous, web-style clipboard: wait until the picture is really on it.
    await t.app.evaluate(async (electron, b64) => {
        const { clipboard, ClipboardItem } = electron as unknown as {
            clipboard: { write(items: unknown[]): Promise<void> }
            ClipboardItem: new (items: Record<string, Blob>) => unknown
        }
        const blob = new Blob([Buffer.from(b64, 'base64')], { type: 'image/png' })
        await clipboard.write([new ClipboardItem({ 'image/png': blob })])
    }, pic.data.toString('base64'))
    await composer(win).click()
    await win.keyboard.press('Control+v')
    await expect(draftImages(win)).toHaveCount(1)
    await send(win)
    await expect.poll(() => naturalWidth(messageImages(win))).toBe(64)
})

test('pictures can be dropped into the draft and chosen from a file (FR-065, FR-067)', async () => {
    const dir = await workDir()
    const file = join(dir, 'способы.branchchat')
    const { t, win } = await newDiscussion(file)

    await composer(win).click()
    await win.keyboard.type('перед картинкой')
    await drop(win, png([10, 160, 60], 30, 'сброшенная.png'))
    await expect(draftImages(win)).toHaveCount(1)
    await expect(composer(win)).toContainText('перед картинкой')

    // "Insert image…" opens a file chooser; cancelling inserts nothing
    const chosen = join(dir, 'выбранная.png')
    await fs.writeFile(chosen, makePng(50, 50, [120, 30, 160]))
    await win.getByTestId('tb-image').click() // no answer queued: the chooser is cancelled
    await expect(draftImages(win)).toHaveCount(1)
    await t.answer({ open: [chosen] })
    await win.getByTestId('tb-image').click()
    await expect(draftImages(win)).toHaveCount(2)

    await send(win)
    await expect(messageImages(win)).toHaveCount(2)
    await expect(win.getByTestId('status')).toHaveText('Сохранено')
    expect(await assetEntries(file)).toHaveLength(2)
})

test('a message with only a picture can be sent; an unsent picture counts as a draft (FR-008)', async () => {
    const dir = await workDir()
    const file = join(dir, 'только-картинка.branchchat')
    const { t, win } = await newDiscussion(file)
    await expect(win.getByTestId('send')).toBeDisabled()
    await paste(win, png([200, 200, 40]))
    await expect(draftImages(win)).toHaveCount(1)
    await expect(win.getByTestId('send')).toBeEnabled()

    // closing with only a picture in the draft warns; "cancel" keeps the window
    await t.answer({ box: [1] })
    await t.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close())
    await expect
        .poll(async () => (await t.dialogs()).filter((d) => d.kind === 'box').length)
        .toBe(1)
    await expect(draftImages(win)).toHaveCount(1)

    await send(win)
    await expect(messageImages(win)).toHaveCount(1)
    await expect(composer(win).locator('img')).toHaveCount(0) // the draft is empty again
    await expect(win.getByTestId('status')).toHaveText('Сохранено')
    const thread = await savedThread(file)
    expect(thread.messages).toHaveLength(1)
    expect(plainTextOf(thread.messages[0]!.content)).toBe('') // no text at all
})

test('the same picture is stored once, however often it is sent (deduplicated by checksum)', async () => {
    const dir = await workDir()
    const file = join(dir, 'дубликаты.branchchat')
    const { win } = await newDiscussion(file)
    const pic = png([90, 90, 200])
    await paste(win, pic, pic) // twice in one draft
    await expect(draftImages(win)).toHaveCount(2)
    await send(win)
    await paste(win, pic) // and again in a second message
    await send(win)
    await expect(messageImages(win)).toHaveCount(3)
    await expect(win.getByTestId('status')).toHaveText('Сохранено')
    expect(await assetEntries(file)).toEqual([`assets/images/${sha256(pic.data)}.png`])
    expect((await savedThread(file)).messages).toHaveLength(2)
})

test('a picture that is never sent leaves no trace in the file', async () => {
    const dir = await workDir()
    const file = join(dir, 'без-следа.branchchat')
    const { win } = await newDiscussion(file)
    await paste(win, png([1, 2, 3]))
    await expect(draftImages(win)).toHaveCount(1)
    // remove the picture from the draft, then send text only
    await composer(win).press('Backspace')
    await expect(draftImages(win)).toHaveCount(0)
    await composer(win).pressSequentially('только текст')
    await send(win)
    await expect(win.getByTestId('status')).toHaveText('Сохранено')
    expect(await assetEntries(file)).toEqual([])
})

test('unsupported types are refused with a clear message: SVG, BMP, and files that are not pictures (FR-116)', async () => {
    const dir = await workDir()
    const { t, win } = await newDiscussion(join(dir, 'типы.branchchat'))
    const refusal = win.getByRole('alert').filter({ hasText: 'PNG, JPEG, GIF и WebP' })

    const svg: Pic = {
        data: Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>1</script></svg>'
        ),
        name: 'рисунок.svg',
        type: 'image/svg+xml'
    }
    await paste(win, svg)
    await expect(refusal).toBeVisible()
    await expect(draftImages(win)).toHaveCount(0)

    // a BMP chosen in the file chooser
    const bmp = join(dir, 'старый.bmp')
    await fs.writeFile(bmp, Buffer.concat([Buffer.from('BM'), Buffer.alloc(60)]))
    await win.getByTestId('send').evaluate(() => undefined) // keep focus handling simple
    await t.answer({ open: [bmp] })
    await win.getByTestId('tb-image').click()
    await expect(refusal).toBeVisible()
    await expect(draftImages(win)).toHaveCount(0)

    // a file named .png that is not a PNG
    const fake = join(dir, 'притворяется.png')
    await fs.writeFile(fake, 'MZ this is a program, not a picture')
    await t.answer({ open: [fake] })
    await win.getByTestId('tb-image').click()
    await expect(refusal).toBeVisible()
    await expect(draftImages(win)).toHaveCount(0)
    await expect(win.getByTestId('send')).toBeDisabled() // nothing to send
})

test('missing, damaged and undecodable pictures show placeholders; the discussion still opens (FR-075)', async () => {
    const dir = await workDir()
    const file = join(dir, 'повреждённые.branchchat')
    const good = makePng(30, 30, [0, 150, 0])
    const missing = makePng(31, 31, [150, 0, 0])
    const corrupt = makePng(32, 32, [0, 0, 150])
    // valid PNG signature, correct checksum, but not decodable by the browser
    const undecodable = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from('not really an image')
    ])
    await writeDiscussionFile(
        file,
        [
            {
                id: 'main',
                messages: [
                    {
                        id: 'm1',
                        author: 'boris',
                        content: doc(p(t('Нормальная картинка: '), img(sha256(good))))
                    },
                    {
                        id: 'm2',
                        author: 'boris',
                        content: doc(p(t('Данных нет: '), img(sha256(missing))))
                    },
                    {
                        id: 'm3',
                        author: 'boris',
                        content: doc(p(t('Данные повреждены: '), img(sha256(corrupt))))
                    },
                    {
                        id: 'm4',
                        author: 'boris',
                        content: doc(p(t('Не открывается: '), img(sha256(undecodable))))
                    },
                    {
                        id: 'm5',
                        author: 'boris',
                        content: simple('Последнее сообщение без картинок.')
                    }
                ]
            }
        ],
        {
            assets: [
                { data: good },
                { data: missing, mode: 'missing' },
                { data: corrupt, mode: 'corrupt' },
                { data: undecodable }
            ]
        }
    )
    const { win } = await open(file)
    await expect(win.getByTestId('message')).toHaveCount(5) // everything opened
    await expect(win.getByText('Последнее сообщение без картинок.')).toBeVisible()
    await expect(win.getByTestId('image-placeholder')).toHaveCount(3)
    await expect.poll(() => naturalWidth(messageImages(win).first())).toBe(30)
    await expect(win.locator('[data-message-id=m2]').getByTestId('image-placeholder')).toBeVisible()
    await expect(win.locator('[data-message-id=m3]').getByTestId('image-placeholder')).toBeVisible()
    await expect(win.locator('[data-message-id=m4]').getByTestId('image-placeholder')).toBeVisible()
    await expect(win.locator('[data-message-id=m2]')).toContainText('Данных нет') // the text next to it is fine
})

test('clicking a picture opens a larger view that closes with Escape, the button, or a click outside (FR-069)', async () => {
    const dir = await workDir()
    const file = join(dir, 'просмотр.branchchat')
    const big = makePng(900, 600, [60, 60, 200])
    await writeDiscussionFile(
        file,
        [
            {
                id: 'main',
                messages: [{ id: 'm1', author: 'boris', content: doc(p(img(sha256(big)))) }]
            }
        ],
        {
            assets: [{ data: big }]
        }
    )
    const { win } = await open(file)
    const thumb = messageImages(win).first()
    await expect.poll(() => naturalWidth(thumb)).toBe(900)
    const thumbWidth = (await thumb.boundingBox())!.width

    await win.getByTestId('image-button').click()
    const viewer = win.getByTestId('image-viewer')
    await expect(viewer).toBeVisible()
    const viewerWidth = (await win.getByTestId('viewer-image').boundingBox())!.width
    expect(viewerWidth).toBeGreaterThan(thumbWidth) // larger than in the message

    await win.keyboard.press('Escape')
    await expect(viewer).toHaveCount(0)

    await win.getByTestId('image-button').click()
    await win.getByTestId('viewer-image').click() // clicking the picture itself does not close it
    await expect(viewer).toBeVisible()
    await win.getByTestId('viewer-close').click()
    await expect(viewer).toHaveCount(0)

    await win.getByTestId('image-button').click()
    await viewer.click({ position: { x: 5, y: 5 } }) // outside the picture
    await expect(viewer).toHaveCount(0)
})

test('pictures do not disturb text selection or branches: the quote around a picture is plain text (FR-049)', async () => {
    const dir = await workDir()
    const file = join(dir, 'ветка-с-картинкой.branchchat')
    const pic = makePng(20, 20, [30, 30, 30])
    await writeDiscussionFile(
        file,
        [
            {
                id: 'main',
                messages: [
                    {
                        id: 'm1',
                        author: 'boris',
                        content: doc(p(t('до '), img(sha256(pic)), t(' после')))
                    }
                ]
            }
        ],
        {
            assets: [{ data: pic }]
        }
    )
    const { win } = await open(file)
    const message = win.locator('[data-message-id=m1]')
    await expect.poll(() => naturalWidth(message.getByTestId('message-image'))).toBe(20)

    await expectLayoutSettled(message) // the list re-measures after a picture loads; select only afterwards
    await selectText(message, 'до', 'после')
    await win.getByTestId('reply-to-this').click()
    await expect(win.getByTestId('branch-header')).toBeVisible()
    expect(await win.getByTestId('branch-quote').textContent()).toBe('до  после') // the picture adds nothing to the text
    const marked = (
        await win.getByTestId('inherited-message').locator('mark.quote').allTextContents()
    ).join('')
    expect(marked).toBe('до  после')
    await expect(win.getByTestId('inherited-message').getByTestId('message-image')).toHaveCount(1) // still shown

    const thread = (await readDiscussionFile(file)).discussion.threads.find(
        (th) => th.parentThreadId
    )!
    const plain = plainTextOf((await savedThread(file)).messages[0]!.content)
    expect(plain.slice(thread.selectionStart, thread.selectionEnd)).toBe('до  после')
})

test('a picture at the bottom of a long discussion keeps the list scrolled to the end once it has loaded', async () => {
    const dir = await workDir()
    const file = join(dir, 'долгое.branchchat')
    const tall = makePng(300, 900, [200, 120, 0])
    const messages = Array.from({ length: 30 }, (_, i) => ({
        id: `m${i}`,
        author: 'boris' as const,
        content: simple(`Сообщение ${i}`)
    }))
    messages.push({
        id: 'last',
        author: 'boris',
        content: doc(p(t('Последнее с картинкой'), img(sha256(tall))))
    })
    await writeDiscussionFile(file, [{ id: 'main', messages }], { assets: [{ data: tall }] })
    const { win } = await open(file)
    await expect.poll(() => naturalWidth(messageImages(win).last())).toBe(300)
    const list = win.getByTestId('messages')
    await expect
        .poll(() =>
            list.evaluate((el) => Math.round(el.scrollHeight - el.scrollTop - el.clientHeight))
        )
        .toBeLessThan(6)
    const image = await messageImages(win).last().boundingBox()
    const area = await list.boundingBox()
    expect(image!.y + image!.height).toBeLessThanOrEqual(area!.y + area!.height + 1) // fully in view
})

test('a very large picture is handled without freezing the window, and survives saving and reopening (NFR-015)', async () => {
    test.setTimeout(150_000)
    const dir = await workDir()
    const file = join(dir, 'большая.branchchat')
    const { t, win } = await newDiscussion(file)

    // about 18 MB of noise, made in the page so nothing large has to be sent from the test
    const started = Date.now()
    await composer(win).click()
    await win.evaluate(async () => {
        const canvas = document.createElement('canvas')
        canvas.width = 3000
        canvas.height = 2000
        const g = canvas.getContext('2d')!
        const data = g.createImageData(3000, 2000)
        crypto.getRandomValues(data.data.subarray(0, 65536)) // getRandomValues is limited to 64 KB per call
        const noise = data.data.slice(0, 65536)
        for (let i = 65536; i < data.data.length; i += 65536)
            data.data.set(noise.subarray(0, Math.min(65536, data.data.length - i)), i) // repeat the noise: cheap, and a PNG cannot squeeze it (its window is 32 KB)
        for (let i = 3; i < data.data.length; i += 4) data.data[i] = 255
        g.putImageData(data, 0, 0)
        const blob: Blob = await new Promise((resolve) =>
            canvas.toBlob((b) => resolve(b!), 'image/png')
        )
        const dt = new DataTransfer()
        dt.items.add(new File([blob], 'большая.png', { type: 'image/png' }))
        document
            .querySelector('[data-testid=composer]')!
            .dispatchEvent(
                new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
            )
    })
    await expect(draftImages(win)).toHaveCount(1, { timeout: 60_000 })
    const insertedMs = Date.now() - started

    // the window stays usable while the picture is sent and saved
    await send(win)
    const typedAt = Date.now()
    await composer(win).pressSequentially('печатаю во время сохранения', { delay: 10 })
    const typedMs = Date.now() - typedAt
    await expect(composer(win)).toContainText('печатаю во время сохранения')
    await expect(win.getByTestId('status')).toHaveText('Сохранено', { timeout: 90_000 })
    const savedMs = Date.now() - started

    const names = await assetEntries(file)
    expect(names).toHaveLength(1)
    const size = (await readEntries(file)).get(names[0]!)!.length
    expect(size).toBeGreaterThan(5 * 1024 * 1024) // really large

    await t.close()
    const again = await open(file, t.userData)
    await expect.poll(() => naturalWidth(messageImages(again.win)), { timeout: 60_000 }).toBe(3000)

    const metrics = {
        imageBytes: size,
        insertedMs,
        typedWhileSavingMs: typedMs,
        sentAndSavedMs: savedMs
    }
    console.log('large image metrics', JSON.stringify(metrics))
    test.info().annotations.push({ type: 'metrics', description: JSON.stringify(metrics) })
    expect(typedMs).toBeLessThan(4000)
})
