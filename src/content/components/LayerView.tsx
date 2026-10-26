import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { MockupLayer } from '@/shared/types'
import { useSceneStore } from '../store'
import {
  collectTargets,
  HANDLES,
  pointerInDocument,
  resizeRect,
  snapRect,
  snapResize,
  type ResizeHandle,
} from '../lib/geometry'
import { drawBitmap, getRegisteredBitmap } from '../lib/image'
import { layerNodes } from '../lib/actions'

interface LayerViewProps {
  layer: MockupLayer
  zIndex: number
  selected: boolean
  frozen: boolean
  snapEnabled: boolean
  layers: MockupLayer[]
}

const SNAP_THRESHOLD = 7

export function LayerView({ layer, zIndex, selected, frozen, snapEnabled, layers }: LayerViewProps) {
  const patchLayer = useSceneStore((state) => state.patchLayer)
  const pushHistory = useSceneStore((state) => state.pushHistory)
  const select = useSceneStore((state) => state.select)
  const setGuides = useSceneStore((state) => state.setGuides)
  const [dragging, setDragging] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const elementRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef(layer)
  layerRef.current = layer
  const layersRef = useRef(layers)
  layersRef.current = layers
  const wheelRecorded = useRef(false)
  const wheelTimer = useRef<number>()

  useEffect(() => {
    if (layer.renderMode !== 'canvas' || !canvasRef.current) return
    const bitmap = getRegisteredBitmap(layer.id)
    if (bitmap) drawBitmap(canvasRef.current, bitmap)
  }, [layer.id, layer.renderMode])

  useEffect(() => {
    const node = elementRef.current
    if (!node) return undefined
    layerNodes.set(layer.id, node)
    return () => {
      layerNodes.delete(layer.id)
    }
  }, [layer.id])

  /** alt + 滚轮按比例缩放（以中心点为锚） */
  useEffect(() => {
    const node = elementRef.current
    if (!node) return
    const onWheel = (event: WheelEvent) => {
      if (!event.altKey || frozen || layerRef.current.locked) return
      event.preventDefault()
      if (!wheelRecorded.current) {
        pushHistory()
        wheelRecorded.current = true
      }
      window.clearTimeout(wheelTimer.current)
      wheelTimer.current = window.setTimeout(() => {
        wheelRecorded.current = false
      }, 500)
      const current = layerRef.current
      const factor = event.deltaY < 0 ? 1.04 : 0.96
      const width = Math.max(24, Math.round(current.width * factor))
      const height = Math.max(24, Math.round(current.height * factor))
      patchLayer(current.id, {
        width,
        height,
        x: current.x + (current.width - width) / 2,
        y: current.y + (current.height - height) / 2,
      })
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      node.removeEventListener('wheel', onWheel)
      window.clearTimeout(wheelTimer.current)
    }
  }, [frozen, patchLayer, pushHistory])

  const startMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    select(layer.id)
    if (frozen || layer.locked) return
    event.preventDefault()
    event.stopPropagation()

    const origin = pointerInDocument(event)
    const start = { x: layer.x, y: layer.y, width: layer.width, height: layer.height }
    let moved = false
    let recorded = false
    setDragging(true)

    const handleMove = (moveEvent: PointerEvent) => {
      const point = pointerInDocument(moveEvent)
      const dx = point.x - origin.x
      const dy = point.y - origin.y
      if (!moved) {
        if (Math.hypot(dx, dy) < 2) return
        moved = true
      }
      if (!recorded) {
        pushHistory()
        recorded = true
      }
      const targets = collectTargets(layersRef.current, layerRef.current.id)
      const snapped = snapRect(
        { x: start.x + dx, y: start.y + dy, width: start.width, height: start.height },
        targets,
        SNAP_THRESHOLD,
        snapEnabled,
      )
      patchLayer(layerRef.current.id, { x: Math.round(snapped.x), y: Math.round(snapped.y) })
      setGuides(snapped.guides)
    }

    const finish = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      setGuides({ x: [], y: [] })
      setDragging(false)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const startResize = (handle: ResizeHandle) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    if (frozen || layer.locked) return
    event.preventDefault()
    event.stopPropagation()

    const origin = pointerInDocument(event)
    const start = { x: layer.x, y: layer.y, width: layer.width, height: layer.height }
    pushHistory()
    setDragging(true)

    const handleMove = (moveEvent: PointerEvent) => {
      const point = pointerInDocument(moveEvent)
      const dx = point.x - origin.x
      const dy = point.y - origin.y
      let rect = resizeRect(start, handle, dx, dy, moveEvent.shiftKey)
      const targets = collectTargets(layersRef.current, layerRef.current.id)
      const snapped = snapResize(rect, handle, targets, SNAP_THRESHOLD, snapEnabled && !moveEvent.shiftKey)
      rect = { x: snapped.x, y: snapped.y, width: snapped.width, height: snapped.height }
      patchLayer(layerRef.current.id, {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      })
      setGuides(snapped.guides)
    }

    const finish = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      setGuides({ x: [], y: [] })
      setDragging(false)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const fitToViewport = () => {
    if (frozen || layer.locked) return
    const naturalWidth = layer.naturalWidth || layer.width
    const naturalHeight = layer.naturalHeight || layer.height
    pushHistory()
    const width = Math.round(window.innerWidth)
    const height = Math.round((naturalHeight / Math.max(1, naturalWidth)) * width)
    patchLayer(layer.id, {
      x: Math.round(window.scrollX),
      y: Math.round(window.scrollY),
      width,
      height,
    })
  }

  const percent = layer.naturalWidth ? Math.round((layer.width / layer.naturalWidth) * 100) : 100

  return (
    <div
      ref={elementRef}
      className="tp-layer"
      data-layer-id={layer.id}
      data-draggable={!frozen && !layer.locked}
      data-dragging={dragging}
      data-hidden={!layer.visible}
      style={{
        width: layer.width,
        height: layer.height,
        transform: `translate3d(${layer.x}px, ${layer.y}px, 0)`,
        opacity: layer.opacity,
        mixBlendMode: layer.blend,
        zIndex,
        visibility: layer.visible ? 'visible' : 'hidden',
        pointerEvents: frozen || !layer.visible ? 'none' : 'auto',
      }}
      onPointerDown={startMove}
      onDoubleClick={fitToViewport}
    >
      {layer.renderMode === 'canvas' ? (
        <canvas ref={canvasRef} />
      ) : (
        <img src={layer.src} alt={layer.name} draggable={false} />
      )}

      {selected ? (
        <>
          <div className="tp-selection" data-locked={layer.locked} />
          <div className="tp-badge">
            <span className="tp-badge-name">{layer.name}</span>
            <em>
              {layer.width}×{layer.height}
            </em>
            <strong>{percent}%</strong>
          </div>
          {!frozen && !layer.locked
            ? HANDLES.map((handle) => (
                <div
                  key={handle}
                  className="tp-handle"
                  data-handle={handle}
                  onPointerDown={startResize(handle)}
                />
              ))
            : null}
        </>
      ) : null}
    </div>
  )
}
