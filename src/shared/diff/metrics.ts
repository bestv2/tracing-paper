/**
 * 像素级度量：全图只做一次 ΔE2000 计算，网格判定、区域结论、差异渲染都复用同一份场，
 * 保证"判定用哪个数、报告里就报哪个数"。所有操作都在 0–255 亮度与 Lab 空间内完成。
 */

import type { Raster, Rect } from './types'
import { deltaE2000, type Lab } from './color'
import { averageColor, clampRect, labField, lumaField } from './raster'

/** 一对栅格的逐像素度量场 */
export interface DiffField {
  width: number
  height: number
  /** 每像素 ΔE2000 */
  deltaE: Float32Array
  lumaA: Float32Array
  lumaB: Float32Array
}

export function buildDiffField(expected: Raster, actual: Raster): DiffField {
  // 调用方需先把两侧尺寸归一（compareRasters 已做）
  const { width, height } = expected
  const count = width * height
  const labA = labField(expected)
  const labB = labField(actual)
  const lumaA = lumaField(expected)
  const lumaB = lumaField(actual)
  const deltaE = new Float32Array(count)

  const left: Lab = [0, 0, 0]
  const right: Lab = [0, 0, 0]
  for (let i = 0, p = 0; i < count; i += 1, p += 3) {
    left[0] = labA[p]
    left[1] = labA[p + 1]
    left[2] = labA[p + 2]
    right[0] = labB[p]
    right[1] = labB[p + 1]
    right[2] = labB[p + 2]
    deltaE[i] = deltaE2000(left, right)
  }

  return { width, height, deltaE, lumaA, lumaB }
}

const C1 = (0.01 * 255) ** 2
const C2 = (0.03 * 255) ** 2

function ssimOf(sumA: number, sumB: number, sumAA: number, sumBB: number, sumAB: number, n: number): number {
  const meanA = sumA / n
  const meanB = sumB / n
  const varA = Math.max(0, sumAA / n - meanA * meanA)
  const varB = Math.max(0, sumBB / n - meanB * meanB)
  const cov = sumAB / n - meanA * meanB
  const num = (2 * meanA * meanB + C1) * (2 * cov + C2)
  const den = (meanA * meanA + meanB * meanB + C1) * (varA + varB + C2)
  return den === 0 ? 1 : Math.max(-1, Math.min(1, num / den))
}

export interface TileStats {
  cols: number
  rows: number
  tile: number
  /** 每格平均 ΔE2000 */
  meanDeltaE: Float32Array
  /** 每格结构相似度 */
  ssim: Float32Array
  /** 每格亮度均值（A 侧 / B 侧） */
  lumaMeanA: Float32Array
  lumaMeanB: Float32Array
  /** 每格梯度强度（A 侧 / B 侧），用于区分"结构变化"与"颜色变化" */
  edgeA: Float32Array
  edgeB: Float32Array
}

