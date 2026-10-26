/**
 * 自动对齐：把设计稿图层按页面实际内容缩放、挪到对应位置。
 *
 * 这里只做编排：抓视口截图（必要时换几个滚动位置）、调用共享层的
 * estimatePlacement 求「缩放 + 落点」、写回 store 并提示。
 * 匹配算法本身在 shared/diff/placement.ts，浏览器与 CLI / 回归脚本共用。
 */

import { estimatePlacement, resizeRaster, type PlacementRect, type Raster } from '@/shared/diff'
import type { MockupLayer } from '@/shared/types'
import { t } from '@/shared/i18n'
import { useSceneStore } from '../store'
import { captureViewport, ensureInView, pickLayer, runDiffFlow } from './diff'
import { decodeRaster, settle } from './raster'

export interface AutoFitResult {
  layerId: string
  rect: PlacementRect
  previous: PlacementRect
  /** 设计稿 1px 对应多少 CSS px */
  scale: number
  /** 匹配相关度，1 表示完全一致 */
  score: number
  changed: boolean
}

/** 换滚动位置重新截图的阈值：只有相当可信才不再试别的位置 */
const GOOD_SCORE = 0.8
/** 倍率跟「1:1 / 铺满宽度」差多少以内算常见落法 */
const NATURAL_TOLERANCE = 0.02
/**
 * 挑结果时允许为「常见落法」让步多少分。
 * 匹配用的是模糊亮度场，倍率差 2~3% 时分数只差一点点，
 * 所以宁可让步也要给 1:1 这种一眼就对的结果。
 */
const PREFER_MARGIN = 0.05

interface Anchor {
  x: number
  y: number
}

interface Found {
  rect: PlacementRect
  scale: number
  score: number
  scrollX: number
  scrollY: number
}

function scrollOf(): Anchor {
  return { x: Math.round(window.scrollX), y: Math.round(window.scrollY) }
}

/**
 * 候选滚动位置，按「最可能先命中」排序：
 * 当前视口 → 图层所在位置 → 页面顶部。同一个位置只截一次。
 *
 * 页面顶部这一档必须留着：滚动之后吸顶头部会盖住内容，同一个滚
 * 动位置匹配出来会微微偏小；回到顶部再截一次通常就能对上原尺寸。
 */
function planAnchors(layer: MockupLayer): Anchor[] {
  const current = scrollOf()

  const anchors: Anchor[] = []
  const push = (anchor: Anchor) => {
    const x = Math.max(0, Math.round(anchor.x))
    const y = Math.max(0, Math.round(anchor.y))
    if (anchors.some((item) => Math.abs(item.x - x) < 8 && Math.abs(item.y - y) < 8)) return
    anchors.push({ x, y })
  }

  push(current)
  push({ x: layer.x - 12, y: layer.y - 12 })
  push({ x: 0, y: 0 })
  return anchors
}

function toViewportRect(layer: MockupLayer, anchor: Anchor) {
  return {
    x: layer.x - anchor.x,
    y: layer.y - anchor.y,
    width: layer.width,
    height: layer.height,
  }
}

/** 在给定滚动位置上截图并匹配一次 */
async function matchAt(design: Raster, layer: MockupLayer, anchor: Anchor): Promise<Found | null> {
  const current = scrollOf()
  if (current.x !== anchor.x || current.y !== anchor.y) {
    window.scrollTo({ left: anchor.x, top: anchor.y })
    await settle(2, 60)
  }
  const shot = await captureViewport()
  const page = resizeRaster(
    shot,
    Math.max(1, Math.round(window.innerWidth)),
    Math.max(1, Math.round(window.innerHeight)),
  )
  const placement = estimatePlacement(design, page, { hint: toViewportRect(layer, anchor) })
  if (!placement) return null
  return {
    rect: placement.rect,
    scale: placement.scale,
    score: placement.score,
    scrollX: anchor.x,
    scrollY: anchor.y,
  }
}

/** 当前倍率离「1:1 或铺满宽度」差多远，0 表示正好落在常见的倍率上 */
function naturalDistance(scale: number, design: Raster): number {
  const naturals = [1, window.innerWidth / design.width]
  let min = Number.POSITIVE_INFINITY
  for (const natural of naturals) {
    if (!Number.isFinite(natural) || natural <= 0) continue
    min = Math.min(min, Math.abs(scale / natural - 1))
  }
  return min
}

