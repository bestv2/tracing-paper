import type {
  Alignment,
  DiffPolicy,
  DiffResult,
  Finding,
  FindingKind,
  MaskRect,
  Raster,
  Rect,
  Severity,
} from './types'
import { DEFAULT_POLICY } from './types'
import {
  analyzeTiles,
  buildDiffField,
  changedBounds,
  measureRegion,
  type DiffField,
  type RegionStat,
} from './metrics'
import { compositeOver, cropRaster, resizeRaster } from './raster'
import { deltaEHex } from './color'
import { alignmentMasks, commonArea, estimateShift, shiftRaster } from './align'

export interface CompareInput {
  expected: Raster
  actual: Raster
  policy?: Partial<DiffPolicy>
  masks?: MaskRect[]
  /** 设计稿的渲染缩放，≠1 时结论只作参考 */
  scale?: number
  /**
   * 全局对齐。默认 auto：位移能显著压低残差才采用；
   * 传 { dx, dy } 表示用外部已量出的位移（expected[x,y] ↔ actual[x+dx,y+dy]）。
   */
  align?: 'auto' | 'off' | { dx: number; dy: number }
}

const SEVERITY_RANK: Record<Severity, number> = { info: 0, minor: 1, major: 2, blocker: 3 }

function resolvePolicy(input: CompareInput): DiffPolicy {
  return { ...DEFAULT_POLICY, ...input.policy }
}

function inMask(mask: MaskRect, x: number, y: number): boolean {
  return x >= mask.x && x < mask.x + mask.w && y >= mask.y && y < mask.y + mask.h
}

/** 把忽略区域变成逐像素位图：掩膜只跳格子太粗，像素级才能真正忽略动效/时钟这类区域 */
function maskMap(masks: MaskRect[], width: number, height: number): Uint8Array {
  const map = new Uint8Array(width * height)
  masks.forEach((mask) => {
    const x0 = Math.max(0, Math.floor(mask.x))
    const x1 = Math.min(width, Math.ceil(mask.x + mask.w))
    const y0 = Math.max(0, Math.floor(mask.y))
    const y1 = Math.min(height, Math.ceil(mask.y + mask.h))
    for (let y = y0; y < y1; y += 1) map.fill(1, y * width + x0, y * width + x1)
  })
  return map
}

/** 网格聚类：8 连通区域合并，返回像素坐标外接框 */
function clusterTiles(changed: boolean[], cols: number, rows: number, tile: number): Rect[] {
  const visited = new Uint8Array(changed.length)
  const regions: Rect[] = []
  const stack: number[] = []

  for (let start = 0; start < changed.length; start += 1) {
    if (!changed[start] || visited[start]) continue
    visited[start] = 1
    stack.length = 0
    stack.push(start)
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = -1
    let maxY = -1

    while (stack.length) {
      const cell = stack.pop() as number
      const col = cell % cols
      const row = Math.floor(cell / cols)
      if (col < minX) minX = col
      if (row < minY) minY = row
      if (col > maxX) maxX = col
      if (row > maxY) maxY = row
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue
          const nc = col + dx
          const nr = row + dy
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue
          const next = nr * cols + nc
          if (changed[next] && !visited[next]) {
            visited[next] = 1
            stack.push(next)
          }
        }
      }
    }

    regions.push({
      x: minX * tile,
      y: minY * tile,
      w: (maxX - minX + 1) * tile,
      h: (maxY - minY + 1) * tile,
    })
  }
  return regions
}

function overlapRatio(a: Rect, b: Rect): number {
  const x0 = Math.max(a.x, b.x)
  const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w)
  const y1 = Math.min(a.y + a.h, b.y + b.h)
  if (x1 <= x0 || y1 <= y0) return 0
  const inter = (x1 - x0) * (y1 - y0)
  return inter / Math.max(1, Math.min(a.w * a.h, b.w * b.h))
}

