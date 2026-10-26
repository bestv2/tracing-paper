/**
 * 语义层：设计元数据（Figma 节点）与页面 DOM 逐项对齐。
 * 输入都是纯数据，浏览器与 CLI 共用；没有元数据时整层自动跳过。
 */

import type { Rect, SemanticFinding, SemanticReport, Severity } from './types'
import { deltaEHex, parseHex, rgbToHex } from './color'
import { unifiedDiff } from './textdiff'

export interface DesignNode {
  id?: string
  name: string
  type: string
  box: Rect
  /** 背景色 */
  fill?: string
  /** 文字色 */
  color?: string
  fontSize?: number
  fontWeight?: number
  radius?: number
  padding?: number
  text?: string
}

export interface LayoutElement {
  selector: string
  tag: string
  rect: Rect
  text?: string
  style: {
    color?: string
    backgroundColor?: string
    fontSize?: number
    fontWeight?: number
    borderRadius?: number
    paddingTop?: number
  }
}

export interface SemanticOptions {
  /** 几何匹配阈值（IoU） */
  iou?: number
  /** 位置容差（px） */
  tolerance?: number
  /** 颜色阈值（ΔE2000） */
  deltaE?: number
}

const DEFAULTS: Required<SemanticOptions> = { iou: 0.5, tolerance: 1, deltaE: 2.3 }

interface FigmaColor {
  r: number
  g: number
  b: number
  a?: number
}

interface FigmaPaint {
  type?: string
  visible?: boolean
  opacity?: number
  color?: FigmaColor
}

interface FigmaNode {
  id?: string
  name?: string
  type?: string
  visible?: boolean
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number }
  fills?: FigmaPaint[]
  strokes?: FigmaPaint[]
  style?: { fontSize?: number; fontWeight?: number; fills?: FigmaPaint[] }
  characters?: string
  cornerRadius?: number
  paddingTop?: number
  children?: FigmaNode[]
}

const KEEP_TYPES = new Set([
  'FRAME',
  'GROUP',
  'COMPONENT',
  'COMPONENT_SET',
  'INSTANCE',
  'RECTANGLE',
  'TEXT',
  'ELLIPSE',
  'VECTOR',
])

function solidColor(paints: FigmaPaint[] | undefined): string | undefined {
  if (!paints?.length) return undefined
  for (let i = paints.length - 1; i >= 0; i -= 1) {
    const paint = paints[i]
    if (paint.visible === false) continue
    if (paint.type && paint.type !== 'SOLID') continue
    if (!paint.color) continue
    return rgbToHex(paint.color.r * 255, paint.color.g * 255, paint.color.b * 255)
  }
  return undefined
}

/** 把 Figma REST / 插件导出的各种形状统一拍平 */
export function parseFigmaDocument(input: unknown): DesignNode[] {
  const roots: FigmaNode[] = []

  const collect = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (Array.isArray(value)) {
      value.forEach(collect)
      return
    }
    if (record.document && typeof record.document === 'object') {
      collect(record.document)
      return
    }
    if (record.nodes && typeof record.nodes === 'object') {
      Object.values(record.nodes as Record<string, unknown>).forEach((entry) => {
        if (entry && typeof entry === 'object' && 'document' in (entry as Record<string, unknown>)) {
          collect((entry as Record<string, unknown>).document)
        } else {
          collect(entry)
        }
      })
      return
    }
    if (typeof record.type === 'string' || Array.isArray(record.children)) {
      roots.push(record as unknown as FigmaNode)
    }
  }
  collect(input)

  const nodes: DesignNode[] = []
  const walk = (node: FigmaNode, offset: { x: number; y: number }): void => {
    const box = node.absoluteBoundingBox
    const rect: Rect = box
      ? { x: box.x, y: box.y, w: box.width, h: box.height }
      : { x: offset.x, y: offset.y, w: 0, h: 0 }

    if (node.visible !== false && KEEP_TYPES.has(node.type ?? '') && rect.w >= 4 && rect.h >= 4) {
      nodes.push({
        id: node.id,
        name: node.name ?? node.type ?? 'node',
        type: node.type ?? 'FRAME',
        box: rect,
        fill: solidColor(node.fills),
        color: solidColor(node.style?.fills),
        fontSize: node.style?.fontSize,
        fontWeight: node.style?.fontWeight,
        radius: node.cornerRadius,
        padding: node.paddingTop,
        text: node.characters,
      })
    }

    const childOffset = { x: rect.x, y: rect.y }
    ;(node.children ?? []).forEach((child) => walk(child, childOffset))
  }
  roots.forEach((root) => walk(root, { x: 0, y: 0 }))
  return nodes
}

