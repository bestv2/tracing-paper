import { useEffect, useRef } from 'react'
import { isEditableTarget } from '@/shared/utils'
import { t } from '@/shared/i18n'
import { useSceneStore } from '../store'
import { applyFit } from '../lib/actions'
import { runAutoFitFlow } from '../lib/autofit'
import { runDiffFlow } from '../lib/diff'

/** 全局快捷键：输入框内自动让行，其余按键在捕获阶段先处理 */
export function useShortcuts(shadowRoot: ShadowRoot | null) {
  const digit = useRef<{ buffer: string; timer?: number }>({ buffer: '' })

  useEffect(() => {
    const isTyping = () => {
      const active =
        (shadowRoot?.activeElement as HTMLElement | null) ??
        (document.activeElement as HTMLElement | null)
      return isEditableTarget(active)
    }

    const setOpacity = (value: number) => {
      const store = useSceneStore.getState()
      const selected = store.selectedLayer()
      if (!selected) return
      store.patchLayer(selected.id, { opacity: Math.min(1, Math.max(0, value)) })
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const store = useSceneStore.getState()
      // 大图查看时键盘交给看图组件：方向键切图，Esc 关闭
      if (store.lightbox) return
      const selected = store.selectedLayer()
      const mod = event.metaKey || event.ctrlKey

      if (event.key === 'Escape') {
        if (store.panel) {
          store.setPanel(null)
          event.preventDefault()
        } else if (store.selectedId) {
          store.select(null)
        }
        return
      }

      if (isTyping()) return

      if (mod) {
        const key = event.key.toLowerCase()
        if (key === 'z') {
          event.preventDefault()
          if (event.shiftKey) store.redo()
          else store.undo()
          return
        }
        if (key === 'y') {
          event.preventDefault()
          store.redo()
          return
        }
        if (key === 'd' && selected) {
          event.preventDefault()
          store.duplicateLayer(selected.id)
          return
        }
        return
      }

      if (event.altKey && selected) {
        const fitMap: Record<string, Parameters<typeof applyFit>[0]> = {
          '0': 'reset',
          '1': 'natural',
          '2': 'double',
          '3': 'half',
          '4': 'window',
          '5': 'center',
        }
        const kind = fitMap[event.key]
        if (kind) {
          event.preventDefault()
          applyFit(kind, selected)
          return
        }
      }

      if (event.key === '?' || (event.key === '/' && event.shiftKey)) {
        event.preventDefault()
        store.setPanel(store.panel === 'help' ? null : 'help')
        return
      }

      if (!selected && event.key !== 'f') return

      switch (event.key) {
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          if (!selected) return
          event.preventDefault()
          const step = event.shiftKey ? 10 : 1
          const delta =
            event.key === 'ArrowLeft'
              ? { x: -step }
              : event.key === 'ArrowRight'
                ? { x: step }
                : event.key === 'ArrowUp'
                  ? { y: -step }
                  : { y: step }
          store.patchLayer(selected.id, {
            x: selected.x + (delta.x ?? 0),
            y: selected.y + (delta.y ?? 0),
          })
          return
        }
        case '[':
          event.preventDefault()
          if (selected) setOpacity(Math.round((selected.opacity - 0.05) * 100) / 100)
          return
        case ']':
          event.preventDefault()
          if (selected) setOpacity(Math.round((selected.opacity + 0.05) * 100) / 100)
          return
        case 'Delete':
        case 'Backspace':
          if (!selected) return
          event.preventDefault()
          store.removeLayer(selected.id)
          return
        default:
          break
      }

      if (event.shiftKey && (event.key === 'F' || event.key === 'f')) {
        event.preventDefault()
        // ⇧F 收起 / 展开：收起只留迷你入口，再按一次回来
        if (store.toolbarVisible) {
          store.collapseToolbar()
          store.notify(t('toolbar.collapsed'))
        } else {
          store.setToolbarVisible(true)
        }
        return
      }

      switch (event.key.toLowerCase()) {
        case 'h':
          if (!selected) return
          event.preventDefault()
          store.patchLayer(selected.id, { visible: !selected.visible }, true)
          return
        case 'l':
          if (!selected) return
          event.preventDefault()
          store.patchLayer(selected.id, { locked: !selected.locked })
          return
        case 'f': {
          event.preventDefault()
          const next = !store.frozen
          store.setFrozen(next)
          store.notify(next ? t('toast.frozen') : t('toast.thawed'))
          return
        }
        case 's': {
          event.preventDefault()
          const next = !store.snapEnabled
          store.setSnapEnabled(next)
          store.notify(next ? t('toast.snapOn') : t('toast.snapOff'))
          return
        }
        case 'd': {
          event.preventDefault()
          void runDiffFlow({ layerId: selected?.id })
          return
        }
        case 'a': {
          event.preventDefault()
          void runAutoFitFlow({ layerId: selected?.id })
          return
        }
        default:
          break
      }

      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault()
        const state = digit.current
        if (state.timer) window.clearTimeout(state.timer)
        state.buffer += event.key
        if (state.buffer.length >= 2) {
          const percent = Number.parseInt(state.buffer.slice(-2), 10)
          state.buffer = ''
          setOpacity(percent === 0 ? 1 : percent / 100)
          return
        }
        state.timer = window.setTimeout(() => {
          const single = state.buffer.slice(-1)
          state.buffer = ''
          if (!single) return
          const percent = Number.parseInt(single, 10) * 10
          setOpacity(percent === 0 ? 1 : percent / 100)
        }, 900)
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      if (digit.current.timer) window.clearTimeout(digit.current.timer)
    }
  }, [shadowRoot])
}
