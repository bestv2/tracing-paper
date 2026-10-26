import fs from 'node:fs'
import { decodePng, encodePng } from '../src/shared/diff/node/png'
import { estimatePlacement, matchScore, type PlacementRect } from '../src/shared/diff/placement'
import { resizeRaster } from '../src/shared/diff/raster'
import type { Raster } from '../src/shared/diff/types'

export interface RunOptions {
  design: string
  page: string
  hint?: PlacementRect | null
  minScore?: number
}

const cache = new Map<string, Raster>()

function load(file: string): Raster {
  const hit = cache.get(file)
  if (hit) return hit
  const raster = decodePng(new Uint8Array(fs.readFileSync(file)))
  cache.set(file, raster)
  return raster
}

export function run(options: RunOptions) {
  const design = load(options.design)
  const page = load(options.page)
  const started = performance.now()
  const placement = estimatePlacement(design, page, {
    hint: options.hint ?? null,
    ...(options.minScore === undefined ? {} : { minScore: options.minScore }),
  })
  return {
    design: [design.width, design.height],
    page: [page.width, page.height],
    ms: Math.round(performance.now() - started),
    placement,
  }
}

export function scoreAt(options: {
  design: string
  page: string
  rect: PlacementRect
  scale: number
}): number {
  return matchScore(load(options.design), load(options.page), options.rect, options.scale)
}

/** 行/列亮度均值，用来单独看垂直、水平方向的位移真值 */
export function profiles(options: { design: string; page: string }) {
  const design = load(options.design)
  const page = load(options.page)
  const luma = (raster: Raster) => {
    const out = new Float32Array(raster.width * raster.height)
    for (let i = 0, p = 0; i < raster.data.length; i += 4, p += 1) {
      out[p] = 0.2126 * raster.data[i] + 0.7152 * raster.data[i + 1] + 0.0722 * raster.data[i + 2]
    }
    return out
  }
  const rows = (raster: Raster) => {
    const field = luma(raster)
    const out = new Float32Array(raster.height)
    for (let y = 0; y < raster.height; y += 1) {
      let sum = 0
      for (let x = 0; x < raster.width; x += 1) sum += field[y * raster.width + x]
      out[y] = sum / raster.width
    }
    return out
  }
  const cols = (raster: Raster) => {
    const field = luma(raster)
    const out = new Float32Array(raster.width)
    for (let x = 0; x < raster.width; x += 1) {
      let sum = 0
      for (let y = 0; y < raster.height; y += 1) sum += field[y * raster.width + x]
      out[x] = sum / raster.height
    }
    return out
  }
  return {
    design: rows(design),
    page: rows(page),
    designCols: cols(design),
    pageCols: cols(page),
  }
}

export function overlay(options: {
  design: string
  page: string
  rect: PlacementRect
  scale: number
  out: string
}): string {
  const page = load(options.page)
  const design = resizeRaster(load(options.design), options.rect.width, options.rect.height)
  const data = new Uint8ClampedArray(page.data)
  for (let y = 0; y < design.height; y += 1) {
    const py = options.rect.y + y
    if (py < 0 || py >= page.height) continue
    for (let x = 0; x < design.width; x += 1) {
      const px = options.rect.x + x
      if (px < 0 || px >= page.width) continue
      const from = (y * design.width + x) * 4
      const to = (py * page.width + px) * 4
      for (let c = 0; c < 3; c += 1) {
        data[to + c] = (data[to + c] + design.data[from + c]) / 2
      }
    }
  }
  fs.writeFileSync(options.out, encodePng({ ...page, data }))
  return options.out
}
