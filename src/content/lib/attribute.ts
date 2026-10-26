/**
 * DOM 归因：把差异框落回页面元素，让报告里的「元素」列不再是空的。
 * 结论只依赖 getBoundingClientRect / getComputedStyle，不需要额外权限。
 */

import type { ElementRef, Rect } from '@/shared/diff'
import { rgbToHex } from '@/shared/diff'

const OVERLAY_TAG = 'tracing-paper-root'
const TEXT_LIMIT = 40
const INSET = 3

function isOverlay(node: Element): boolean {
  return node.closest(OVERLAY_TAG) !== null
}

/** 过滤掉构建工具生成的哈希类名，选择器要能被人和智能体读懂 */
function stableClass(name: string): boolean {
  if (!name || name.length > 24) return false
  if (!/^[a-zA-Z_][\w-]*$/.test(name)) return false
  if (/^css-/.test(name) || /^jsx-/.test(name)) return false
  if (/[0-9a-f]{6,}/i.test(name)) return false
  return true
}

export function selectorOf(element: Element): string {
  const id = element.id
  if (id && !/\d{4,}/.test(id) && /^[a-zA-Z_][\w-]*$/.test(id)) return `#${id}`
  const tag = element.tagName.toLowerCase()
  const classes = Array.from(element.classList).filter(stableClass).slice(0, 2)
  if (classes.length) return `${tag}.${classes.join('.')}`
  const parent = element.parentElement
  if (!parent) return tag
  const index = Array.from(parent.children).indexOf(element) + 1
  return `${tag}:nth-child(${index})`
}

/** 计算色统一成 hex，和设计稿侧的颜色字段同构 */
function toHex(value: string): string {
  const match = /^rgba?\(([^)]+)\)$/.exec(value.trim())
  if (!match) return value
  const parts = match[1]
    .split(/[,/\s]+/)
    .filter(Boolean)
    .map((item) => Number(item))
  const [r, g, b, a] = parts
  if (![r, g, b].every(Number.isFinite)) return value
  if (a !== undefined && a === 0) return 'transparent'
  return rgbToHex(r, g, b)
}

export function describeElement(element: Element): ElementRef {
  const box = element.getBoundingClientRect()
  const style = window.getComputedStyle(element)
  const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, TEXT_LIMIT)
  return {
    selector: selectorOf(element),
    tag: element.tagName.toLowerCase(),
    rect: {
      x: Math.round(box.x),
      y: Math.round(box.y),
      w: Math.round(box.width),
      h: Math.round(box.height),
    },
    computed: {
      color: toHex(style.color),
      backgroundColor: toHex(style.backgroundColor),
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      borderRadius: style.borderRadius,
      padding: style.padding,
      display: style.display,
    },
    ...(text ? { text } : {}),
  }
}

/** 跳过自家浮层，取最上层真实页面元素 */
function elementAt(x: number, y: number): Element | null {
  const stack = document.elementsFromPoint(x, y)
  for (const node of stack) {
    if (isOverlay(node)) continue
    if (!node.getBoundingClientRect().width) continue
    return node
  }
  return document.elementFromPoint(x, y)
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

function probePoints(rect: Rect): [number, number][] {
  const { x, y, w, h } = rect
  const cx = x + w / 2
  const cy = y + h / 2
  const points: [number, number][] = [[cx, cy]]
  if (w > INSET * 2 && h > INSET * 2) {
    points.push(
      [x + INSET, y + INSET],
      [x + w - INSET, y + INSET],
      [x + INSET, y + h - INSET],
      [x + w - INSET, y + h - INSET],
    )
  }
  if (w > 24) points.push([x + w * 0.25, cy], [x + w * 0.75, cy])
  if (h > 24) points.push([cx, y + h * 0.25], [cx, y + h * 0.75])

  const maxX = window.innerWidth - 1
  const maxY = window.innerHeight - 1
  return points.map(([px, py]) => [
    Math.min(maxX, Math.max(0, px)),
    Math.min(maxY, Math.max(0, py)),
  ])
}

/**
 * 在差异框内多点采样，挑与框最贴合的元素：
 * 中心点常常落在文字或空白上，靠四角/边缘补票更稳。
 */
export function attributeRect(rect: Rect): ElementRef | undefined {
  let best: ElementRef | undefined
  let bestScore = -1
  let bestArea = Number.POSITIVE_INFINITY

  probePoints(rect).forEach(([x, y]) => {
    const node = elementAt(x, y)
    if (!node || isOverlay(node)) return
    const box = node.getBoundingClientRect()
    const candidate = { x: box.x, y: box.y, w: box.width, h: box.height }
    const area = candidate.w * candidate.h
    const score = iou(rect, candidate)
    if (score > bestScore + 1e-6 || (Math.abs(score - bestScore) <= 1e-6 && area < bestArea)) {
      best = describeElement(node)
      bestScore = score
      bestArea = area
    }
  })

  return best
}