function classify(stat: RegionStat, box: Rect, policy: DiffPolicy, field: DiffField): FindingKind {
  if (stat.expectedEmpty !== stat.actualEmpty) return stat.actualEmpty ? 'missing' : 'extra'
  if (stat.shift) return 'shift'

  const roomy = box.w >= policy.tile * 2 && box.h >= policy.tile * 2
  const huge = box.w * box.h > field.width * field.height * 0.2
  if (roomy && !huge && stat.edgeDelta < 0.32 && stat.deltaE >= policy.deltaE) return 'color'
  // 细长条且结构接近：行高、边框、内边距类的差异
  if (roomy && !huge && stat.edgeDelta < 0.6) {
    const aspect = Math.max(box.w / Math.max(1, box.h), box.h / Math.max(1, box.w))
    if (aspect >= 4) return 'size'
  }
  return 'content'
}

function severityOf(stat: RegionStat): Severity {
  if (stat.deltaE > 12 && stat.pixelRatio > 0.5) return 'blocker'
  if (stat.deltaE > 8 || stat.pixelRatio > 0.35) return 'major'
  if (stat.deltaE > 4 || stat.pixelRatio > 0.15) return 'minor'
  return 'info'
}

function buildFinding(index: number, kind: FindingKind, stat: RegionStat): Finding {
  const severity = severityOf(stat)
  const finding: Finding = {
    id: `f-${String(index + 1).padStart(4, '0')}`,
    kind,
    severity,
    box: { x: stat.box.x, y: stat.box.y, w: stat.box.w, h: stat.box.h },
    metrics: {
      deltaE: Number(stat.deltaE.toFixed(2)),
      ssim: Number(stat.ssim.toFixed(4)),
      pixelRatio: Number(stat.pixelRatio.toFixed(4)),
      edgeDelta: Number(stat.edgeDelta.toFixed(3)),
      ...(stat.shift ? { shift: { ...stat.shift } } : {}),
    },
    expected: { hex: stat.expectedHex, uniform: stat.expectedEmpty },
    actual: {
      hex: stat.actualHex,
      uniform: stat.actualEmpty,
      deltaE: Number(deltaEHex(stat.expectedHex, stat.actualHex).toFixed(2)),
    },
  }

  if (kind === 'shift' && stat.shift) {
    const { dx, dy } = stat.shift
    finding.note = `页面内容相对设计稿偏移 dx=${dx}, dy=${dy}（px）`
    finding.suggestion = {
      property: 'transform',
      from: 'none',
      to: `translate(${-dx}px, ${-dy}px)`,
      confidence: 'high',
    }
  } else if (kind === 'color') {
    finding.note = `结构与设计稿一致，颜色差 ΔE ${stat.deltaE.toFixed(1)}`
    finding.suggestion = {
      property: 'color',
      from: stat.actualHex,
      to: stat.expectedHex,
      confidence: 'low',
    }
  } else if (kind === 'missing') {
    finding.note = '设计稿该区域有内容，页面上是空白'
  } else if (kind === 'extra') {
    finding.note = '设计稿该区域是空白，页面上多出内容'
  }

  return finding
}

/** 一条候选切口：空白带优先，没有空白带就取最稀疏处 */
interface Cut {
  index: number
  empty: boolean
  run: number
  density: number
}

function bestCut(density: number[], minSide: number): Cut | null {
  const n = density.length
  const last = n - minSide
  if (last < minSide) return null

  let empty: Cut | null = null
  let start = -1
  for (let i = 0; i <= n; i += 1) {
    const gap = i < n && density[i] <= 0.08
    if (gap) {
      if (start < 0) start = i
      continue
    }
    if (start >= 0) {
      const run = i - start
      const end = Math.min(last, i - 1)
      const begin = Math.max(minSide, start)
      if (begin <= end && (!empty || run > empty.run)) {
        empty = { index: Math.floor((begin + end) / 2), empty: true, run, density: 0 }
      }
      start = -1
    }
  }
  if (empty) return empty

  let best: Cut | null = null
  for (let i = minSide; i <= last; i += 1) {
    if (!best || density[i] < best.density) best = { index: i, empty: false, run: 0, density: density[i] }
  }
  return best
}

/**
 * 大块区域二分，避免整页被并成一条结论：
 * 优先在"空白带"中间切开（切口落在留白里，框更干净），
 * 找不到空白带就切在最稀疏的行/列上，直到面积小于 maxArea。
 * 每侧至少保留 2 格，保证切分一定收敛。
 */
