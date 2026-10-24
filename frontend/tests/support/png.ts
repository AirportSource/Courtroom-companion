// Test-only PNG helpers built on zlib: header inspection and pixel decoding (8-bit, non-interlaced,
// colour types 0/2/4/6), so pixel identity can be checked without any image dependency. Not part
// of the app; the tests\*.test.ts glob does not pick this file up.
import { inflateSync } from 'node:zlib'

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 }

export interface PngHeader {
  width: number
  height: number
  bitDepth: number
  colorType: number
}

/** Decoded pixels as packed RGBA (4 bytes per pixel, alpha 255 when the source has none). */
export interface DecodedPng extends PngHeader {
  rgba: Buffer
}

export function readPngHeader(buf: Buffer): PngHeader {
  if (buf.length < 26 || SIGNATURE.some((byte, i) => buf[i] !== byte) || buf.toString('latin1', 12, 16) !== 'IHDR') {
    throw new Error('not a PNG file')
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    colorType: buf[25],
  }
}

export function decodePng(buf: Buffer): DecodedPng {
  const header = readPngHeader(buf)
  const { width, height, bitDepth, colorType } = header
  if (bitDepth !== 8 || !(colorType in CHANNELS)) {
    throw new Error(`unsupported PNG: bit depth ${bitDepth}, colour type ${colorType}`)
  }
  if (buf[28] !== 0) throw new Error('interlaced PNG is not supported')

  const idat: Buffer[] = []
  let pos = 8
  while (pos < buf.length) {
    const length = buf.readUInt32BE(pos)
    const type = buf.toString('latin1', pos + 4, pos + 8)
    if (type === 'IDAT') idat.push(buf.subarray(pos + 8, pos + 8 + length))
    if (type === 'IEND') break
    pos += 12 + length
  }

  const bpp = CHANNELS[colorType]
  const stride = width * bpp
  const raw = inflateSync(Buffer.concat(idat))
  const out = Buffer.alloc(stride * height)
  let previous = Buffer.alloc(stride)
  let p = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[p++]
    const line = out.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x++) {
      const byte = raw[p++]
      const a = x >= bpp ? line[x - bpp] : 0
      const b = previous[x]
      const c = x >= bpp ? previous[x - bpp] : 0
      let predictor: number
      if (filter === 0) predictor = 0
      else if (filter === 1) predictor = a
      else if (filter === 2) predictor = b
      else if (filter === 3) predictor = (a + b) >> 1
      else if (filter === 4) {
        const pa = Math.abs(b - c)
        const pb = Math.abs(a - c)
        const pc = Math.abs(a + b - 2 * c)
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      } else throw new Error(`bad PNG filter ${filter}`)
      line[x] = (byte + predictor) & 255
    }
    previous = line
  }

  const rgba = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const s = i * bpp
    const d = i * 4
    if (colorType === 0 || colorType === 4) {
      rgba[d] = rgba[d + 1] = rgba[d + 2] = out[s]
      rgba[d + 3] = colorType === 4 ? out[s + 1] : 255
    } else {
      rgba[d] = out[s]
      rgba[d + 1] = out[s + 1]
      rgba[d + 2] = out[s + 2]
      rgba[d + 3] = colorType === 6 ? out[s + 3] : 255
    }
  }
  return { ...header, rgba }
}

/** Copies a w×h rectangle at (x, y) out of decoded RGBA pixels. */
export function cropRgba(png: DecodedPng, x: number, y: number, w: number, h: number): Buffer {
  const out = Buffer.alloc(w * h * 4)
  for (let row = 0; row < h; row++) {
    const from = ((y + row) * png.width + x) * 4
    png.rgba.copy(out, row * w * 4, from, from + w * 4)
  }
  return out
}

/** Counts RGB channel differences between two RGBA buffers of equal length (alpha ignored). */
export function rgbDifferences(a: Buffer, b: Buffer): number {
  let differences = 0
  for (let i = 0; i < a.length; i += 4) {
    for (let k = 0; k < 3; k++) if (a[i + k] !== b[i + k]) differences++
  }
  return differences
}
