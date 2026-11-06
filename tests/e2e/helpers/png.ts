import { randomFillSync } from 'node:crypto'
import { deflateSync } from 'node:zlib'

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const out = Buffer.alloc(8 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), 8 + data.length)
  return out
}

/**
 * A real, decodable PNG of one color (or random noise). `color` makes pictures differ, so each has its own checksum.
 * Noise is stored without compression, so the file is about as large as the raw pixels (for "large image" tests).
 */
export function makePng(
  width: number,
  height: number,
  color: [number, number, number] = [200, 40, 40],
  noise = false
): Buffer {
  const rowLength = 1 + width * 3
  const raw = Buffer.alloc(rowLength * height)
  if (noise) randomFillSync(raw)
  for (let y = 0; y < height; y++) {
    const row = y * rowLength
    raw[row] = 0 // filter: none
    if (!noise) for (let x = 0; x < width; x++) raw.set(color, row + 1 + x * 3)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8) // 8 bit, RGB, deflate, no filter, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: noise ? 0 : 6 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}
