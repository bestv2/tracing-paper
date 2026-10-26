/**
 * 设计稿自动定位：在页面截图里找出设计稿最可能出现的位置与缩放。
 *
 * 纯函数，不碰 DOM，浏览器与 Node 共用（CLI / 回归脚本都能直接跑）。
 *
 * 做法：
 * 1) 两边都转成「模糊亮度场」——模糊掉抗锯齿和 1~2px 的渲染抖动；
 * 2) 设计稿上按网格取样（跳过透明像素），并按原图梯度给样点加权：
 *    文字、块边界这类结构点权重大，纯色背景几乎不占分（就是人工对齐时先盯的锚点）；
 * 3) 缩放按几何步长扫一遍，位移分三级：整页粗搜 → 局部中搜 → 像素级；
 * 4) 打分统一用零均值归一化相关（ZNCC），对整体色偏与亮度差免疫。
 */

import { estimateShift } from './align'
import { cropRaster, lumaField, resizeRaster } from './raster'
import type { Raster } from './types'

export interface PlacementRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PlacementOptions {
  /** 相关度低于这个值就认为没找到可信位置 */
  minScore?: number
  /** 渲染宽度相对视口的搜索区间 */
  minRenderRatio?: number
  maxRenderRatio?: number
  /** 当前图层落点，用于打分先验（越近越优先） */
  hint?: PlacementRect | null
}

export interface Placement {
  rect: PlacementRect
  /** 设计稿 1px 对应多少页面 px */
  scale: number
  /** 匹配相关度，1 表示完全一致 */
  score: number
  /**
   * 峰值裕度：跟「另一个位置的最高分」差多少。
   * 真实匹配是尖峰；页面上到处都差不多的平滑块面，裕度接近 0。
   * 分数高但裕度小意味着「随意找个位置也能拿高分」，结论不能当真。
   */
  margin: number
}

const MIN_SCORE = 0.3
const MIN_RENDER_RATIO = 0.18
const MAX_RENDER_RATIO = 2.4
/** 缩放搜索的倍率步长：粗扫用几何步长，精确倍率交给后面的局部细化 */
const SCALE_STEP = 1.06
/** 取样网格：全量 / 粗搜（按 stride 稀疏） */
const COLS = 64
const ROWS = 40
const SPARSE = 3
/** 亮度场模糊半径，抵消亚像素抖动 */
const BLUR = 6
/** 落在画面内的样点比例低于它，这组参数直接判负 */
const MIN_COVERAGE = 0.45
/**
 * 覆盖度不足的扣分：倍率拉得太大时，只有左上角一半样点进了画面，
 * 局部对得很准也能拿高分。用同一套样点比，不扣分就会被“大倍率局部命中”骗过去。
 */
const COVERAGE_PENALTY = 0.3
/** 像素级收尾最多搬多远，防止误判把图层甩飞 */
const MAX_SNAP = 40
/** 位置先验的权重：离图层越远，分数略微打折 */
const HINT_WEIGHT = 0.08

/** 样点权重的下限：纯色区域仍然参与相关，只是说话分量轻 */
const EDGE_FLOOR = 1
/** 结构密集区（文字、图标）最多能拿到多少权重 */
const EDGE_GAIN = 0.6
/** 局部结构密度到这个值就算“满满都是字/线” */
const EDGE_REF = 30
/** 算结构密度时的梯度范围与统计窗口 */
const EDGE_RADIUS = 1
const EDGE_WINDOW = 9
/** 粗扫后重新用稠密样点复核的倍率数 */
const SHORTLIST = 4

interface Grid {
  px: Float32Array
  py: Float32Array
  value: Float32Array
  /** 每个样点的分量：结构点 > 纯色点 */
  weight: Float32Array
  /** 权重总和，用于判定覆盖度 */
  totalWeight: number
  count: number
}

interface Candidate {
  scale: number
  left: number
  top: number
  score: number
}

function clampIndex(value: number, max: number): number {
  return value < 0 ? 0 : value > max ? max : value
}