function splitRegion(
  region: Rect,
  changed: boolean[],
  cols: number,
  rows: number,
  tile: number,
  maxArea: number,
  depth = 0,
): Rect[] {
  if (depth >= 6 || region.w * region.h <= maxArea) return [region]
  const c0 = Math.max(0, Math.floor(region.x / tile))
  const r0 = Math.max(0, Math.floor(region.y / tile))
  const c1 = Math.min(cols, Math.ceil((region.x + region.w) / tile))
  const r1 = Math.min(rows, Math.ceil((region.y + region.h) / tile))
  const minSpan = 2

  const rowDensity: number[] = []
  for (let row = r0; row < r1; row += 1) {
    let hit = 0
    for (let col = c0; col < c1; col += 1) if (changed[row * cols + col]) hit += 1
    rowDensity.push(hit / Math.max(1, c1 - c0))
  }
  const colDensity: number[] = []
  for (let col = c0; col < c1; col += 1) {
    let hit = 0
    for (let row = r0; row < r1; row += 1) if (changed[row * cols + col]) hit += 1
    colDensity.push(hit / Math.max(1, r1 - r0))
  }

  const rowCut = bestCut(rowDensity, 2)
  const colCut = bestCut(colDensity, 2)

  // 切口必须把变化格大致分开，否则会把稠密块一条条剥成碎片
  const balanced = (axis: 'row' | 'col', index: number) => {
    let before = 0
    let after = 0
    for (let row = 0; row < rowDensity.length; row += 1) {
      for (let col = 0; col < colDensity.length; col += 1) {
        if (!changed[(r0 + row) * cols + c0 + col]) continue
        const near = axis === 'row' ? row : col
        if (near < index) before += 1
        else after += 1
      }
    }
    const total = before + after
    return total === 0 || Math.min(before, after) / total >= 0.2
  }

  // 优先顺序：空白带更长的一侧 → 另一侧 → 稠密区域沿长边切断
  const longAxis: 'row' | 'col' = region.h >= region.w ? 'row' : 'col'
  const order: ('row' | 'col')[] = []
  if (rowCut && colCut) {
    let first: 'row' | 'col'
    if (rowCut.empty !== colCut.empty) first = rowCut.empty ? 'row' : 'col'
    else if (rowCut.empty) first = rowCut.run >= colCut.run ? 'row' : 'col'
    else first = longAxis
    order.push(first, first === 'row' ? 'col' : 'row')
  } else if (rowCut) {
    order.push('row')
  } else if (colCut) {
    order.push('col')
  }

  let cutAxis = order.find((axis) => balanced(axis, (axis === 'row' ? rowCut : colCut)!.index))
  let index = cutAxis ? (cutAxis === 'row' ? rowCut : colCut)!.index : 0

  // 空白带靠边、两侧不可分时，改切在变化格的中位数处，保证大块一定能被切开
  if (!cutAxis) {
    const axis = longAxis
    const span = axis === 'row' ? rowDensity.length : colDensity.length
    if (span < minSpan * 2) return [region]
    const positions: number[] = []
    for (let row = 0; row < rowDensity.length; row += 1) {
      for (let col = 0; col < colDensity.length; col += 1) {
        if (!changed[(r0 + row) * cols + c0 + col]) continue
        positions.push(axis === 'row' ? row : col)
      }
    }
    if (!positions.length) return [region]
    positions.sort((left, right) => left - right)
    cutAxis = axis
    index = Math.min(span - minSpan, Math.max(minSpan, positions[Math.floor(positions.length / 2)]))
  }

  if (cutAxis === 'row') {
    const y = (r0 + index) * tile
    const top = { x: region.x, y: region.y, w: region.w, h: y - region.y }
    const bottom = { x: region.x, y, w: region.w, h: region.y + region.h - y }
    return [
      ...splitRegion(top, changed, cols, rows, tile, maxArea, depth + 1),
      ...splitRegion(bottom, changed, cols, rows, tile, maxArea, depth + 1),
    ]
  }
  const x = (c0 + index) * tile
  const left = { x: region.x, y: region.y, w: x - region.x, h: region.h }
  const right = { x, y: region.y, w: region.x + region.w - x, h: region.h }
  return [
    ...splitRegion(left, changed, cols, rows, tile, maxArea, depth + 1),
    ...splitRegion(right, changed, cols, rows, tile, maxArea, depth + 1),
  ]
}

