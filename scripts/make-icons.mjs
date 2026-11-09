// Generates build/icon.ico (application and installer) and build/document.ico (.branchchat files in Explorer).
// Pure Node, no dependencies. These are first-draft icons; replace the two .ico files to change the look.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SIZES = [16, 24, 32, 48, 64, 128, 256]
const BLUE = [47, 111, 237]
const WHITE = [255, 255, 255]

// --- shapes: each returns true if the point (x, y in 0..1) is inside -------------------------------------------
const roundRect = (x, y, x0, y0, x1, y1, r) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false
    const cx = Math.min(Math.max(x, x0 + r), x1 - r)
    const cy = Math.min(Math.max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}
const segment = (x, y, ax, ay, bx, by, w) => {
    const dx = bx - ax
    const dy = by - ay
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
    return (x - (ax + t * dx)) ** 2 + (y - (ay + t * dy)) ** 2 <= (w / 2) ** 2
}
const disc = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r

/** The branch glyph: a trunk with a fork, drawn inside the box (bx, by, size s). */
function glyph(x, y, bx, by, s) {
    const p = (u, v) => [bx + u * s, by + v * s]
    const [ax, ay] = p(0.3, 0.2)
    const [cx, cy] = p(0.3, 0.8)
    const [fx, fy] = p(0.3, 0.62)
    const [ex, ey] = p(0.72, 0.36)
    const w = 0.085 * s
    return (
        segment(x, y, ax, ay, cx, cy, w) ||
        segment(x, y, fx, fy, ex, ey, w) ||
        disc(x, y, ax, ay, 0.13 * s) ||
        disc(x, y, cx, cy, 0.13 * s) ||
        disc(x, y, ex, ey, 0.13 * s)
    )
}

// Each layer: [color, inside(x, y)]; later layers paint over earlier ones.
const appLayers = [
    [BLUE, (x, y) => roundRect(x, y, 0.04, 0.04, 0.96, 0.96, 0.22)],
    [WHITE, (x, y) => glyph(x, y, 0.12, 0.12, 0.76)]
]

const FOLD = 0.22
const inPage = (x, y, grow = 0) => {
    const x0 = 0.17 - grow
    const x1 = 0.83 + grow
    const y0 = 0.05 - grow
    const y1 = 0.95 + grow
    if (x < x0 || x > x1 || y < y0 || y > y1) return false
    // cut off the top-right corner
    return (
        x - x1 + FOLD + grow * 1.4 <= y - y0 + 0 ||
        y - y0 >= FOLD + grow * 1.4 ||
        x <= x1 - FOLD - grow * 1.4
    )
}
const docLayers = [
    [[120, 130, 150], (x, y) => inPage(x, y, 0.02)],
    [[250, 251, 253], (x, y) => inPage(x, y)],
    [
        [205, 212, 226],
        (x, y) =>
            x > 0.83 - FOLD &&
            y < 0.05 + FOLD &&
            x - (0.83 - FOLD) <= y - 0.05 + 0.0 &&
            inPage(x, y, 0.02)
    ],
    [BLUE, (x, y) => glyph(x, y, 0.27, 0.3, 0.5)]
]

function render(layers, size) {
    const N = 4
    const px = Buffer.alloc(size * size * 4)
    for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
            let r = 0,
                g = 0,
                b = 0,
                a = 0
            for (let sj = 0; sj < N; sj++) {
                for (let si = 0; si < N; si++) {
                    const x = (i + (si + 0.5) / N) / size
                    const y = (j + (sj + 0.5) / N) / size
                    let color = null
                    for (const [c, inside] of layers) if (inside(x, y)) color = c
                    if (color) {
                        r += color[0]
                        g += color[1]
                        b += color[2]
                        a += 1
                    }
                }
            }
            const o = (j * size + i) * 4
            if (a > 0) {
                px[o] = Math.round(r / a)
                px[o + 1] = Math.round(g / a)
                px[o + 2] = Math.round(b / a)
                px[o + 3] = Math.round((a / (N * N)) * 255)
            }
        }
    }
    return px
}

// --- PNG encoding ----------------------------------------------------------------------------------------------
const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
})
const crc32 = (buf) => {
    let c = 0xffffffff
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
}
function png(rgba, size) {
    const raw = Buffer.alloc((size * 4 + 1) * size)
    for (let y = 0; y < size; y++) {
        raw[y * (size * 4 + 1)] = 0
        rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
    }
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(size, 0)
    ihdr.writeUInt32BE(size, 4)
    ihdr[8] = 8 // bit depth
    ihdr[9] = 6 // RGBA
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0))
    ])
}

// --- ICO container (PNG-compressed entries, supported since Windows Vista) --------------------------------------
function ico(layers) {
    const images = SIZES.map((s) => png(render(layers, s), s))
    const header = Buffer.alloc(6)
    header.writeUInt16LE(1, 2) // type: icon
    header.writeUInt16LE(images.length, 4)
    const dir = Buffer.alloc(16 * images.length)
    let offset = header.length + dir.length
    images.forEach((img, i) => {
        const s = SIZES[i]
        dir[i * 16] = s === 256 ? 0 : s
        dir[i * 16 + 1] = s === 256 ? 0 : s
        dir.writeUInt16LE(1, i * 16 + 4) // planes
        dir.writeUInt16LE(32, i * 16 + 6) // bits per pixel
        dir.writeUInt32LE(img.length, i * 16 + 8)
        dir.writeUInt32LE(offset, i * 16 + 12)
        offset += img.length
    })
    return Buffer.concat([header, dir, ...images])
}

mkdirSync(join(root, 'build'), { recursive: true })
writeFileSync(join(root, 'build', 'icon.ico'), ico(appLayers))
writeFileSync(join(root, 'build', 'document.ico'), ico(docLayers))
