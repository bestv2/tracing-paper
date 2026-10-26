/**
 * 扩展侧比对编排：抓当前视口 → 裁到设计稿图层区域 → 跑共享管线 → DOM 归因 → 生成可导出的报告。
 * 界面只负责展示，所有结论字段与 CLI 完全同构（tracing.diff/1）。
 */

import {
  compareRasters,
  cropRaster,
  estimatePlacement,
  finalizeReport,
  resizeRaster,
  toJson,
  toMarkdown,
  toSarif,
  type Baseline,
  type DiffReport,
  type Raster,
  type Rect,
} from '@/shared/diff'
import type { ApiResponse, CapturePayload, MockupLayer } from '@/shared/types'
import { t } from '@/shared/i18n'
import { useSceneStore } from '../store'
import { attributeRect } from './attribute'
import { decodeRaster, rasterToDataUrl, settle } from './raster'

export interface DiffCrop {
  id: string
  box: Rect
  expected: string
  actual: string
  diff: string
}

export interface DiffSession {
  createdAt: number
  report: DiffReport
  diffImage?: string
  crops: DiffCrop[]
  json: string
  markdown: string
  sarif: string
  /** 比对区域左上角在文档坐标中的位置（已含对齐位移），用于把 box 画回页面 */
  anchor: { x: number; y: number }
  dpr: number
  /** 基准自检结论（报告里也有一份，这里方便界面直接用） */
  baseline: Baseline
  /** 这次结果是在什么图层状态下算出来的，用于判断结果是否已经失效 */
  basis: { layerId: string; rect: Rect }
}

export interface DiffOptions {
  layerId?: string
}

const MAX_CROPS = 8
/** 低于这个匹配度就认为基准不可信 */
const BASELINE_TRUST = 0.55
/** 峰值裕度低于此值：匹配点不突出，分数再高也是巧合 */
const BASELINE_MARGIN = 0.12
/** 落点差多少 px 就要提醒重新对齐 */
const BASELINE_SHIFT = 2
/** 倍率差多少就要提醒重新缩放 */
const BASELINE_SCALE = 0.01

function intersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.w, b.x + b.w)
  const bottom = Math.min(a.y + a.h, b.y + b.h)
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) }
}

export function pickLayer(layers: MockupLayer[], preferred?: string | null): MockupLayer | null {
  const byId = preferred ? layers.find((layer) => layer.id === preferred) : undefined
  if (byId?.visible) return byId
  const visible = layers.filter((layer) => layer.visible)
  return visible[visible.length - 1] ?? null
}

/** 图层必须完整落在视口里才截得到，先滚到它上面 */
export async function ensureInView(layer: MockupLayer): Promise<void> {
  const margin = 12
  const left = layer.x - window.scrollX
  const top = layer.y - window.scrollY
  const width = Math.min(layer.width, window.innerWidth - margin * 2)
  const height = Math.min(layer.height, window.innerHeight - margin * 2)
  const inside =
    left >= margin - 0.5 &&
    top >= margin - 0.5 &&
    left + width <= window.innerWidth - margin + 0.5 &&
    top + height <= window.innerHeight - margin + 0.5
  if (inside) return
  window.scrollTo({ left: Math.max(0, layer.x - margin), top: Math.max(0, layer.y - margin) })
  await settle(2, 40)
}

/**
 * 页面上所有浮层节点。正常只有一个；扩展重载后上一代实例可能没清干净，
 * 留着两套界面不但碍事，截图时漏藏一套就会把设计稿自己也拍进去。
 */
function hostNodes(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('tracing-paper-root'))
}

/** 截当前可见区域：先把自家浮层藏起来，否则设计稿会一起进画面 */
export async function captureViewport(): Promise<Raster> {
  const hosts = hostNodes()
  if (!hosts.length) throw new Error(t('diff.err.noHost'))
  // 隐藏前记下原样，恢复时整份样式还回去：host 自带 display:block !important
  const saved = hosts.map((host) => host.getAttribute('style'))
  for (const host of hosts) host.style.setProperty('display', 'none', 'important')
  try {
    await settle(3, 120)
    const response = (await chrome.runtime.sendMessage({ type: 'TP_CAPTURE_VISIBLE' })) as
      | ApiResponse<CapturePayload>
      | undefined
    if (!response?.ok || !response.data?.dataUrl) {
      throw new Error(response?.error ?? t('diff.err.capture'))
    }
    return await decodeRaster(response.data.dataUrl)
  } finally {
    hosts.forEach((host, index) => {
      const style = saved[index]
      if (style === null) host.removeAttribute('style')
      else host.setAttribute('style', style)
    })
    await settle(1, 0)
  }
}

