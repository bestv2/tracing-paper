/**
 * 最小 PNG 编解码：只依赖 Node 内置 zlib，覆盖 8bit 非隔行图像（截图与设计稿的常态）。
 * 浏览器侧不用它，走 canvas / createImageBitmap。
 */

import { deflateSync, inflateSync } from 'node:zlib'
import type { Raster } from '../types'

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

interface Header {
  width: number
  height: number
  bitDepth: number
  colorType: number
  interlace: number
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

export function decodePng(input: Uint8Array): Raster {
  for (let i = 0; i < SIGNATURE.length; i += 1) {
    if (input[i] !== SIGNATURE[i]) throw new Error('不是 PNG 文件')
  }

  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  let offset = 8
  let header: Header | null = null
  const idat: Uint8Array[] = []
  let palette: Uint8Array | null = null
  let transparency: Uint8Array | null = null

  while (offset + 8 <= input.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(input[offset + 4], input[offset + 5], input[offset + 6], input[offset + 7])
    const dataStart = offset + 8
    const data = input.subarray(dataStart, dataStart + length)

    if (type === 'IHDR') {
      header = {
        width: view.getUint32(dataStart),
        height: view.getUint32(dataStart + 4),
        bitDepth: input[dataStart + 8],
        colorType: input[dataStart + 9],
        interlace: input[dataStart + 12],
      }
    } else if (type === 'PLTE') {
      palette = data.slice()
    } else if (type === 'tRNS') {
      transparency = data.slice()
    } else if (type === 'IDAT') {
      idat.push(data.slice())
    } else if (type === 'IEND') {
      break
    }
    offset = dataStart + length + 4
  }

  if (!header) throw new Error('PNG 缺少 IHDR')
  if (header.bitDepth !== 8) throw new Error(`暂不支持 ${header.bitDepth}bit PNG，请先转成 8bit`)
  if (header.interlace !== 0) throw new Error('暂不支持隔行 PNG')

  const channels = CHANNELS[header.colorType]
  if (!channels) throw new Error(`暂不支持 PNG colorType=${header.colorType}`)

  const raw = inflateSync(idat.length ? Buffer.concat(idat) : Buffer.alloc(0))
  const { width, height } = header
  const stride = width * channels
  const pixels = new Uint8Array(stride * height)
  let pointer = 0

  for (let y = 0; y < height; y += 1) {
    const filter = raw[pointer]
    pointer += 1
    const rowStart = y * stride
    const prevStart = rowStart - stride
    for (let x = 0; x < stride; x += 1) {
      const value = raw[pointer + x]
      const left = x >= channels ? pixels[rowStart + x - channels] : 0
      const up = y > 0 ? pixels[prevStart + x] : 0
      const upLeft = y > 0 && x >= channels ? pixels[prevStart + x - channels] : 0
      let result = value
      if (filter === 1) result = value + left
      else if (filter === 2) result = value + up
      else if (filter === 3) result = value + ((left + up) >> 1)
      else if (filter === 4) result = value + paeth(left, up, upLeft)
      pixels[rowStart + x] = result & 0xff
    }
    pointer += stride
  }

  const data = new Uint8ClampedArray(width * height * 4)
  let hasAlpha = false

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = y * stride + x * channels
      const target = (y * width + x) * 4
      let r = 0
      let g = 0
      let b = 0
      let a = 255

      if (header.colorType === 0) {
        r = g = b = pixels[source]
        if (transparency && transparency.length >= 2) {
          const key = (transparency[0] << 8) | transparency[1]
          if (r === key) a = 0
        }
      } else if (header.colorType === 2) {
        r = pixels[source]
        g = pixels[source + 1]
        b = pixels[source + 2]
        if (transparency && transparency.length >= 6) {
          const kr = (transparency[0] << 8) | transparency[1]
          const kg = (transparency[2] << 8) | transparency[3]
          const kb = (transparency[4] << 8) | transparency[5]
          if (r === kr && g === kg && b === kb) a = 0
        }
      } else if (header.colorType === 3) {
        const index = pixels[source] * 3
        if (!palette) throw new Error('调色板 PNG 缺少 PLTE')
        r = palette[index]
        g = palette[index + 1]
        b = palette[index + 2]
        if (transparency && transparency.length > pixels[source]) a = transparency[pixels[source]]
      } else if (header.colorType === 4) {
        r = g = b = pixels[source]
        a = pixels[source + 1]
      } else {
        r = pixels[source]
        g = pixels[source + 1]
        b = pixels[source + 2]
        a = pixels[source + 3]
      }

      data[target] = r
      data[target + 1] = g
      data[target + 2] = b
      data[target + 3] = a
      if (a < 255) hasAlpha = true
    }
  }

  return { width, height, data, hasAlpha }
}

function chunk(type: string, payload: Uint8Array): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(payload.length, 0)
  head.write(type, 4, 'ascii')
  const crcInput = Buffer.concat([head.subarray(4, 8), Buffer.from(payload)])
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc32(crcInput), 0)
  return Buffer.concat([head, Buffer.from(payload), tail])
}

export function encodePng(raster: Raster): Uint8Array {
  const { width, height } = raster
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    const source = raster.data.subarray(y * stride, y * stride + stride)
    Buffer.from(source.buffer, source.byteOffset, source.byteLength).copy(raw, y * (stride + 1) + 1)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from(SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
