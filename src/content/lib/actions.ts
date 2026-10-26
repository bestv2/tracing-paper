import type { MockupLayer } from '@/shared/types'
import { useSceneStore } from '../store'

export type FitKind = 'reset' | 'natural' | 'double' | 'half' | 'window' | 'center'

/** 图层 DOM 节点登记表，供闪烁对比等需要直接操作节点的能力使用 */
export const layerNodes = new Map<string, HTMLElement>()

function centerInViewport(width: number, height: number) {
  return {
    width,
    height,
    x: Math.round(window.scrollX + (window.innerWidth - width) / 2),
    y: Math.round(window.scrollY + Math.max(16, (window.innerHeight - height) / 2)),
  }
}

export function applyFit(kind: FitKind, layer: MockupLayer): void {
  const store = useSceneStore.getState()
  const naturalW = layer.naturalWidth || layer.width
  const naturalH = layer.naturalHeight || layer.height
  const ratio = naturalH / Math.max(1, naturalW)
  const viewportW = window.innerWidth

  let next = { width: layer.width, height: layer.height, x: layer.x, y: layer.y }

  switch (kind) {
    case 'natural':
      next = centerInViewport(naturalW, naturalH)
      break
    case 'double':
      next = centerInViewport(naturalW * 2, naturalH * 2)
      break
    case 'half':
      next = centerInViewport(Math.round(naturalW / 2), Math.round(naturalH / 2))
      break
    case 'window':
      next = {
        width: viewportW,
        height: Math.round(viewportW * ratio),
        x: Math.round(window.scrollX),
        y: Math.round(window.scrollY),
      }
      break
    case 'center':
      next = {
        width: layer.width,
        height: layer.height,
        x: Math.round(window.scrollX + (viewportW - layer.width) / 2),
        y: Math.round(window.scrollY + (window.innerHeight - layer.height) / 2),
      }
      break
    case 'reset': {
      const width = Math.min(naturalW, viewportW)
      next = centerInViewport(Math.round(width), Math.round(width * ratio))
      break
    }
  }

  store.pushHistory()
  store.patchLayer(layer.id, next)
}

/** 快速闪烁两次，肉眼比对设计稿与页面差异 */
export function flashCompare(layerId: string): void {
  const node = layerNodes.get(layerId)
  if (!node) return
  node.animate(
    [
      { opacity: 1, offset: 0 },
      { opacity: 0.04, offset: 0.25 },
      { opacity: 1, offset: 0.5 },
      { opacity: 0.04, offset: 0.75 },
      { opacity: 1, offset: 1 },
    ],
    { duration: 1200, easing: 'ease-in-out' },
  )
}