export async function runDiff(options: DiffOptions = {}): Promise<DiffSession> {
  const state = useSceneStore.getState()
  const layer = pickLayer(state.layers, options.layerId ?? state.selectedId)
  if (!layer) throw new Error(t('diff.err.noLayer'))
  if (!layer.src) throw new Error(t('diff.err.noSrc'))

  const design = await decodeRaster(layer.src)
  if (!design.width || !design.height) throw new Error(t('diff.err.decode'))

  const notes: string[] = []
  await ensureInView(layer)

  const box = {
    x: layer.x - window.scrollX,
    y: layer.y - window.scrollY,
    w: layer.width,
    h: layer.height,
  }
  const area = intersect(box, { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight })
  if (area.w < 16 || area.h < 16) throw new Error(t('diff.err.outside'))
  if (area.w < box.w - 1 || area.h < box.h - 1) {
    notes.push(
      t('diff.note.outOfViewport', {
        w: Math.round(box.w),
        h: Math.round(box.h),
        aw: Math.round(area.w),
        ah: Math.round(area.h),
      }),
    )
  }

  const shot = await captureViewport()
  // 截图是设备像素，换算回 CSS px 的比例就是等效 DPR（含浏览器缩放）
  const dpr = Math.min(4, Math.max(0.25, shot.width / Math.max(1, window.innerWidth)))
  const nativeDpr = window.devicePixelRatio || 1
  if (Math.abs(dpr - nativeDpr) > Math.max(0.02, nativeDpr * 0.03)) {
    notes.push(
      t('diff.note.dprMismatch', { dpr: dpr.toFixed(3), native: nativeDpr }),
    )
  }

  // 基准自检：这些差异都是「按图层落点」算出来的，落点不对，数字再小也没意义。
  // 用同一套匹配算法在页面截图里找设计稿的真实位置，给结论打个可信度分。
  const pageCss = resizeRaster(
    shot,
    Math.max(1, Math.round(window.innerWidth)),
    Math.max(1, Math.round(window.innerHeight)),
  )
  const placement = estimatePlacement(design, pageCss, {
    hint: { x: box.x, y: box.y, width: box.w, height: box.h },
  })
  const expectedScale = layer.width / Math.max(1, design.width)
  const drift = placement
    ? { dx: Math.round(placement.rect.x - box.x), dy: Math.round(placement.rect.y - box.y) }
    : { dx: 0, dy: 0 }
  const scaleRatio = placement ? placement.scale / expectedScale : 1
  const trust = placement?.score ?? 0
  // 分数高但峰值不突出（页面上到处都有相似的块面），同样不能当真
  const margin = placement?.margin ?? 0
  const found = !!placement && trust >= BASELINE_TRUST && margin >= BASELINE_MARGIN
  const baseline: Baseline = {
    score: Number(trust.toFixed(3)),
    margin: Number(margin.toFixed(3)),
    verdict: !found
      ? 'weak'
      : Math.abs(drift.dx) > BASELINE_SHIFT ||
          Math.abs(drift.dy) > BASELINE_SHIFT ||
          Math.abs(scaleRatio - 1) > BASELINE_SCALE
        ? 'drift'
        : 'ok',
    suggested: placement
      ? {
          x: Math.round(placement.rect.x + window.scrollX),
          y: Math.round(placement.rect.y + window.scrollY),
          width: placement.rect.width,
          height: placement.rect.height,
        }
      : { x: layer.x, y: layer.y, width: layer.width, height: layer.height },
    drift,
    scaleRatio: Number(scaleRatio.toFixed(3)),
  }
  notes.push(
    baseline.verdict === 'ok'
      ? t('diff.note.baselineOk', { score: baseline.score.toFixed(2), dx: drift.dx, dy: drift.dy })
      : baseline.verdict === 'drift'
        ? t('diff.note.baselineDrift', {
            score: baseline.score.toFixed(2),
            dx: drift.dx,
            dy: drift.dy,
            percent: Math.round(scaleRatio * 100),
          })
        : t('diff.note.baselineWeak', { score: baseline.score.toFixed(2) }),
  )

  // 统一到 CSS px：设计稿按图层渲染尺寸裁切，页面截图按 DPR 缩回来，两边像素口径一致
  const width = Math.max(16, Math.round(area.w))
  const height = Math.max(16, Math.round(area.h))
  const actual = resizeRaster(
    cropRaster(shot, {
      x: Math.round(area.x * dpr),
      y: Math.round(area.y * dpr),
      w: Math.round(area.w * dpr),
      h: Math.round(area.h * dpr),
    }),
    width,
    height,
  )

  const scaleX = design.width / Math.max(1, layer.width)
  const scaleY = design.height / Math.max(1, layer.height)
  const expected = resizeRaster(
    cropRaster(design, {
      x: (area.x - box.x) * scaleX,
      y: (area.y - box.y) * scaleY,
      w: area.w * scaleX,
      h: area.h * scaleY,
    }),
    width,
    height,
  )

  const layerRatio = layer.width / Math.max(1, layer.height)
  const designRatio = design.width / Math.max(1, design.height)
  if (Math.abs(layerRatio / designRatio - 1) > 0.02) {
    notes.push(
      t('diff.note.ratio', { a: layerRatio.toFixed(2), b: designRatio.toFixed(2) }),
    )
  }
  notes.push(t('diff.note.cssPx', { w: width, h: height, dpr: dpr.toFixed(2) }))

  const result = compareRasters({ expected, actual, align: 'auto' })
  const { dx, dy } = result.report.inputs.alignment
  const originX = area.x + window.scrollX + dx
  const originY = area.y + window.scrollY + dy

  // 归因：box 在设计稿坐标系里，加回落点后才是页面元素所在的视口位置
  result.report.findings.forEach((finding) => {
    const element = attributeRect({
      x: area.x + finding.box.x + dx,
      y: area.y + finding.box.y + dy,
      w: finding.box.w,
      h: finding.box.h,
    })
    if (element) finding.element = element
  })

  const diffImage = result.diffImage ? rasterToDataUrl(result.diffImage) : undefined
  const crops: DiffCrop[] = result.crops.slice(0, MAX_CROPS).map((crop) => ({
    id: crop.id,
    box: crop.box,
    expected: rasterToDataUrl(crop.expected),
    actual: rasterToDataUrl(crop.actual),
    diff: rasterToDataUrl(crop.diff),
  }))

  const report = finalizeReport(result.report, {
    mode: 'extension',
    expected: { name: layer.name, width: expected.width, height: expected.height },
    actual: {
      name: `${location.host}${location.pathname}`,
      url: location.href,
      width,
      height,
      dpr: Number(dpr.toFixed(2)),
      scrollX: Math.round(window.scrollX),
      scrollY: Math.round(window.scrollY),
    },
    alignment: {
      scale: design.width ? Number((layer.width / design.width).toFixed(3)) : 1,
      method: result.report.inputs.alignment.method === 'auto' ? 'auto' : 'layer-rect',
    },
    artifacts: {
      ...(diffImage ? { diffImage: 'diff.png' } : {}),
      report: 'report.json',
      markdown: 'report.md',
      sarif: 'report.sarif',
      crops: crops.map((crop) => ({
        id: crop.id,
        expected: `crops/${crop.id}.expected.png`,
        actual: `crops/${crop.id}.actual.png`,
        diff: `crops/${crop.id}.diff.png`,
      })),
    },
    baseline,
    notes,
  })

  return {
    createdAt: Date.now(),
    report,
    diffImage,
    crops,
    json: toJson(report),
    markdown: toMarkdown(report),
    sarif: toSarif(report),
    anchor: { x: originX, y: originY },
    dpr: Number(dpr.toFixed(2)),
    baseline,
    basis: {
      layerId: layer.id,
      rect: { x: layer.x, y: layer.y, w: layer.width, h: layer.height },
    },
  }
}

