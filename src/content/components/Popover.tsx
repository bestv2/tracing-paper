import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

interface PopoverProps {
  anchorRef: RefObject<HTMLElement>
  onClose: () => void
  children: ReactNode
  width?: number
}

/** 悬浮面板：自动贴合工具栏按钮并避免超出视口 */
export function Popover({ anchorRef, onClose, children, width = 260 }: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [left, setLeft] = useState<number | null>(null)

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const panelWidth = panelRef.current?.offsetWidth ?? width
    const half = panelWidth / 2
    const center = rect.left + rect.width / 2
    setLeft(Math.min(Math.max(center, half + 10), window.innerWidth - half - 10))
  }, [anchorRef, width])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const path = event.composedPath()
      if (panelRef.current && path.includes(panelRef.current)) return
      if (anchorRef.current && path.includes(anchorRef.current)) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [anchorRef, onClose])

  return (
    <div
      ref={panelRef}
      className="tp-popover"
      style={{ left: left ?? '50%', transform: 'translateX(-50%)', width }}
      role="dialog"
    >
      {children}
    </div>
  )
}