/** 可分离盒式模糊，边缘按夹取处理，够平滑又比高斯便宜 */
function boxBlur(field: Float32Array, width: number, height: number, radius: number): Float32Array {
  const size = Math.round(radius)
  if (size < 1) return field
  const span = size * 2 + 1
  const temp = new Float32Array(field.length)
  const out = new Float32Array(field.length)

  for (let y = 0; y < height; y += 1) {
    const row = y * width
    let sum = 0
    for (let x = -size; x <= size; x += 1) sum += field[row + clampIndex(x, width - 1)]
    for (let x = 0; x < width; x += 1) {
      temp[row + x] = sum / span
      sum -= field[row + clampIndex(x - size, width - 1)]
      sum += field[row + clampIndex(x + size + 1, width - 1)]
    }
  }

  for (let x = 0; x < width; x += 1) {
    let sum = 0
    for (let y = -size; y <= size; y += 1) sum += temp[clampIndex(y, height - 1) * width + x]
    for (let y = 0; y < height; y += 1) {
      out[y * width + x] = sum / span
      sum -= temp[clampIndex(y - size, height - 1) * width + x]
      sum += temp[clampIndex(y + size + 1, height - 1) * width + x]
    }
  }

  return out
}

function sampleField(
  field: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const cx = x < 0 ? 0 : x > width - 1 ? width - 1 : x
  const cy = y < 0 ? 0 : y > height - 1 ? height - 1 : y
  const x0 = Math.floor(cx)
  const y0 = Math.floor(cy)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const fx = cx - x0
  const fy = cy - y0
  const top = field[y0 * width + x0] * (1 - fx) + field[y0 * width + x1] * fx
  const bottom = field[y1 * width + x0] * (1 - fx) + field[y1 * width + x1] * fx
  return top * (1 - fy) + bottom * fy
}

function alphaAt(raster: Raster, x: number, y: number): number {
  const px = clampIndex(Math.round(x), raster.width - 1)
  const py = clampIndex(Math.round(y), raster.height - 1)
  return raster.data[(py * raster.width + px) * 4 + 3] / 255
}

/**
 * 结构密度：先算每个像素的梯度幅值，再在小窗口里求和。
 * 文字、图标区域密度高，一根边框或大块渐变的密度很低——
 * 这样权重就会落到人眼先对位的那些细节上。
 */
function edgeDensity(raster: Raster, sharp: Float32Array): Float32Array {
  const { width, height } = raster
  const magnitude = new Float32Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const gx =
        sampleField(sharp, width, height, x + EDGE_RADIUS, y) -
        sampleField(sharp, width, height, x - EDGE_RADIUS, y)
      const gy =
        sampleField(sharp, width, height, x, y + EDGE_RADIUS) -
        sampleField(sharp, width, height, x, y - EDGE_RADIUS)
      magnitude[y * width + x] = Math.abs(gx) + Math.abs(gy)
    }
  }
  return boxBlur(magnitude, width, height, EDGE_WINDOW)
}

/**
 * 在设计稿坐标系里铺一层样点，stride 越大越稀疏。
 * value 取自模糊场（抵消抗锯齿），weight 取自结构密度（锁文字与图标）。
 */
function buildGrid(
  design: Raster,
  field: Float32Array,
  density: Float32Array,
  stride: number,
): Grid {
  const cols = Math.max(6, Math.round(COLS / stride))
  const rows = Math.max(4, Math.round(ROWS / stride))
  const px: number[] = []
  const py: number[] = []
  const value: number[] = []
  const weight: number[] = []

  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const x = ((i + 0.5) / cols) * design.width
      const y = ((j + 0.5) / rows) * design.height
      if (design.hasAlpha && alphaAt(design, x, y) < 0.35) continue
      const detail = sampleField(density, design.width, design.height, x, y)
      px.push(x)
      py.push(y)
      value.push(sampleField(field, design.width, design.height, x, y))
      weight.push(EDGE_FLOOR + EDGE_GAIN * Math.min(1, detail / EDGE_REF))
    }
  }

  let totalWeight = 0
  for (const item of weight) totalWeight += item

  return {
    px: Float32Array.from(px),
    py: Float32Array.from(py),
    value: Float32Array.from(value),
    weight: Float32Array.from(weight),
    totalWeight,
    count: px.length,
  }
}

/**
 * 加权零均值归一化相关；
 * 覆盖不足或一边接近纯色时返回 -1。
 */
