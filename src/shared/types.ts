export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'

export const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: 'normal', label: '正常' },
  { value: 'difference', label: '差值' },
  { value: 'multiply', label: '正片叠底' },
  { value: 'screen', label: '滤色' },
  { value: 'overlay', label: '叠加' },
  { value: 'darken', label: '变暗' },
  { value: 'lighten', label: '变亮' },
  { value: 'color-dodge', label: '颜色减淡' },
  { value: 'color-burn', label: '颜色加深' },
  { value: 'hard-light', label: '强光' },
  { value: 'soft-light', label: '柔光' },
  { value: 'exclusion', label: '排除' },
  { value: 'hue', label: '色相' },
  { value: 'saturation', label: '饱和度' },
  { value: 'color', label: '颜色' },
  { value: 'luminosity', label: '亮度' },
]

/** 图片在页面中的渲染方式：CSP 严格时降级为 canvas */
export type RenderMode = 'img' | 'canvas'

export interface MockupLayer {
  id: string
  /** 素材库里的图片 id */
  imageId: string
  name: string
  /** 运行时地址（dataURL / blobURL），不落盘 */
  src: string
  renderMode: RenderMode
  naturalWidth: number
  naturalHeight: number
  /** 文档坐标系（document 坐标，随页面滚动） */
  x: number
  y: number
  width: number
  height: number
  opacity: number
  blend: BlendMode
  visible: boolean
  locked: boolean
}

/** 落盘的场景：只存图片 id + 几何信息 */
export interface StoredLayer {
  id: string
  imageId: string
  name: string
  naturalWidth: number
  naturalHeight: number
  x: number
  y: number
  width: number
  height: number
  opacity: number
  blend: BlendMode
  visible: boolean
  locked: boolean
}

export interface StoredScene {
  updatedAt: number
  selectedId: string | null
  layers: StoredLayer[]
}

export interface StoredImage {
  id: string
  name: string
  dataUrl: string
  width: number
  height: number
  createdAt: number
  lastUsedAt: number
}

export interface Settings {
  /** 刷新页面后自动恢复本页设计稿 */
  autoRestore: boolean
  /** 新建图层默认透明度 */
  defaultOpacity: number
  /** 素材库保留数量 */
  libraryLimit: number
  /** 显示吸附参考线 */
  snapEnabled: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  autoRestore: true,
  defaultOpacity: 1,
  libraryLimit: 24,
  snapEnabled: true,
}

export interface TabState {
  active: boolean
  layerCount: number
  selectedId: string | null
  opacity: number
  blend: BlendMode
  frozen: boolean
}

export interface ImagePayload {
  name: string
  dataUrl: string
  width: number
  height: number
}

export type ContentMessage =
  | { type: 'TP_TOGGLE' }
  | { type: 'TP_CLOSE' }
  | { type: 'TP_GET_STATE' }
  | { type: 'TP_ADD_IMAGES'; images: ImagePayload[] }
  | { type: 'TP_SET_OPACITY'; value: number }
  | { type: 'TP_CLEAR' }
  | { type: 'TP_OPEN_HELP' }
  | { type: 'TP_DIFF' }
  | { type: 'TP_PING' }

export type BackgroundMessage =
  | { type: 'TP_STATE_CHANGED'; active: boolean; layerCount: number }
  | { type: 'TP_ENSURE_OVERLAY'; reason: 'restore' | 'command' }
  /** 内容脚本请求截取当前可见区域：captureVisibleTab 只能在扩展上下文调用 */
  | { type: 'TP_CAPTURE_VISIBLE' }

export type AnyMessage = ContentMessage | BackgroundMessage

export interface ApiResponse<T = unknown> {
  ok: boolean
  data?: T
  error?: string
}

export interface CapturePayload {
  /** PNG dataURL */
  dataUrl: string
}
