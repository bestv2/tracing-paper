import { create } from 'zustand'
import type { MockupLayer } from '@/shared/types'
import { clamp, uid } from '@/shared/utils'
import type { DiffSession } from './lib/diff'

type Snapshot = MockupLayer[]

export interface Toast {
  id: string
  message: string
  tone: 'info' | 'warn'
}

export type PanelKind = 'blend' | 'fit' | 'size' | 'layers' | 'help' | 'more' | 'diff' | null

interface SceneStore {
  layers: MockupLayer[]
  selectedId: string | null
  frozen: boolean
  toolbarVisible: boolean
  snapEnabled: boolean
  panel: PanelKind
  guides: { x: number[]; y: number[] }
  toast: Toast | null
  canUndo: boolean
  canRedo: boolean
  /** 最近一次比对结果，关闭面板后仍保留供导出 */
  diff: DiffSession | null
  diffBusy: boolean
  diffFocus: string | null
  /** 自动对齐搜索中 */
  fitBusy: boolean
  /** 差异大图查看中：此时全局快捷键让行，避免方向键挪图层 */
  lightbox: boolean

  addLayers: (layers: MockupLayer[], selectId?: string) => void
  patchLayer: (id: string, patch: Partial<MockupLayer>, record?: boolean) => void
  removeLayer: (id: string) => void
  duplicateLayer: (id: string) => void
  moveLayerOrder: (id: string, direction: 1 | -1) => void
  select: (id: string | null) => void
  bringToFront: (id: string) => void

  setFrozen: (frozen: boolean) => void
  setToolbarVisible: (visible: boolean) => void
  /** 收起工具栏：只留迷你入口，随时可再展开；报告面板保持打开 */
  collapseToolbar: () => void
  setSnapEnabled: (enabled: boolean) => void
  setPanel: (panel: PanelKind) => void
  setGuides: (guides: { x: number[]; y: number[] }) => void
  notify: (message: string, tone?: Toast['tone']) => void
  dismissToast: (id: string) => void

  setDiff: (session: DiffSession | null) => void
  setDiffBusy: (busy: boolean) => void
  setDiffFocus: (id: string | null) => void
  setFitBusy: (busy: boolean) => void
  setLightbox: (open: boolean) => void

  pushHistory: () => void
  undo: () => void
  redo: () => void
  clear: () => void
  replaceAll: (layers: MockupLayer[], selectedId: string | null) => void
  selectedLayer: () => MockupLayer | null
}

const past: Snapshot[] = []
const future: Snapshot[] = []
const HISTORY_LIMIT = 60

const clone = (layers: MockupLayer[]): Snapshot => layers.map((layer) => ({ ...layer }))