/** 把网格框收紧到真正变化的像素（外圈留 4px 方便人看），框越小越好定位 */
function tightenRegion(field: DiffField, box: Rect, threshold: number, ignored?: Uint8Array): Rect {
  const bounds = changedBounds(field, box, threshold, ignored)
  if (!bounds) return box
  const pad = 4
  const x = Math.max(0, bounds.x - pad)
  const y = Math.max(0, bounds.y - pad)
  const right = Math.min(field.width, bounds.x + bounds.w + pad)
  const bottom = Math.min(field.height, bounds.y + bounds.h + pad)
  return { x, y, w: Math.max(1, right - x), h: Math.max(1, bottom - y) }
}

/** 差异可视化：设计稿压暗作底，超阈值像素涂红，区域框与掩膜叠加 */
export function renderDiffImage(
  expected: Raster,
  field: DiffField,
  findings: Finding[],
  masks: MaskRect[],
  pixelThreshold: number,
): Raster {
  const width = expected.width
  const height = expected.height
  const data = new Uint8ClampedArray(width * height * 4)

  for (let i = 0, p = 0; p < width * height; p += 1, i += 4) {
    const r = expected.data[i]
    const g = expected.data[i + 1]
    const b = expected.data[i + 2]
    const dE = field.deltaE[p]
    const base = 0.45
    if (dE > pixelThreshold * 2) {
      data[i] = 255
      data[i + 1] = 74
      data[i + 2] = 58
      data[i + 3] = 255
    } else if (dE > pixelThreshold) {
      data[i] = Math.min(255, r * 0.5 + 160)
      data[i + 1] = Math.min(255, g * 0.5 + 90)
      data[i + 2] = Math.min(255, b * 0.5 + 60)
      data[i + 3] = 255
    } else {
      data[i] = r * base
      data[i + 1] = g * base
      data[i + 2] = b * base
      data[i + 3] = 255
    }
  }

  const raster: Raster = { width, height, data, hasAlpha: false }
  const stroke = (rect: Rect, color: [number, number, number], thickness = 2) => {
    for (let t = 0; t < thickness; t += 1) {
      const top = rect.y + t
      const bottom = rect.y + rect.h - 1 - t
      const left = rect.x + t
      const right = rect.x + rect.w - 1 - t
      for (let x = Math.max(0, left); x < Math.min(width, right + 1); x += 1) {
        if (top >= 0 && top < height) setPixel(raster, x, top, color)
        if (bottom >= 0 && bottom < height) setPixel(raster, x, bottom, color)
      }
      for (let y = Math.max(0, top); y < Math.min(height, bottom + 1); y += 1) {
        if (left >= 0 && left < width) setPixel(raster, left, y, color)
        if (right >= 0 && right < width) setPixel(raster, right, y, color)
      }
    }
  }

  masks.forEach((mask) => stroke(mask, [74, 144, 217], 1))
  findings.forEach((finding) => stroke(finding.box, [255, 181, 112], 2))
  return raster
}

function setPixel(raster: Raster, x: number, y: number, color: [number, number, number]): void {
  const index = (y * raster.width + x) * 4
  raster.data[index] = color[0]
  raster.data[index + 1] = color[1]
  raster.data[index + 2] = color[2]
  raster.data[index + 3] = 255
}