function num(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

/** 布局导出归一化：兼容 rect 写 w/h 或 width/height，样式值写数字或 "44px" */
export function parseLayoutElements(input: unknown): LayoutElement[] {
  const record = input as Record<string, unknown> | null
  const list = Array.isArray(input) ? input : record?.elements
  if (!Array.isArray(list)) throw new Error('布局导出需要 elements 数组')

  return list.map((item, index) => {
    const entry = (item ?? {}) as Record<string, unknown>
    const rect = (entry.rect ?? entry.boundingBox ?? entry) as Record<string, unknown>
    const style = (entry.style ?? entry.computed ?? {}) as Record<string, unknown>
    return {
      selector: typeof entry.selector === 'string' ? entry.selector : `element#${index}`,
      tag: typeof entry.tag === 'string' ? entry.tag : 'div',
      rect: {
        x: num(rect.x ?? rect.left),
        y: num(rect.y ?? rect.top),
        w: num(rect.w ?? rect.width),
        h: num(rect.h ?? rect.height),
      },
      ...(typeof entry.text === 'string' && entry.text ? { text: entry.text } : {}),
      style: {
        ...(typeof style.color === 'string' ? { color: style.color } : {}),
        ...(typeof style.backgroundColor === 'string' ? { backgroundColor: style.backgroundColor } : {}),
        ...(Number.isFinite(num(style.fontSize, Number.NaN)) ? { fontSize: num(style.fontSize) } : {}),
        ...(Number.isFinite(num(style.fontWeight, Number.NaN)) ? { fontWeight: num(style.fontWeight) } : {}),
        ...(Number.isFinite(num(style.borderRadius, Number.NaN)) ? { borderRadius: num(style.borderRadius) } : {}),
        ...(Number.isFinite(num(style.paddingTop, Number.NaN)) ? { paddingTop: num(style.paddingTop) } : {}),
      },
    }
  })
}

function iou(a: Rect, b: Rect): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w)
  const y2 = Math.min(a.y + a.h, b.y + b.h)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = a.w * a.h + b.w * b.h - inter
  return union <= 0 ? 0 : inter / union
}

function severityOf(diffs: SemanticFinding['diffs']): Severity {
  let worst: Severity = 'info'
  diffs.forEach((diff) => {
    const magnitude = Math.abs(diff.delta ?? 0)
    const level: Severity =
      diff.property === 'background-color' || diff.property === 'color'
        ? magnitude > 6
          ? 'major'
          : 'minor'
        : magnitude > 8
          ? 'major'
          : magnitude > 2
            ? 'minor'
            : 'info'
    const rank = { info: 0, minor: 1, major: 2, blocker: 3 }
    if (rank[level] > rank[worst]) worst = level
  })
  return worst
}

function geometryDiff(property: string, expected: number, actual: number, tolerance: number) {
  const delta = Number((actual - expected).toFixed(2))
  if (Math.abs(delta) <= tolerance) return null
  return { property, expected: `${Math.round(expected)}px`, actual: `${Math.round(actual)}px`, delta, unit: 'px' }
}

function colorDiff(property: 'background-color' | 'color', expected?: string, actual?: string, threshold = 2.3) {
  if (!expected || !actual) return null
  const [r2, g2, b2] = parseHex(actual)
  // 页面常见的 rgba(0,0,0,0) 背景会被序列化成 #000000，这里直接跳过纯透明
  if (r2 + g2 + b2 === 0 && expected !== '#000000') return null
  const dE = deltaEHex(expected, actual)
  if (dE <= threshold) return null
  return { property, expected, actual, delta: Number(dE.toFixed(2)), unit: 'ΔE' }
}

function numberDiff(property: string, expected?: number, actual?: number, tolerance = 0.5) {
  if (expected === undefined || actual === undefined) return null
  const delta = Number((actual - expected).toFixed(2))
  if (Math.abs(delta) <= tolerance) return null
  return { property, expected: `${expected}`, actual: `${actual}`, delta, unit: 'px' }
}

