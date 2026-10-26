import { useEffect, useLayoutEffect, useRef, useState } from 'react'

interface TipState {
  text: string
  rect: DOMRect
}

interface TipPosition {
  left: number
  top: number
  below: boolean
}

const SHOW_DELAY = 220
const GAP = 8

/**
 * 全局悬停提示：任何带 data-tip 的元素都会在悬停后弹出说明。
 * 统一在这里定位，避免按钮贴边时说明被视口裁掉。
 */
export function TooltipLayer({ root }: { root: ShadowRoot | null }) {
  const [tip, setTip] = useState<TipState | null>(null)
  const [position, setPosition] = useState<TipPosition | null>(null)
  const nodeRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<number>()

  useEffect(() => {
    if (!root) return undefined

    const hide = () => {
      window.clearTimeout(timerRef.current)
      setTip(null)
    }

    const onOver = (event: Event) => {
      const node = (event.target as Element | null)?.closest?.('[data-tip]') as
        | HTMLElement
        | null
      const text = node?.dataset.tip
      if (!node || !text) return
      window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        setTip({ text, rect: node.getBoundingClientRect() })
      }, SHOW_DELAY)
    }

    const onOut = (event: Event) => {
      if (!(event.target as Element | null)?.closest?.('[data-tip]')) return
      hide()
    }

    root.addEventListener('pointerover', onOver)
    root.addEventListener('pointerout', onOut)
    root.addEventListener('pointerdown', hide, true)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      window.clearTimeout(timerRef.current)
      root.removeEventListener('pointerover', onOver)
      root.removeEventListener('pointerout', onOut)
      root.removeEventListener('pointerdown', hide, true)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [root])

  useLayoutEffect(() => {
    const node = nodeRef.current
    if (!tip || !node) return
    const width = node.offsetWidth
    const height = node.offsetHeight
    const center = tip.rect.left + tip.rect.width / 2
    const left = Math.min(Math.max(center, width / 2 + GAP), window.innerWidth - width / 2 - GAP)
    const above = tip.rect.top - height - GAP
    const below = above < GAP
    setPosition({ left, top: below ? tip.rect.bottom + GAP : above, below })
  }, [tip])

  if (!tip) return null

  return (
    <div
      ref={nodeRef}
      className="tp-tooltip"
      data-below={position?.below ?? false}
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        visibility: position ? 'visible' : 'hidden',
      }}
      role="tooltip"
    >
      {tip.text}
    </div>
  )
}