export function compareRasters(input: CompareInput): DiffResult {
  const policy = resolvePolicy(input)
  const masks: MaskRect[] = [...(input.masks ?? [])]
  const notes: string[] = []
  const scale = input.scale ?? 1
  let alignment: Alignment = { scale, dx: 0, dy: 0, method: 'given' }

  let expected = input.expected
  let actual = input.actual

  if (expected.width !== actual.width || expected.height !== actual.height) {
    notes.push(
      `两侧尺寸不同（设计稿 ${expected.width}×${expected.height}，页面 ${actual.width}×${actual.height}），已把页面缩放到设计稿尺寸再比对`,
    )
    actual = resizeRaster(actual, expected.width, expected.height)
  }
  if (expected.hasAlpha) {
    notes.push('设计稿含透明区域，已按页面截图合成后再比对')
    expected = compositeOver(expected, actual)
  }
  if (input.scale !== undefined && Math.abs(input.scale - 1) > 0.01) {
    notes.push(`设计稿以 ${(input.scale * 100).toFixed(0)}% 缩放比对，像素级结论仅供参考`)
  }

  // 全局对齐：整页错位会让差异从"几块"变成"一片"，必须先拉正
  const alignMode = input.align ?? 'auto'
  if (alignMode !== 'off') {
    const given = typeof alignMode === 'object' ? alignMode : null
    const estimate = given ? null : estimateShift(expected, actual)
    const dx = given ? given.dx : (estimate?.dx ?? 0)
    const dy = given ? given.dy : (estimate?.dy ?? 0)
    const gain = given ? 1 : (estimate?.gain ?? 0)
    const accepted = given ? Boolean(dx || dy) : gain >= 0.15 && Boolean(dx || dy)
    if (accepted) {
      actual = shiftRaster(actual, dx, dy)
      masks.push(...alignmentMasks(dx, dy, actual.width, actual.height))
      alignment = {
        scale,
        dx,
        dy,
        method: given ? 'given' : 'auto',
        cropped: commonArea(actual.width, actual.height, dx, dy),
      }
      const band = `位移后 ${Math.abs(dx)}×${Math.abs(dy)}px 边缘无真实像素，已排除`
      notes.push(
        given
          ? `按给定位移对齐：页面相对设计稿偏移 dx=${dx}, dy=${dy}（${band}）`
          : `已自动对齐：页面相对设计稿偏移 dx=${dx}, dy=${dy}，残差下降 ${(gain * 100).toFixed(0)}%（${band}）`,
      )
    } else if (dx || dy) {
      notes.push(`检测到位移 dx=${dx}, dy=${dy}，但残差仅下降 ${(gain * 100).toFixed(0)}%，未采用`)
    }
  }

  const field = buildDiffField(expected, actual)
  const tiles = analyzeTiles(field, policy.tile)
  const ignored = maskMap(masks, expected.width, expected.height)

  const cols = tiles.cols
  const rows = tiles.rows
  const cells = cols * rows
  const changed: boolean[] = new Array(cells).fill(false)
  const changedTiles: Rect[] = []
  let changedCount = 0
  let masked = 0
  let maxDeltaE = 0

  for (let cell = 0; cell < cells; cell += 1) {
    const col = cell % cols
    const row = Math.floor(cell / cols)
    const cx = col * policy.tile + policy.tile / 2
    const cy = row * policy.tile + policy.tile / 2
    if (masks.some((mask) => inMask(mask, cx, cy))) {
      masked += 1
      continue
    }
    const dE = tiles.meanDeltaE[cell]
    const ssim = tiles.ssim[cell]
    if (dE > maxDeltaE) maxDeltaE = dE
    if (dE > policy.deltaE || ssim < policy.ssim) {
      changed[cell] = true
      changedCount += 1
      if (changedTiles.length < 4000) {
        changedTiles.push({ x: col * policy.tile, y: row * policy.tile, w: policy.tile, h: policy.tile })
      }
    }
  }

  // 单条结论最多覆盖约 4% 画面，超过就继续切，保证输出粒度对人对智能体都可用
  const maxRegionArea = Math.max(expected.width * expected.height * 0.04, policy.minArea * 4)
  // 超阀像素占比至少 2%（且不少于 96 像素），避免单字反锯齿被当成结论
  const minPixelRatio = Math.max(0.02, 96 / (expected.width * expected.height))
  const items: { stat: RegionStat; kind: FindingKind }[] = []

  clusterTiles(changed, cols, rows, policy.tile)
    .flatMap((region) => splitRegion(region, changed, cols, rows, policy.tile, maxRegionArea))
    .filter((region) => region.w * region.h >= policy.minArea)
    .forEach((region) => {
      const clipped = {
        x: Math.max(0, Math.min(expected.width - 1, region.x)),
        y: Math.max(0, Math.min(expected.height - 1, region.y)),
        w: Math.min(region.w, expected.width - region.x),
        h: Math.min(region.h, expected.height - region.y),
      }
      const loose = measureRegion(field, expected, actual, clipped, policy.pixel, policy.shiftSearch, ignored)
      // 切分出来的空白边、纯噪声不算结论：均色差或超阀像素数得有一个达标
      if (loose.deltaE <= policy.deltaE && loose.pixelRatio < minPixelRatio) return
      const tight = tightenRegion(field, clipped, Math.max(policy.deltaE, 3), ignored)
      const stat =
        tight.x === clipped.x && tight.y === clipped.y && tight.w === clipped.w && tight.h === clipped.h
          ? loose
          : measureRegion(field, expected, actual, tight, policy.pixel, policy.shiftSearch, ignored)
      items.push({ stat, kind: classify(stat, tight, policy, field) })
    })

  const findings = items
    .sort((left, right) => {
      const bySeverity = SEVERITY_RANK[severityOf(right.stat)] - SEVERITY_RANK[severityOf(left.stat)]
      if (bySeverity) return bySeverity
      return right.stat.deltaE - left.stat.deltaE
    })
    .reduce<typeof items>((kept, item) => {
      if (kept.length >= policy.maxFindings) return kept
      // 连通块的外接框可能互相嵌套，重叠超过 60% 的只留最严重的那条
      if (kept.some((other) => overlapRatio(other.stat.box, item.stat.box) > 0.6)) return kept
      kept.push(item)
      return kept
    }, [])
    .map((item, index) => buildFinding(index, item.kind, item.stat))

  findings.sort((left, right) => left.box.y - right.box.y || left.box.x - right.box.x)
  findings.forEach((finding, index) => {
    finding.id = `f-${String(index + 1).padStart(4, '0')}`
  })

  const diffImage = renderDiffImage(expected, field, findings, masks, policy.pixel)

  const crops = findings.map((finding) => {
    // 差异常常只是一条十几像素高的细线，四周多带一点上下文才看得出是哪个区块
    const MIN_CROP_W = 160
    const MIN_CROP_H = 64
    const PAD = 8
    const growX = Math.max(0, MIN_CROP_W - finding.box.w) / 2
    const growY = Math.max(0, MIN_CROP_H - finding.box.h) / 2
    const left = Math.max(0, Math.round(finding.box.x - growX - PAD))
    const top = Math.max(0, Math.round(finding.box.y - growY - PAD))
    const right = Math.min(expected.width, Math.round(finding.box.x + finding.box.w + growX + PAD))
    const bottom = Math.min(expected.height, Math.round(finding.box.y + finding.box.h + growY + PAD))
    const box = { x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) }
    return {
      id: finding.id,
      box,
      expected: cropRaster(expected, box),
      actual: cropRaster(actual, box),
      diff: cropRaster(diffImage, box),
    }
  })

  const total = Math.max(1, cells - masked)
  const byKind: Partial<Record<FindingKind, number>> = {}
  const bySeverity: Partial<Record<Severity, number>> = {}
  findings.forEach((finding) => {
    byKind[finding.kind] = (byKind[finding.kind] ?? 0) + 1
    bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1
  })

  const summary = {
    verdict: (findings.length ? 'changed' : 'clean') as 'clean' | 'changed',
    findings: findings.length,
    changedRatio: Number((changedCount / total).toFixed(4)),
    maxDeltaE: Number(maxDeltaE.toFixed(2)),
    tiles: total,
    changedTiles: changedCount,
    byKind,
    bySeverity,
  }

  const report: DiffResult['report'] = {
    schemaVersion: 'tracing.diff/2',
    generatedAt: new Date().toISOString(),
    tool: { name: 'tracing-paper', version: '1.0.0', mode: 'cli' },
    inputs: {
      expected: { width: expected.width, height: expected.height },
      actual: { width: actual.width, height: actual.height },
      alignment,
    },
    policy: { ...policy, masks },
    summary,
    findings,
    artifacts: {},
    notes,
  }

  return { report, diffImage, crops, changedTiles }
}