/** 单趟遍历：ΔE 均值、亮度一/二阶矩（算 SSIM）、Sobel 梯度 */
export function analyzeTiles(field: DiffField, tile: number): TileStats {
  const cols = Math.max(1, Math.ceil(field.width / tile))
  const rows = Math.max(1, Math.ceil(field.height / tile))
  const cells = cols * rows
  const sumDE = new Float32Array(cells)
  const sumA = new Float32Array(cells)
  const sumB = new Float32Array(cells)
  const sumAA = new Float32Array(cells)
  const sumBB = new Float32Array(cells)
  const sumAB = new Float32Array(cells)
  const edgeA = new Float32Array(cells)
  const edgeB = new Float32Array(cells)
  const counts = new Float32Array(cells)
  const { width, height, lumaA, lumaB, deltaE } = field

  for (let y = 0; y < height; y += 1) {
    const rowBase = Math.floor(y / tile) * cols
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      const cell = rowBase + Math.floor(x / tile)
      const a = lumaA[index]
      const b = lumaB[index]
      sumDE[cell] += deltaE[index]
      sumA[cell] += a
      sumB[cell] += b
      sumAA[cell] += a * a
      sumBB[cell] += b * b
      sumAB[cell] += a * b
      counts[cell] += 1

      if (x > 0 && y > 0 && x < width - 1 && y < height - 1) {
        const gx = -lumaA[index - width - 1] + lumaA[index - width + 1] - 2 * lumaA[index - 1] + 2 * lumaA[index + 1] - lumaA[index + width - 1] + lumaA[index + width + 1]
        const gy = -lumaA[index - width - 1] - 2 * lumaA[index - width] - lumaA[index - width + 1] + lumaA[index + width - 1] + 2 * lumaA[index + width] + lumaA[index + width + 1]
        edgeA[cell] += Math.abs(gx) + Math.abs(gy)

        const hx = -lumaB[index - width - 1] + lumaB[index - width + 1] - 2 * lumaB[index - 1] + 2 * lumaB[index + 1] - lumaB[index + width - 1] + lumaB[index + width + 1]
        const hy = -lumaB[index - width - 1] - 2 * lumaB[index - width] - lumaB[index - width + 1] + lumaB[index + width - 1] + 2 * lumaB[index + width] + lumaB[index + width + 1]
        edgeB[cell] += Math.abs(hx) + Math.abs(hy)
      }
    }
  }

  const meanDeltaE = new Float32Array(cells)
  const ssim = new Float32Array(cells)
  const lumaMeanA = new Float32Array(cells)
  const lumaMeanB = new Float32Array(cells)
  for (let cell = 0; cell < cells; cell += 1) {
    const n = counts[cell] || 1
    meanDeltaE[cell] = sumDE[cell] / n
    lumaMeanA[cell] = sumA[cell] / n
    lumaMeanB[cell] = sumB[cell] / n
    ssim[cell] = ssimOf(sumA[cell], sumB[cell], sumAA[cell], sumBB[cell], sumAB[cell], n)
    edgeA[cell] /= n
    edgeB[cell] /= n
  }

  return { cols, rows, tile, meanDeltaE, ssim, lumaMeanA, lumaMeanB, edgeA, edgeB }
}

export interface RegionStat {
  box: Rect
  /** 区域平均 ΔE2000（逐像素） */
  deltaE: number
  /** 区域结构相似度 */
  ssim: number
  /** 超阈值像素占比 */
  pixelRatio: number
  /** 两侧边缘能量差的归一化值，0 表示结构一致 */
  edgeDelta: number
  shift?: { dx: number; dy: number }
  expectedHex: string
  actualHex: string
  expectedEmpty: boolean
  actualEmpty: boolean
}

const EMPTY_STAT = {
  deltaE: 0,
  ssim: 1,
  pixelRatio: 0,
  edgeDelta: 0,
  expectedHex: '#000000',
  actualHex: '#000000',
  expectedEmpty: false,
  actualEmpty: false,
}

