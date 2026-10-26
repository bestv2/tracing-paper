/** 视觉差异报告的数据契约：扩展内与 CLI 共用，字段改动必须升 schemaVersion */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** 预乘前的前端栅格：RGBA8，行优先 */
export interface Raster {
  width: number
  height: number
  data: Uint8ClampedArray
  /** 是否含半透明像素（决定是否先合成到页面截图上） */
  hasAlpha: boolean
}

export type FindingKind = 'shift' | 'color' | 'size' | 'missing' | 'extra' | 'content'
export type Severity = 'info' | 'minor' | 'major' | 'blocker'

export interface DiffPolicy {
  /** 网格边长（CSS px） */
  tile: number
  /** 判定有差异的平均色差阈值（ΔE2000，JND ≈ 2.3） */
  deltaE: number
  /** 判定有差异的结构相似度下限 */
  ssim: number
  /** 单像素级差异阈值（ΔE2000） */
  pixel: number
  /** 小于该面积的区域被忽略（px²） */
  minArea: number
  /** 位移搜索半径（px） */
  shiftSearch: number
  /** 最多输出的差异条数 */
  maxFindings: number
}

export const DEFAULT_POLICY: DiffPolicy = {
  tile: 16,
  deltaE: 2.3,
  ssim: 0.98,
  pixel: 6,
  minArea: 96,
  shiftSearch: 4,
  maxFindings: 120,
}

export interface MaskRect extends Rect {
  reason?: string
}

export interface InputMeta {
  name?: string
  url?: string
  sha256?: string
  width: number
  height: number
  dpr?: number
  scrollX?: number
  scrollY?: number
}

export interface Alignment {
  /** 设计稿渲染宽度 / 原始宽度，≠1 时结论仅作参考 */
  scale: number
  dx: number
  dy: number
  method: 'layer-rect' | 'given' | 'auto'
  cropped?: Rect
}

export interface FindingMetrics {
  /** 区域平均色差 */
  deltaE: number
  /** 区域结构相似度 */
  ssim: number
  /** 像素级超阈值比例 */
  pixelRatio: number
  /** 边缘能量差（结构变化量） */
  edgeDelta: number
  shift?: { dx: number; dy: number }
}

export interface ElementRef {
  selector: string
  tag: string
  rect?: Rect
  computed?: Record<string, string>
  text?: string
}

export interface ColorSample {
  /** #rrggbb */
  hex: string
  /** 平均色差（仅 actual 侧有意义） */
  deltaE?: number
  uniform?: boolean
}

export interface Suggestion {
  property: string
  from: string
  to: string
  confidence: 'low' | 'medium' | 'high'
}

export interface Finding {
  id: string
  kind: FindingKind
  severity: Severity
  /** 设计稿坐标系（即 expected 图像素） */
  box: Rect
  metrics: FindingMetrics
  expected: ColorSample
  actual: ColorSample
  element?: ElementRef
  design?: { id?: string; name?: string; type?: string }
  suggestion?: Suggestion
  note?: string
}

/** 语义层（Figma 元数据 vs 页面 DOM）结论 */
export interface SemanticFinding {
  id: string
  severity: Severity
  node: { id?: string; name: string; type: string }
  element?: ElementRef
  /** IoU，低于 0.5 表示结构对不上 */
  match: number
  diffs: {
    property: string
    expected: string
    actual: string
    /** 数值型属性的差（actual - expected） */
    delta?: number
    unit?: string
  }[]
}

export interface SemanticReport {
  source: 'figma'
  nodes: number
  matched: number
  unmatched: number
  findings: SemanticFinding[]
  /** 两侧的规范化文本行，供 unified diff 使用 */
  layout: { expected: string[]; actual: string[]; diff: string }
}

export interface CropArtifact {
  id: string
  expected: string
  actual: string
  diff: string
}

export interface DiffArtifacts {
  diffImage?: string
  report?: string
  sarif?: string
  markdown?: string
  crops?: CropArtifact[]
}

export interface DiffSummary {
  verdict: 'clean' | 'changed'
  findings: number
  changedRatio: number
  maxDeltaE: number
  tiles: number
  changedTiles: number
  byKind: Partial<Record<FindingKind, number>>
  bySeverity: Partial<Record<Severity, number>>
}

/** 基准点位自检：只有对齐到页面真实内容，尺寸与位置的差异才有意义 */
export interface Baseline {
  /** 设计稿与页面内容的匹配度（ZNCC），1 表示完全一致 */
  score: number
  /** 峰值裕度：匹配点比其它位置高多少，越小越说明“高分是碰运气” */
  margin: number
  verdict: 'ok' | 'drift' | 'weak'
  /** 页面内容建议的落点（文档坐标） */
  suggested: { x: number; y: number; width: number; height: number }
  /** 当前图层落点相对建议落点的偏差（CSS px） */
  drift: { dx: number; dy: number }
  /** 页面实际倍率 / 图层当前倍率，1 表示尺寸对得上 */
  scaleRatio: number
}

export interface DiffReport {
  schemaVersion: 'tracing.diff/2'
  generatedAt: string
  tool: { name: string; version: string; mode: 'cli' | 'extension' }
  inputs: { expected: InputMeta; actual: InputMeta; alignment: Alignment }
  policy: DiffPolicy & { masks: MaskRect[] }
  summary: DiffSummary
  findings: Finding[]
  artifacts: DiffArtifacts
  semantic?: SemanticReport
  /** 仅扩展侧：比对前的基准点位自检 */
  baseline?: Baseline
  notes: string[]
}

/** 比对结果（报告 + 可视化产物） */
export interface DiffResult {
  report: DiffReport
  /** 叠加了差异高亮的图（设计稿坐标系） */
  diffImage?: Raster
  /** 各区域的期望/实际/差异切片 */
  crops: { id: string; box: Rect; expected: Raster; actual: Raster; diff: Raster }[]
  /** 每块被判定为差异的网格，供 UI 画热区 */
  changedTiles: Rect[]
}