/** 规范化的布局行：位置锚定，字段顺序固定，便于 unified diff 稳定 */
function layoutLine(prefix: string, box: Rect, fields: Record<string, string | number | undefined>): string {
  const parts = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${value}`)
  return `${prefix} @${box.x},${box.y} ${box.w}×${box.h} ${parts.join(' ')}`
}

export function compareSemantic(
  nodes: DesignNode[],
  elements: LayoutElement[],
  options: SemanticOptions = {},
): SemanticReport {
  const config = { ...DEFAULTS }
  if (options.iou !== undefined) config.iou = options.iou
  if (options.tolerance !== undefined) config.tolerance = options.tolerance
  if (options.deltaE !== undefined) config.deltaE = options.deltaE
  const pairs: { node: DesignNode; element: LayoutElement; score: number }[] = []

  nodes.forEach((node) => {
    elements.forEach((element) => {
      const score = iou(node.box, element.rect)
      if (score >= config.iou) pairs.push({ node, element, score })
    })
  })
  pairs.sort((left, right) => right.score - left.score)

  const usedNodes = new Set<DesignNode>()
  const usedElements = new Set<LayoutElement>()
  const findings: SemanticFinding[] = []
  const expectedLines: string[] = ['# vi.layout/1']
  const actualLines: string[] = ['# vi.layout/1']

  const matchedElements = new Set<LayoutElement>()
  const matchedNodes = new Set<DesignNode>()

  pairs.forEach(({ node, element, score }) => {
    if (usedNodes.has(node) || usedElements.has(element)) return
    usedNodes.add(node)
    usedElements.add(element)
    matchedNodes.add(node)
    matchedElements.add(element)

    const diffs = [
      geometryDiff('x', node.box.x, element.rect.x, config.tolerance),
      geometryDiff('y', node.box.y, element.rect.y, config.tolerance),
      geometryDiff('width', node.box.w, element.rect.w, config.tolerance),
      geometryDiff('height', node.box.h, element.rect.h, config.tolerance),
      colorDiff('background-color', node.fill, element.style.backgroundColor, config.deltaE),
      colorDiff('color', node.color, element.style.color, config.deltaE),
      numberDiff('font-size', node.fontSize, element.style.fontSize),
      numberDiff('font-weight', node.fontWeight, element.style.fontWeight, 50),
      numberDiff('border-radius', node.radius, element.style.borderRadius),
      numberDiff('padding-top', node.padding, element.style.paddingTop),
    ].filter((diff): diff is NonNullable<typeof diff> => Boolean(diff))

    if (diffs.length) {
      findings.push({
        id: `s-${findings.length + 1}`,
        severity: severityOf(diffs),
        node: { id: node.id, name: node.name, type: node.type },
        element: { selector: element.selector, tag: element.tag, rect: element.rect, text: element.text },
        match: Number(score.toFixed(3)),
        diffs,
      })
    }

    expectedLines.push(
      layoutLine('·', node.box, {
        bg: node.fill ?? '-',
        fg: node.color ?? '-',
        fs: node.fontSize ?? '-',
        fw: node.fontWeight ?? '-',
        r: node.radius ?? '-',
        p: node.padding ?? '-',
      }),
    )
    actualLines.push(
      layoutLine('·', element.rect, {
        bg: element.style.backgroundColor ?? '-',
        fg: element.style.color ?? '-',
        fs: element.style.fontSize ?? '-',
        fw: element.style.fontWeight ?? '-',
        r: element.style.borderRadius ?? '-',
        p: element.style.paddingTop ?? '-',
      }),
    )
  })

  const unmatchedNodes = nodes.filter((node) => !matchedNodes.has(node))
  const unmatchedElements = elements.filter((element) => !matchedElements.has(element))
  unmatchedNodes.forEach((node) => {
    expectedLines.push(layoutLine('-', node.box, { name: node.name, type: node.type }))
  })
  unmatchedElements.forEach((element) => {
    actualLines.push(layoutLine('+', element.rect, { selector: element.selector, tag: element.tag }))
  })

  return {
    source: 'figma',
    nodes: nodes.length,
    matched: matchedNodes.size,
    unmatched: unmatchedNodes.length,
    findings,
    layout: {
      expected: expectedLines,
      actual: actualLines,
      diff: unifiedDiff(expectedLines, actualLines, { from: 'a/design.layout', to: 'b/page.layout' }),
    },
  }
}