/** 面板/快捷键/消息共用的入口：负责忙状态、提示与错误兜底 */
export async function runDiffFlow(options: DiffOptions = {}): Promise<DiffSession | null> {
  const start = useSceneStore.getState()
  if (start.diffBusy) return null
  start.setDiffBusy(true)
  start.setPanel('diff')

  try {
    const session = await runDiff(options)
    const store = useSceneStore.getState()
    store.setDiff(session)
    store.setDiffFocus(session.report.findings[0]?.id ?? null)
    store.notify(
      session.report.summary.verdict === 'clean'
        ? t('toast.diffClean')
        : t('toast.diffFindings', { count: session.report.summary.findings }),
    )
    return session
  } catch (error) {
    const store = useSceneStore.getState()
    store.setDiff(null)
    store.notify(error instanceof Error ? error.message : t('toast.diffFailed'), 'warn')
    return null
  } finally {
    useSceneStore.getState().setDiffBusy(false)
  }
}

/** 按自检结论把图层挪到页面真实内容上，然后立即重比 */
export async function alignBaselineAndRerun(session: DiffSession): Promise<DiffSession | null> {
  const store = useSceneStore.getState()
  const layer = store.layers.find((item) => item.id === session.basis.layerId)
  if (!layer) {
    store.notify(t('diff.err.noLayer'), 'warn')
    return null
  }
  const { suggested } = session.baseline
  store.pushHistory()
  store.patchLayer(layer.id, {
    x: suggested.x,
    y: suggested.y,
    width: suggested.width,
    height: suggested.height,
  })
  store.notify(t('diff.baseline.aligned'))
  return runDiffFlow({ layerId: layer.id })
}

/** 差异框在文档坐标里的位置，供页面标记层使用 */
export function findingRect(session: DiffSession, findingId: string): Rect | null {
  const finding = session.report.findings.find((item) => item.id === findingId)
  if (!finding) return null
  return {
    x: session.anchor.x + finding.box.x,
    y: session.anchor.y + finding.box.y,
    w: finding.box.w,
    h: finding.box.h,
  }
}

export const DIFF_FILE_NAME = 'tracing-diff'