export const useSceneStore = create<SceneStore>((set, get) => ({
  layers: [],
  selectedId: null,
  frozen: false,
  toolbarVisible: true,
  snapEnabled: true,
  panel: null,
  guides: { x: [], y: [] },
  toast: null,
  canUndo: false,
  canRedo: false,
  diff: null,
  diffBusy: false,
  diffFocus: null,
  fitBusy: false,
  lightbox: false,

  addLayers: (layers, selectId) => {
    if (!layers.length) return
    get().pushHistory()
    set((state) => ({
      layers: [...state.layers, ...layers],
      selectedId: selectId ?? layers[layers.length - 1].id,
    }))
  },

  patchLayer: (id, patch, record = false) => {
    if (record) get().pushHistory()
    set((state) => ({
      layers: state.layers.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)),
    }))
  },

  removeLayer: (id) => {
    get().pushHistory()
    set((state) => {
      const layers = state.layers.filter((layer) => layer.id !== id)
      return {
        layers,
        selectedId: state.selectedId === id ? (layers[layers.length - 1]?.id ?? null) : state.selectedId,
      }
    })
  },

  duplicateLayer: (id) => {
    const source = get().layers.find((layer) => layer.id === id)
    if (!source) return
    get().pushHistory()
    const copy: MockupLayer = {
      ...source,
      id: uid(),
      name: `${source.name} 副本`,
      x: source.x + 24,
      y: source.y + 24,
    }
    set((state) => ({ layers: [...state.layers, copy], selectedId: copy.id }))
  },

  moveLayerOrder: (id, direction) => {
    const { layers } = get()
    const index = layers.findIndex((layer) => layer.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= layers.length) return
    get().pushHistory()
    const next = [...layers]
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    set({ layers: next })
  },

  bringToFront: (id) => {
    const { layers } = get()
    const index = layers.findIndex((layer) => layer.id === id)
    if (index < 0 || index === layers.length - 1) return
    const next = [...layers]
    const [item] = next.splice(index, 1)
    next.push(item)
    set({ layers: next })
  },

  select: (id) => set({ selectedId: id }),

  setFrozen: (frozen) => set({ frozen }),
  setToolbarVisible: (visible) => set({ toolbarVisible: visible }),
  collapseToolbar: () => {
    const { panel } = get()
    set({ toolbarVisible: false, panel: panel === 'diff' ? 'diff' : null })
  },
  setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),
  setPanel: (panel) => set({ panel }),
  setGuides: (guides) => set({ guides }),

  setDiff: (session) => set({ diff: session, diffFocus: session?.report.findings[0]?.id ?? null }),
  setDiffBusy: (busy) => set({ diffBusy: busy }),
  setDiffFocus: (id) => set({ diffFocus: id }),
  setFitBusy: (busy) => set({ fitBusy: busy }),
  setLightbox: (open) => set({ lightbox: open }),

  notify: (message, tone = 'info') => {
    const toast: Toast = { id: uid('toast'), message, tone }
    set({ toast })
    window.setTimeout(() => {
      if (get().toast?.id === toast.id) set({ toast: null })
    }, 2200)
  },
  dismissToast: (id) => {
    if (get().toast?.id === id) set({ toast: null })
  },

  pushHistory: () => {
    const current = get().layers
    const top = past[past.length - 1]
    if (top && top.length === current.length && top.every((layer, i) => layer === current[i])) return
    past.push(clone(current))
    if (past.length > HISTORY_LIMIT) past.shift()
    future.length = 0
    set({ canUndo: true, canRedo: false })
  },

  undo: () => {
    const snapshot = past.pop()
    if (!snapshot) return
    future.push(clone(get().layers))
    const selectedId = snapshot.some((layer) => layer.id === get().selectedId) ? get().selectedId : null
    set({ layers: snapshot, selectedId, canUndo: past.length > 0, canRedo: true })
  },

  redo: () => {
    const snapshot = future.pop()
    if (!snapshot) return
    past.push(clone(get().layers))
    set({ layers: snapshot, canUndo: true, canRedo: future.length > 0 })
  },

  clear: () => {
    if (!get().layers.length) return
    get().pushHistory()
    set({ layers: [], selectedId: null })
  },

  replaceAll: (layers, selectedId) => {
    past.length = 0
    future.length = 0
    set({ layers, selectedId, canUndo: false, canRedo: false })
  },

  selectedLayer: () => {
    const { layers, selectedId } = get()
    return layers.find((layer) => layer.id === selectedId) ?? null
  },
}))

/** 把页面尺寸换算成新图层的初始尺寸与位置（居中，最多占 90% 视口） */
export function initialRect(width: number, height: number, offset = 0) {
  const viewportW = window.innerWidth
  const viewportH = window.innerHeight
  const scale = Math.min(1, (viewportW * 0.9) / width, (viewportH * 0.9) / height)
  const w = Math.round(width * scale)
  const h = Math.round(height * scale)
  const x = Math.round(window.scrollX + (viewportW - w) / 2 + offset)
  const y = Math.round(window.scrollY + Math.max(24, (viewportH - h) / 2) + offset)
  return { x, y, width: w, height: h }
}

export function clampOpacity(value: number): number {
  return clamp(Math.round(value * 100) / 100, 0, 1)
}