function correlate(
  grid: Grid,
  field: Float32Array,
  width: number,
  height: number,
  left: number,
  top: number,
  scale: number,
): number {
  let n = 0
  let sw = 0
  let sa = 0
  let sb = 0
  let saa = 0
  let sbb = 0
  let sab = 0

  for (let i = 0; i < grid.count; i += 1) {
    const x = left + grid.px[i] * scale
    const y = top + grid.py[i] * scale
    if (x < 0 || y < 0 || x > width - 1 || y > height - 1) continue
    const w = grid.weight[i]
    const a = grid.value[i]
    const b = sampleField(field, width, height, x, y)
    n += 1
    sw += w
    sa += w * a
    sb += w * b
    saa += w * a * a
    sbb += w * b * b
    sab += w * a * b
  }

  if (n < 24 || sw < grid.totalWeight * MIN_COVERAGE || sw <= 0) return -1
  const cov = sab - (sa * sb) / sw
  const va = saa - (sa * sa) / sw
  const vb = sbb - (sb * sb) / sw
  if (va < 2 * sw || vb < 2 * sw) return -1
  const score = cov / Math.sqrt(va * vb)
  // 只看得到一角就给一角的分，避免大倍率靠局部重合偷分
  const coverage = sw / grid.totalWeight
  return score - COVERAGE_PENALTY * (1 - coverage)
}

function distancePenalty(
  candidate: Candidate,
  design: Raster,
  hint: PlacementRect | null,
  width: number,
  height: number,
) {
  if (!hint) return 0
  const cx = candidate.left + (design.width * candidate.scale) / 2
  const cy = candidate.top + (design.height * candidate.scale) / 2
  const hx = hint.x + hint.width / 2
  const hy = hint.y + hint.height / 2
  const dist = Math.hypot(cx - hx, cy - hy)
  return HINT_WEIGHT * Math.min(1, dist / Math.max(1, Math.hypot(width, height)))
}

interface Prepared {
  designField: Float32Array
  pageField: Float32Array
  fine: Grid
  sparse: Grid
}

function prepare(design: Raster, page: Raster): Prepared | null {
  if (design.width < 8 || design.height < 8 || page.width < 16 || page.height < 16) return null
  // 权重取自原图（未模糊）的结构密度：文字、图标这类稠密结构才配当锚点
  const sharp = lumaField(design)
  const density = edgeDensity(design, sharp)
  const designField = boxBlur(sharp, design.width, design.height, BLUR)
  const pageField = boxBlur(lumaField(page), page.width, page.height, BLUR)
  const fine = buildGrid(design, designField, density, 1)
  const sparse = buildGrid(design, designField, density, SPARSE)
  if (fine.count < 24 || sparse.count < 12) return null
  return { designField, pageField, fine, sparse }
}

/**
 * 单独评估一个落位的相关度，供回归脚本比对候选、也可以用来展示置信度。
 * rect 是设计稿在页面坐标系里的位置，scale 是设计稿 1px 对应的页面 px。
 */
export function matchScore(design: Raster, page: Raster, rect: PlacementRect, scale: number): number {
  const prepared = prepare(design, page)
  if (!prepared) return -1
  return correlate(prepared.fine, prepared.pageField, page.width, page.height, rect.x, rect.y, scale)
}

