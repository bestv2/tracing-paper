import type { Raster, Rect } from './types'
import { luma, rgbToHex, rgbToLab, type Lab } from './color'

export function createRaster(width: number, height: number, data?: Uint8ClampedArray): Raster {
  return {
    width,
    height,
    data: data ?? new Uint8ClampedArray(width * height * 4),
    hasAlpha: true,
  }
}

export function cloneRaster(source: Raster): Raster {
  return {
    width: source.width,
    height: source.height,
    data: new Uint8ClampedArray(source.data),
    hasAlpha: source.hasAlpha,
  }
}

export function clampRect(rect: Rect, width: number, height: number): Rect {
  const x = Math.max(0, Math.min(width, Math.round(rect.x)))
  const y = Math.max(0, Math.min(height, Math.round(rect.y)))
  const w = Math.max(0, Math.min(width - x, Math.round(rect.w)))
  const h = Math.max(0, Math.min(height - y, Math.round(rect.h)))
  return { x, y, w, h }
}

export function cropRaster(source: Raster, rect: Rect): Raster {
  const box = clampRect(rect, source.width, source.height)
  if (!box.w || !box.h) return createRaster(0, 0)
  const data = new Uint8ClampedArray(box.w * box.h * 4)
  let hasAlpha = false
  for (let row = 0; row < box.h; row += 1) {
    const from = ((box.y + row) * source.width + box.x) * 4
    const to = row * box.w * 4
    data.set(source.data.subarray(from, from + box.w * 4), to)
  }
  if (source.hasAlpha) {
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) {
        hasAlpha = true
        break
      }
    }
  }
  return { width: box.w, height: box.h, data, hasAlpha }
}

/** 面积平均重采样（预乘 alpha），缩放都走这一条路，避免边缘发黑 */
export function resizeRaster(source: Raster, width: number, height: number): Raster {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  if (w === source.width && h === source.height) return cloneRaster(source)

  const data = new Uint8ClampedArray(w * h * 4)
  const xRatio = source.width / w
  const yRatio = source.height / h

  for (let dy = 0; dy < h; dy += 1) {
    const y0 = Math.floor(dy * yRatio)
    const y1 = Math.min(source.height, Math.max(y0 + 1, Math.ceil((dy + 1) * yRatio)))
    for (let dx = 0; dx < w; dx += 1) {
      const x0 = Math.floor(dx * xRatio)
      const x1 = Math.min(source.width, Math.max(x0 + 1, Math.ceil((dx + 1) * xRatio)))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let count = 0
      for (let sy = y0; sy < y1; sy += 1) {
        let index = (sy * source.width + x0) * 4
        for (let sx = x0; sx < x1; sx += 1) {
          const alpha = source.data[index + 3] / 255
          r += source.data[index] * alpha
          g += source.data[index + 1] * alpha
          b += source.data[index + 2] * alpha
          a += alpha
          count += 1
          index += 4
        }
      }
      const outIndex = (dy * w + dx) * 4
      if (a > 0) {
        data[outIndex] = r / a
        data[outIndex + 1] = g / a
        data[outIndex + 2] = b / a
      }
      data[outIndex + 3] = count ? (a / count) * 255 : 0
    }
  }
  return { width: w, height: h, data, hasAlpha: source.hasAlpha }
}

/** 只保留指定区域，并用页面截图补足透明像素（还原"用户实际看到的样子"） */
export function compositeOver(top: Raster, bottom: Raster | null): Raster {
  if (!top.hasAlpha || !bottom) return top
  const out = new Uint8ClampedArray(top.data)
  const width = Math.min(top.width, bottom.width)
  const height = Math.min(top.height, bottom.height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * top.width + x) * 4
      const back = (y * bottom.width + x) * 4
      const alpha = top.data[index + 3] / 255
      if (alpha >= 1) continue
      out[index] = top.data[index] * alpha + bottom.data[back] * (1 - alpha)
      out[index + 1] = top.data[index + 1] * alpha + bottom.data[back + 1] * (1 - alpha)
      out[index + 2] = top.data[index + 2] * alpha + bottom.data[back + 2] * (1 - alpha)
      out[index + 3] = 255
    }
  }
  return { width: top.width, height: top.height, data: out, hasAlpha: false }
}

export function averageColor(raster: Raster, rect?: Rect): { hex: string; uniform: boolean } {
  const box = rect ? clampRect(rect, raster.width, raster.height) : { x: 0, y: 0, w: raster.width, h: raster.height }
  if (!box.w || !box.h) return { hex: '#000000', uniform: true }
  let r = 0
  let g = 0
  let b = 0
  let sum = 0
  let sumSq = 0
  let count = 0
  for (let y = box.y; y < box.y + box.h; y += 1) {
    for (let x = box.x; x < box.x + box.w; x += 1) {
      const index = (y * raster.width + x) * 4
      r += raster.data[index]
      g += raster.data[index + 1]
      b += raster.data[index + 2]
      const value = luma(raster.data[index], raster.data[index + 1], raster.data[index + 2])
      sum += value
      sumSq += value * value
      count += 1
    }
  }
  const mean = sum / count
  const variance = Math.max(0, sumSq / count - mean * mean)
  return {
    hex: rgbToHex(r / count, g / count, b / count),
    uniform: Math.sqrt(variance) < 2.5,
  }
}

/** 每像素 Lab，供区域级像素比对（只在小区域上调用） */
export function labField(raster: Raster): Float32Array {
  const field = new Float32Array(raster.width * raster.height * 3)
  for (let i = 0, p = 0; i < raster.data.length; i += 4, p += 3) {
    const [L, a, b] = rgbToLab(raster.data[i], raster.data[i + 1], raster.data[i + 2])
    field[p] = L
    field[p + 1] = a
    field[p + 2] = b
  }
  return field
}

export function lumaField(raster: Raster): Float32Array {
  const field = new Float32Array(raster.width * raster.height)
  for (let i = 0, p = 0; i < raster.data.length; i += 4, p += 1) {
    field[p] = luma(raster.data[i], raster.data[i + 1], raster.data[i + 2])
  }
  return field
}

export function labAt(field: Float32Array, index: number): Lab {
  const p = index * 3
  return [field[p], field[p + 1], field[p + 2]]
}
