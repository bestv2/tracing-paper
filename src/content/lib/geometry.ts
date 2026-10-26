import type { PointerEvent as ReactPointerEvent } from 'react'
import type { MockupLayer } from '@/shared/types'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface SnapTargets {
  x: number[]
  y: number[]
}

/** 视口参考线（文档坐标）+ 其他图层的边缘/中心线 */
export function collectTargets(layers: MockupLayer[], excludeId: string | null): SnapTargets {
  const scrollX = window.scrollX
  const scrollY = window.scrollY
  const vw = window.innerWidth
  const vh = window.innerHeight
  const xs = [scrollX, scrollX + vw / 2, scrollX + vw]
  const ys = [scrollY, scrollY + vh / 2, scrollY + vh]

  layers.forEach((layer) => {
    if (layer.id === excludeId || !layer.visible) return
    xs.push(layer.x, layer.x + layer.width / 2, layer.x + layer.width)
    ys.push(layer.y, layer.y + layer.height / 2, layer.y + layer.height)
  })

  return { x: xs, y: ys }
}

function bestDelta(values: number[], targets: number[], threshold: number) {
  let delta: number | null = null
  let guide: number | null = null
  for (const value of values) {
    for (const target of targets) {
      const diff = target - value
      if (Math.abs(diff) > threshold) continue
      if (delta === null || Math.abs(diff) < Math.abs(delta)) {
        delta = diff
        guide = target
      }
    }
  }
  return { delta, guide }
}

export interface SnapResult {
  x: number
  y: number
  guides: { x: number[]; y: number[] }
}

/** 拖动吸附：左/中/右、上/中/下 三组基准线 */
export function snapRect(
  rect: Rect,
  targets: SnapTargets,
  threshold: number,
  enabled: boolean,
): SnapResult {
  if (!enabled) return { x: rect.x, y: rect.y, guides: { x: [], y: [] } }
  const horizontal = bestDelta(
    [rect.x, rect.x + rect.width / 2, rect.x + rect.width],
    targets.x,
    threshold,
  )
  const vertical = bestDelta(
    [rect.y, rect.y + rect.height / 2, rect.y + rect.height],
    targets.y,
    threshold,
  )
  return {
    x: rect.x + (horizontal.delta ?? 0),
    y: rect.y + (vertical.delta ?? 0),
    guides: {
      x: horizontal.guide === null ? [] : [horizontal.guide],
      y: vertical.guide === null ? [] : [vertical.guide],
    },
  }
}

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** 根据手柄方向计算新矩形，shift 保持比例 */
export function resizeRect(
  start: Rect,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  lockAspect: boolean,
  minSize = 24,
): Rect {
  let { x, y, width, height } = start
  const ratio = start.width / Math.max(1, start.height)

  if (handle.includes('e')) width = start.width + dx
  if (handle.includes('s')) height = start.height + dy
  if (handle.includes('w')) {
    width = start.width - dx
    x = start.x + dx
  }
  if (handle.includes('n')) {
    height = start.height - dy
    y = start.y + dy
  }

  if (lockAspect) {
    const horizontal = handle === 'e' || handle === 'w'
    const vertical = handle === 'n' || handle === 's'
    if (!vertical) {
      const nextHeight = Math.round(width / ratio)
      if (handle.includes('n')) y = start.y + (start.height - nextHeight)
      height = nextHeight
    } else if (!horizontal) {
      const nextWidth = Math.round(height * ratio)
      if (handle.includes('w')) x = start.x + (start.width - nextWidth)
      width = nextWidth
    }
  }

  if (width < minSize) {
    if (handle.includes('w')) x -= minSize - width
    width = minSize
  }
  if (height < minSize) {
    if (handle.includes('n')) y -= minSize - height
    height = minSize
  }

  return { x, y, width, height }
}

/** 缩放手柄吸附：只吸附正在移动的那条边 */
export function snapResize(
  rect: Rect,
  handle: ResizeHandle,
  targets: SnapTargets,
  threshold: number,
  enabled: boolean,
): Rect & { guides: { x: number[]; y: number[] } } {
  if (!enabled) return { ...rect, guides: { x: [], y: [] } }
  let { x, y, width, height } = rect
  const guides: { x: number[]; y: number[] } = { x: [], y: [] }

  if (handle.includes('e')) {
    const result = bestDelta([x + width], targets.x, threshold)
    if (result.delta !== null) {
      width += result.delta
      if (result.guide !== null) guides.x.push(result.guide)
    }
  }
  if (handle.includes('w')) {
    const result = bestDelta([x], targets.x, threshold)
    if (result.delta !== null) {
      x += result.delta
      width -= result.delta
      if (result.guide !== null) guides.x.push(result.guide)
    }
  }
  if (handle.includes('s')) {
    const result = bestDelta([y + height], targets.y, threshold)
    if (result.delta !== null) {
      height += result.delta
      if (result.guide !== null) guides.y.push(result.guide)
    }
  }
  if (handle.includes('n')) {
    const result = bestDelta([y], targets.y, threshold)
    if (result.delta !== null) {
      y += result.delta
      height -= result.delta
      if (result.guide !== null) guides.y.push(result.guide)
    }
  }

  return { x, y, width: Math.max(24, width), height: Math.max(24, height), guides }
}

export function pointerInDocument(event: PointerEvent | ReactPointerEvent): { x: number; y: number } {
  return { x: event.clientX + window.scrollX, y: event.clientY + window.scrollY }
}