export function estimatePlacement(
  design: Raster,
  page: Raster,
  options: PlacementOptions = {},
): Placement | null {
  const prepared = prepare(design, page)
  if (!prepared) return null
  const { pageField, fine, sparse } = prepared
  const minScore = options.minScore ?? MIN_SCORE

  const hint = options.hint ?? null

  const minRender = Math.max(96, Math.min(page.width, page.height) * (options.minRenderRatio ?? MIN_RENDER_RATIO))
  const maxRender = Math.max(minRender * 1.2, page.width * (options.maxRenderRatio ?? MAX_RENDER_RATIO))
  const minScale = minRender / design.width
  const maxScale = maxRender / design.width
  const steps = Math.max(6, Math.ceil(Math.log(maxScale / minScale) / Math.log(SCALE_STEP)))

  const scoreOf = (grid: Grid, candidate: Candidate) =>
    correlate(grid, pageField, page.width, page.height, candidate.left, candidate.top, candidate.scale)

  const place = (scale: number, left: number, top: number): Candidate => ({ scale, left, top, score: 0 })

  /**
   * 整页粗扫：以设计稿取样间距的整数倍为步长，找出这个倍率下的最佳位置。
   * 每个倍率都独立扫全页，所以结果不受图层当前落点（先验）左右。
   */
  const globalScan = (scale: number, grid: Grid): Candidate => {
    const width = design.width * scale
    const height = design.height * scale
    const spacing = Math.max(6, (design.width / COLS) * scale)
    const step = Math.max(8, Math.round(spacing * 2))
    let best = place(scale, 0, 0)
    best.score = -1
    for (let top = Math.round(-height * 0.5); top <= page.height; top += step) {
      for (let left = Math.round(-width * 0.5); left <= page.width; left += step) {
        const probe = place(scale, left, top)
        probe.score = scoreOf(grid, probe)
        if (probe.score > best.score) best = probe
      }
    }
    return best
  }

  // 1) 缩放：每个倍率独立整页扫一次，按真实相关度排序
  const scales: Candidate[] = []
  const propose = (scale: number) => {
    if (!Number.isFinite(scale) || scale <= 0 || design.height * scale < 32) return
    scales.push(globalScan(scale, sparse))
  }
  for (let k = 0; k <= steps; k += 1) propose(minScale * SCALE_STEP ** k)
  // 1:1 与「刚好占满页面宽度」是最常见的两种落法，显式加进来
  for (const snap of [1, page.width / design.width]) {
    if (scales.some((item) => Math.abs(item.scale - snap) < 0.005)) continue
    propose(snap)
  }
  scales.sort((a, b) => b.score - a.score)
  if (!scales.length || scales[0].score < minScore) return null

  // 2) 中搜：粗扫是稀疏样点下的近似，前几名都用稠密样点重新评一遍，
  //    先验只用来打平局（页面上重复元素多时才起作用）
  const refine = (from: Candidate, radius: number, step: number, grid: Grid, factor: number) => {
    // 起始点必须用目标网格重新打分：粗扫（稀疏样点）的分数不能直接带进细扫，
    // 否则会出现「分数在一个位置、结果在另一个位置」的错位
    let current: Candidate = { ...from, score: scoreOf(grid, from) }
    for (let dy = -radius; dy <= radius; dy += step) {
      for (let dx = -radius; dx <= radius; dx += step) {
        const probe = place(current.scale * factor, from.left + dx, from.top + dy)
        probe.score = scoreOf(grid, probe)
        if (probe.score > current.score) current = probe
      }
    }
    return current
  }
  const coarseRadius = (candidate: Candidate) => {
    const spacing = Math.max(6, (design.width / COLS) * candidate.scale)
    return Math.max(10, Math.round(spacing * 2))
  }

  const shortlist = scales
    .slice(0, SHORTLIST)
    .map((candidate) => {
      const radius = coarseRadius(candidate)
      return refine(candidate, radius, Math.max(2, Math.round(radius / 7)), fine, 1)
    })

  let best = shortlist[0]
  let bestAdjusted = -1
  for (const candidate of shortlist) {
    const adjusted = candidate.score - distancePenalty(candidate, design, hint, page.width, page.height)
    if (adjusted > bestAdjusted) {
      bestAdjusted = adjusted
      best = candidate
    }
  }

  // 3) 倍率细化：粗扫的几何步长只负责圈住大致范围。
  //    这里把「邻域倍率 + 1:1 / 铺满宽度」放在同一张网格上公平比一次，
  //    免得 97% 这种含糊倍率靠重采样多拿的那一点分赢过整数倍。
  const rescale = (from: Candidate, scale: number): Candidate => {
    const cx = from.left + (design.width * from.scale) / 2
    const cy = from.top + (design.height * from.scale) / 2
    return place(scale, cx - (design.width * scale) / 2, cy - (design.height * scale) / 2)
  }
  const naturals = [1, page.width / design.width].filter(
    (natural) => Number.isFinite(natural) && natural > 0,
  )
  const candidates: Candidate[] = []
  const tryScale = (scale: number) => {
    if (!Number.isFinite(scale) || scale <= 0) return
    if (Math.abs(scale / best.scale - 1) > 0.1) return
    candidates.push(refine(rescale(best, scale), 12, 3, fine, 1))
  }
  for (let k = -6; k <= 6; k += 1) tryScale(best.scale * (1 + k * 0.005))
  for (const natural of naturals) tryScale(natural)

  let refined = candidates[0]
  for (const candidate of candidates) if (candidate.score > refined.score) refined = candidate
  // 4) 分数几乎持平时优先整数倍：重采样会给「略微缩小」凭空多发一点分
  for (const natural of naturals) {
    const near = candidates.find((candidate) => Math.abs(candidate.scale / natural - 1) < 1e-6)
    if (near && near.score >= refined.score - 0.02) refined = near
  }

  // 5) 像素级收尾：把网格取整的误差消掉
  best = refine(refined, 8, 1, fine, 1)

  let left = best.left
  let top = best.top
  // 宽高同乘一个倍率，保证是等比缩放；高度由宽度反算，避免两边取整后比例微偏
  const width = Math.max(24, Math.round(design.width * best.scale))
  const height = Math.max(16, Math.round((width * design.height) / design.width))
  const snap = pixelSnap(design, page, left, top, width, height)
  if (snap) {
    // 位移估计和模糊网格的口径不完全一致，回退前先比一下分数，别把好位置换坏
    const snapped = scoreOf(fine, place(best.scale, left + snap.dx, top + snap.dy))
    if (snapped >= best.score - 0.005) {
      left += snap.dx
      top += snap.dy
    }
  }

  // 6) 峰值裕度：拿同一套稀疏样点扫一遍，把「离这里足够远的最佳分」当对手
  const rivalRadius = Math.max(24, Math.round(width * 0.25))
  const ownSparse = correlate(sparse, pageField, page.width, page.height, best.left, best.top, best.scale)
  const scanStep = Math.max(8, Math.round(Math.max(6, (design.width / COLS) * best.scale) * 2))
  let rival = -1
  for (let scanTop = Math.round(-height * 0.5); scanTop <= page.height; scanTop += scanStep) {
    for (let scanLeft = Math.round(-width * 0.5); scanLeft <= page.width; scanLeft += scanStep) {
      if (
        Math.abs(scanLeft - best.left) < rivalRadius &&
        Math.abs(scanTop - best.top) < rivalRadius
      ) {
        continue
      }
      const score = correlate(sparse, pageField, page.width, page.height, scanLeft, scanTop, best.scale)
      if (score > rival) rival = score
    }
  }
  // 整页都没有更接近的位置时 rival 仍是 -1，裕度按满分算
  const margin = Math.max(0, ownSparse - Math.max(0, rival))

  const rect: PlacementRect = {
    x: Math.round(left),
    y: Math.round(top),
    width,
    height,
  }
  if (best.score < minScore) return null
  // 报告的 scale 跟实际回写的宽高对得上，外部不用再自己推一遍
  return { rect, scale: width / design.width, score: best.score, margin }
}