/**
 * 多个滚动位置的结果里挑一个：分数明显更高就用它，否则比「落法是否常见」。
 * 1:1 与铺满宽度是日常最常见的两种，同样可信时优先它们，
 * 免得因为含糊的局部最优把设计稿缩到 97%、92%。
 */
function pick(founds: Found[], design: Raster): Found {
  let top = founds[0]
  for (const item of founds) if (item.score > top.score) top = item

  let best = top
  for (const item of founds) {
    if (item.score < top.score - PREFER_MARGIN) continue
    if (naturalDistance(item.scale, design) < naturalDistance(best.scale, design)) best = item
  }
  return best
}

/** 求设计稿应该落在文档坐标的哪里 */
async function locate(layer: MockupLayer): Promise<Found> {
  if (!layer.src) throw new Error(t('diff.err.noSrc'))
  const design = await decodeRaster(layer.src)
  if (!design.width || !design.height) throw new Error(t('diff.err.decode'))

  const start = scrollOf()
  const founds: Found[] = []
  try {
    for (const anchor of planAnchors(layer)) {
      const found = await matchAt(design, layer, anchor)
      if (found) founds.push(found)
      // 只有「够可信 + 倍率也常见」才提前收工；否则多试几个滚动位置，
      // 吸顶头部之类的遮挡很容易让古怪的倍率在单个位置占到便宜
      if (found && found.score >= GOOD_SCORE && naturalDistance(found.scale, design) < NATURAL_TOLERANCE) break
    }
  } finally {
    window.scrollTo({ left: start.x, top: start.y })
    await settle(1, 0)
  }

  if (!founds.length) throw new Error(t('fit.auto.fail'))
  const best = pick(founds, design)
  return {
    ...best,
    rect: {
      x: Math.round(best.rect.x + best.scrollX),
      y: Math.round(best.rect.y + best.scrollY),
      width: best.rect.width,
      height: best.rect.height,
    },
  }
}

/** 面板 / 工具栏 / 快捷键共用入口：负责忙状态、落库、提示 */
export async function runAutoFitFlow(options: { layerId?: string; rerun?: boolean } = {}) {
  const start = useSceneStore.getState()
  if (start.fitBusy) return null
  const layer = pickLayer(start.layers, options.layerId ?? start.selectedId)
  if (!layer) {
    start.notify(t('diff.err.noLayer'), 'warn')
    return null
  }

  start.setFitBusy(true)
  start.notify(t('fit.auto.busy'))
  let result: AutoFitResult | null = null
  try {
    const found = await locate(layer)
    const previous: PlacementRect = {
      x: layer.x,
      y: layer.y,
      width: layer.width,
      height: layer.height,
    }
    const changed =
      Math.abs(found.rect.x - previous.x) > 1 ||
      Math.abs(found.rect.y - previous.y) > 1 ||
      Math.abs(found.rect.width - previous.width) > 1 ||
      Math.abs(found.rect.height - previous.height) > 1
    result = { layerId: layer.id, rect: found.rect, previous, scale: found.scale, score: found.score, changed }

    const store = useSceneStore.getState()
    if (!changed) {
      store.notify(t('fit.auto.aligned'))
      return result
    }

    store.pushHistory()
    store.patchLayer(layer.id, found.rect)
    store.notify(
      t('fit.auto.done', {
        percent: Math.round(found.scale * 100),
        dx: found.rect.x - previous.x,
        dy: found.rect.y - previous.y,
      }),
    )
    // 结果可能落在别处，滚过去让用户看到对齐后的样子
    const patched = useSceneStore.getState().layers.find((item) => item.id === layer.id)
    if (patched) await ensureInView(patched)
    if (options.rerun) await runDiffFlow({ layerId: layer.id })
    return result
  } catch (error) {
    useSceneStore
      .getState()
      .notify(error instanceof Error ? error.message : t('fit.auto.fail'), 'warn')
    return null
  } finally {
    useSceneStore.getState().setFitBusy(false)
  }
}
