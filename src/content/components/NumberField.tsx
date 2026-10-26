import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useT } from '@/shared/i18n'

interface NumberFieldProps {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  precision?: number
  suffix?: string
  disabled?: boolean
  onChange: (value: number) => void
  onGestureStart?: () => void
  onGestureEnd?: () => void
}

const clampValue = (value: number, min?: number, max?: number) => {
  let next = value
  if (typeof min === 'number') next = Math.max(min, next)
  if (typeof max === 'number') next = Math.min(max, next)
  return next
}

/** 数字输入：可直接输入，也可以在标签上左右拖拽微调（设计工具手感） */
export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  precision = 0,
  suffix,
  disabled,
  onChange,
  onGestureStart,
  onGestureEnd,
}: NumberFieldProps) {
  const t = useT()
  const [draft, setDraft] = useState(String(Math.round(value * 10 ** precision) / 10 ** precision))
  const [focused, setFocused] = useState(false)
  const scrub = useRef<{ startX: number; startValue: number } | null>(null)

  useEffect(() => {
    if (!focused) setDraft(String(Math.round(value * 10 ** precision) / 10 ** precision))
  }, [value, focused, precision])

  const commit = (raw: string) => {
    const parsed = Number.parseFloat(raw)
    if (!Number.isFinite(parsed)) {
      setDraft(String(Math.round(value * 10 ** precision) / 10 ** precision))
      return
    }
    const next = clampValue(parsed, min, max)
    onChange(Number(next.toFixed(precision)))
  }

  const handleScrub = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (disabled) return
    event.preventDefault()
    onGestureStart?.()
    scrub.current = { startX: event.clientX, startValue: value }
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)

    const move = (moveEvent: PointerEvent) => {
      if (!scrub.current) return
      const delta = (moveEvent.clientX - scrub.current.startX) * step * (moveEvent.shiftKey ? 10 : 1)
      onChange(clampValue(Math.round(scrub.current.startValue + delta), min, max))
    }
    const up = () => {
      scrub.current = null
      target.releasePointerCapture?.(event.pointerId)
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      onGestureEnd?.()
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
  }

  return (
    <label className="tp-field" data-disabled={disabled ? 'true' : 'false'}>
      <span className="tp-field__label" onPointerDown={handleScrub} data-tip={t('field.scrub')}>
        {label}
      </span>
      <span className="tp-field__input">
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          disabled={disabled}
          onFocus={(event) => {
            setFocused(true)
            event.currentTarget.select()
          }}
          onChange={(event) => {
            setDraft(event.target.value)
            const parsed = Number.parseFloat(event.target.value)
            if (Number.isFinite(parsed)) onChange(clampValue(parsed, min, max))
          }}
          onBlur={() => {
            setFocused(false)
            commit(draft)
          }}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') {
              commit(draft)
              event.currentTarget.blur()
            }
            if (event.key === 'Escape') {
              setDraft(String(Math.round(value * 10 ** precision) / 10 ** precision))
              event.currentTarget.blur()
            }
          }}
        />
        {suffix ? <em>{suffix}</em> : null}
      </span>
    </label>
  )
}