/** 用共享的位移估计再精修一次，返回需要回补的整数位移 */
function pixelSnap(
  design: Raster,
  page: Raster,
  left: number,
  top: number,
  width: number,
  height: number,
): { dx: number; dy: number } | null {
  const roundedLeft = Math.round(left)
  const roundedTop = Math.round(top)
  const x = Math.max(0, roundedLeft)
  const y = Math.max(0, roundedTop)
  const w = Math.min(page.width, roundedLeft + width) - x
  const h = Math.min(page.height, roundedTop + height) - y
  if (w < 48 || h < 48) return null

  const shrink = Math.min(1, 640 / Math.max(w, h))
  const expected = resizeRaster(design, width, height)
  const actualCrop = cropRaster(page, { x, y, w, h })
  const expectCrop = cropRaster(expected, { x: x - roundedLeft, y: y - roundedTop, w, h })
  const actual = shrink < 1 ? resizeRaster(actualCrop, w * shrink, h * shrink) : actualCrop
  const expect = shrink < 1 ? resizeRaster(expectCrop, w * shrink, h * shrink) : expectCrop
  const shift = estimateShift(expect, actual, Math.max(8, Math.round(48 * shrink)))
  const dx = Math.round(shift.dx / shrink)
  const dy = Math.round(shift.dy / shrink)
  if (shift.gain <= 0.01 || Math.abs(dx) > MAX_SNAP || Math.abs(dy) > MAX_SNAP) return null
  return { dx, dy }
}