/** 区域级统计：直接复用全图 ΔE 场，不再逐像素重算色差 */
export function measureRegion(
  field: DiffField,
  expected: Raster,
  actual: Raster,
  box: Rect,
  pixelThreshold: number,
  shiftSearch: number,
  ignored?: Uint8Array,
): RegionStat {
  const clip = clampRect(box, field.width, field.height)
  if (!clip.w || !clip.h) return { box, ...EMPTY_STAT }

  const { width, lumaA, lumaB, deltaE } = field
  let sumDE = 0
  let changed = 0
  let sumA = 0
  let sumB = 0
  let sumAA = 0
  let sumBB = 0
  let sumAB = 0
  let count = 0

  for (let y = clip.y; y < clip.y + clip.h; y += 1) {
    const row = y * width
    for (let x = clip.x; x < clip.x + clip.w; x += 1) {
      const index = row + x
      if (ignored && ignored[index]) continue
      const dE = deltaE[index]
      sumDE += dE
      if (dE > pixelThreshold) changed += 1
      const a = lumaA[index]
      const b = lumaB[index]
      sumA += a
      sumB += b
      sumAA += a * a
      sumBB += b * b
      sumAB += a * b
      count += 1
    }
  }
  if (!count) return { box, ...EMPTY_STAT }

  // 水平梯度能量：结构一致时两侧接近，1 表示完全不同
  let edgeA = 0
  let edgeB = 0
  for (let y = clip.y; y < clip.y + clip.h; y += 1) {
    const row = y * width
    for (let x = Math.max(1, clip.x); x < Math.min(field.width - 1, clip.x + clip.w); x += 1) {
      const index = row + x
      if (ignored && (ignored[index] || ignored[index - 1] || ignored[index + 1])) continue
      edgeA += Math.abs(lumaA[index + 1] - lumaA[index - 1])
      edgeB += Math.abs(lumaB[index + 1] - lumaB[index - 1])
    }
  }

  const n = count
  const meanA = sumA / n
  const meanB = sumB / n
  const varA = Math.max(0, sumAA / n - meanA * meanA)
  const varB = Math.max(0, sumBB / n - meanB * meanB)
  const side = averageColor(expected, clip)
  const other = averageColor(actual, clip)

  return {
    box,
    deltaE: sumDE / n,
    ssim: ssimOf(sumA, sumB, sumAA, sumBB, sumAB, n),
    pixelRatio: changed / n,
    edgeDelta: Math.abs(edgeA - edgeB) / Math.max(1, edgeA + edgeB) * 2,
    shift: findShift(field, clip, shiftSearch),
    expectedHex: side.hex,
    actualHex: other.hex,
    expectedEmpty: Math.sqrt(varA) < 2.5,
    actualEmpty: Math.sqrt(varB) < 2.5,
  }
}

/** 在 ±r 内搜索使残差最小的整体位移（expected[x,y] ↔ actual[x+dx,y+dy]） */
function findShift(field: DiffField, clip: Rect, radius: number): { dx: number; dy: number } | undefined {
  if (radius <= 0 || clip.w < radius * 3 || clip.h < radius * 3) return undefined
  const { width, lumaA, lumaB } = field
  const step = Math.max(1, Math.floor(Math.min(clip.w, clip.h) / 70))

  const residual = (dx: number, dy: number) => {
    let sum = 0
    let n = 0
    const x0 = Math.max(clip.x, clip.x - dx)
    const y0 = Math.max(clip.y, clip.y - dy)
    const x1 = Math.min(clip.x + clip.w, clip.x + clip.w - dx)
    const y1 = Math.min(clip.y + clip.h, clip.y + clip.h - dy)
    for (let y = y0; y < y1; y += step) {
      const rowA = y * width
      const rowB = (y + dy) * width
      for (let x = x0; x < x1; x += step) {
        sum += Math.abs(lumaA[rowA + x] - lumaB[rowB + x + dx])
        n += 1
      }
    }
    return n ? sum / n : Number.POSITIVE_INFINITY
  }

  const base = residual(0, 0)
  if (!Number.isFinite(base) || base < 1) return undefined
  let best = { dx: 0, dy: 0, value: base }
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (!dx && !dy) continue
      const value = residual(dx, dy)
      if (value < best.value) best = { dx, dy, value }
    }
  }
  if (!best.dx && !best.dy) return undefined
  // 位移必须把残差显著压下去，否则只是噪声
  if (best.value > base * 0.72) return undefined
  return { dx: best.dx, dy: best.dy }
}

/** 区域中"变化像素"的外接框，用于区分尺寸变化与内容变化 */
export function changedBounds(field: DiffField, box: Rect, threshold: number, ignored?: Uint8Array): Rect | null {
  const clip = clampRect(box, field.width, field.height)
  if (!clip.w || !clip.h) return null
  const { width, deltaE } = field
  let minX = clip.w
  let minY = clip.h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < clip.h; y += 1) {
    const row = (clip.y + y) * width
    for (let x = 0; x < clip.w; x += 1) {
      const index = row + clip.x + x
      if (ignored && ignored[index]) continue
      if (deltaE[index] > threshold) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return { x: clip.x + minX, y: clip.y + minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}
