/**
 * 全局对齐：设计稿与截图之间常有整体错位（滚动、外边距、缩放取整），
 * 不对齐就会把整页判成一片差异。这里用 8/2/1 三级金字塔求一个整数位移。
 *
 * 符号约定：expected[x, y] ↔ actual[x + dx, y + dy]
 */

import type { MaskRect, Raster, Rect } from './types'
import { lumaField } from './raster'

export interface ShiftEstimate {
  dx: number
  dy: number
  /** 残差相对"零位移"的下降比例，0 表示这个位移没有意义 */
  gain: number
}

interface Level {
  a: Float32Array
  b: Float32Array
  w: number
  h: number
}

/** 盒式降采样，只用于位移搜索 */
function downsample(field: Float32Array, width: number, height: number, scale: number): Level {
  const w = Math.max(1, Math.floor(width / scale))
  const h = Math.max(1, Math.floor(height / scale))
  const data = new Float32Array(w * h)
  for (let y = 0; y < h; y += 1) {
    const y0 = y * scale
    const y1 = Math.min(height, y0 + scale)
    for (let x = 0; x < w; x += 1) {
      const x0 = x * scale
      const x1 = Math.min(width, x0 + scale)
      let sum = 0
      let count = 0
      for (let sy = y0; sy < y1; sy += 1) {
        const base = sy * width
        for (let sx = x0; sx < x1; sx += 1) {
          sum += field[base + sx]
          count += 1
        }
      }
      data[y * w + x] = count ? sum / count : 0
    }
  }
  return { a: data, b: data, w, h }
}

/** 把两路亮度场按同一比例降到 scale 分之一 */
function levelOf(lumaA: Float32Array, lumaB: Float32Array, width: number, height: number, scale: number): Level {
  const a = downsample(lumaA, width, height, scale)
  const b = downsample(lumaB, width, height, scale)
  return { a: a.a, b: b.b, w: a.w, h: a.h }
}

/** 平均绝对亮度差；重叠太小时返回 Infinity，避免"挪到只剩一条边"的假最优 */
function scoreAt(level: Level, dx: number, dy: number): number {
  const x0 = Math.max(0, -dx)
  const y0 = Math.max(0, -dy)
  const x1 = Math.min(level.w, level.w - dx)
  const y1 = Math.min(level.h, level.h - dy)
  const spanW = x1 - x0
  const spanH = y1 - y0
  if (spanW < 8 || spanH < 8) return Number.POSITIVE_INFINITY
  if (spanW * spanH < level.w * level.h * 0.4) return Number.POSITIVE_INFINITY

  const step = Math.max(1, Math.floor(Math.sqrt((spanW * spanH) / 160000)))
  let sum = 0
  let count = 0
  for (let y = y0; y < y1; y += step) {
    const rowA = y * level.w
    const rowB = (y + dy) * level.w
    for (let x = x0; x < x1; x += step) {
      sum += Math.abs(level.a[rowA + x] - level.b[rowB + x + dx])
      count += 1
    }
  }
  return count ? sum / count : Number.POSITIVE_INFINITY
}

/** 默认搜索半径：随图像短边放大，最多 64px */
export function defaultMaxShift(expected: Raster): number {
  const short = Math.min(expected.width, expected.height)
  return Math.max(8, Math.min(64, Math.round(short * 0.08)))
}

export function estimateShift(expected: Raster, actual: Raster, maxShift = defaultMaxShift(expected)): ShiftEstimate {
  if (maxShift <= 0 || expected.width !== actual.width || expected.height !== actual.height) {
    return { dx: 0, dy: 0, gain: 0 }
  }
  const lumaA = lumaField(expected)
  const lumaB = lumaField(actual)
  const { width, height } = expected

  let dx = 0
  let dy = 0
  let base = 0
  let best = 0
  const levels = [8, 2, 1]

  levels.forEach((scale, index) => {
    const level = levelOf(lumaA, lumaB, width, height, scale)
    const centerX = Math.round(dx / scale)
    const centerY = Math.round(dy / scale)
    const radius = index === 0 ? Math.max(1, Math.ceil(maxShift / scale)) : 2
    let localBest = Number.POSITIVE_INFINITY
    let localDx = centerX
    let localDy = centerY

    for (let cy = centerY - radius; cy <= centerY + radius; cy += 1) {
      for (let cx = centerX - radius; cx <= centerX + radius; cx += 1) {
        const value = scoreAt(level, cx, cy)
        if (value < localBest) {
          localBest = value
          localDx = cx
          localDy = cy
        }
      }
    }

    dx = localDx * scale
    dy = localDy * scale
    if (index === levels.length - 1) {
      base = scoreAt(level, 0, 0)
      best = localBest
    }
  })

  if (!Number.isFinite(base) || base <= 0.5) return { dx: 0, dy: 0, gain: 0 }
  const gain = Number.isFinite(best) ? Math.max(0, 1 - best / base) : 0
  return { dx, dy, gain: Number(gain.toFixed(4)) }
}

/** 按位移搬运像素，越界处夹取边缘（这些边缘随后会被掩膜掉） */
export function shiftRaster(source: Raster, dx: number, dy: number): Raster {
  if (!dx && !dy) return source
  const { width, height } = source
  const data = new Uint8ClampedArray(source.data.length)
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(height - 1, Math.max(0, y + dy))
    const from = sy * width
    const to = y * width
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(width - 1, Math.max(0, x + dx))
      const a = (from + sx) * 4
      const b = (to + x) * 4
      data[b] = source.data[a]
      data[b + 1] = source.data[a + 1]
      data[b + 2] = source.data[a + 2]
      data[b + 3] = source.data[a + 3]
    }
  }
  return { width, height, data, hasAlpha: source.hasAlpha }
}

/** 位移后没有真实像素可比的边带，必须排除，否则会凭空产生"差异" */
export function alignmentMasks(
  dx: number,
  dy: number,
  width: number,
  height: number,
  reason = '对齐留白',
): MaskRect[] {
  const masks: MaskRect[] = []
  if (dx > 0) masks.push({ x: width - dx, y: 0, w: dx, h: height, reason })
  if (dx < 0) masks.push({ x: 0, y: 0, w: -dx, h: height, reason })
  if (dy > 0) masks.push({ x: 0, y: height - dy, w: width, h: dy, reason })
  if (dy < 0) masks.push({ x: 0, y: 0, w: width, h: -dy, reason })
  return masks.filter((mask) => mask.w > 0 && mask.h > 0)
}

/** 对齐后真正可比的范围（设计稿坐标系） */
export function commonArea(width: number, height: number, dx: number, dy: number): Rect {
  return {
    x: Math.max(0, -dx),
    y: Math.max(0, -dy),
    w: Math.max(0, width - Math.abs(dx)),
    h: Math.max(0, height - Math.abs(dy)),
  }
}
