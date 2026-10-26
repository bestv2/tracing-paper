import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import styles from './overlay.css?inline'
import { App } from './App'
import { useSceneStore } from './store'
import { importPayloads } from './lib/import'
import { attachPersistence, restoreScene } from './lib/persist'
import { runDiffFlow } from './lib/diff'
import { fail, notifyBackground, ok } from '@/shared/messaging'
import { t } from '@/shared/i18n'
import { initPrefs } from '@/shared/prefs'
import type { ApiResponse, ContentMessage, TabState } from '@/shared/types'

interface ActiveOverlay {
  mounted: boolean
  host: HTMLElement
  root: Root
  detach: () => Promise<void>
}

declare global {
  interface Window {
    __tpOverlay?: ActiveOverlay
    __tpState?: TabState
    /** 标记 overlay 模块已在本页执行过，避免二次注入产生两套 store / 两套消息监听 */
    __tpInjected?: boolean
    __tpResume?: () => Promise<void>
  }
}

/** bootstrap 与 overlay 共享同一 isolated world 的 window */
let lastPublishedCount = -1

function publishState(active: boolean, notifyBackgroundChange = true): void {
  const { layers, selectedId, frozen } = useSceneStore.getState()
  const selected = layers.find((layer) => layer.id === selectedId)
  window.__tpState = {
    active,
    layerCount: layers.length,
    selectedId,
    opacity: selected?.opacity ?? 1,
    blend: selected?.blend ?? 'normal',
    frozen,
  }
  if (notifyBackgroundChange || layers.length !== lastPublishedCount) {
    lastPublishedCount = layers.length
    notifyBackground({ type: 'TP_STATE_CHANGED', active, layerCount: layers.length })
  }
}

async function mount(): Promise<void> {
  if (window.__tpOverlay?.mounted) return

  // 扩展重载后上一代脚本留下的浮层还在页面上：先摘掉，免得两套工具栏叠着
  document.querySelectorAll('tracing-paper-root').forEach((stale) => stale.remove())

  const host = document.createElement('tracing-paper-root')
  host.style.setProperty('all', 'initial', 'important')
  host.style.setProperty('position', 'absolute', 'important')
  host.style.setProperty('inset', '0 auto auto 0', 'important')
  host.style.setProperty('width', '0', 'important')
  host.style.setProperty('height', '0', 'important')
  host.style.setProperty('z-index', 'auto', 'important')
  host.style.setProperty('pointer-events', 'none', 'important')
  host.style.setProperty('display', 'block', 'important')

  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = styles
  shadow.appendChild(style)

  const container = document.createElement('div')
  container.style.pointerEvents = 'none'
  shadow.appendChild(container)
  document.documentElement.appendChild(host)

  const root = createRoot(container)
  const detach = attachPersistence()

  window.__tpOverlay = { mounted: true, host, root, detach }

  await initPrefs()
  await restoreScene()
  root.render(createElement(App, { onClose: () => void unmount(), shadowRoot: shadow }))

  publishState(true)
}

async function unmount(): Promise<void> {
  const overlay = window.__tpOverlay
  if (!overlay?.mounted) return
  overlay.mounted = false
  await overlay.detach()
  overlay.root.unmount()
  overlay.host.remove()
  window.__tpOverlay = undefined
  window.__tpState = undefined
  notifyBackground({ type: 'TP_STATE_CHANGED', active: false, layerCount: 0 })
}

async function ensureMounted(): Promise<void> {
  if (!window.__tpOverlay?.mounted) await mount()
}

type Respond = (response: ApiResponse<unknown>) => void

function handleMessage(message: ContentMessage, respond: Respond): boolean {
  switch (message?.type) {
    case 'TP_PING':
      respond(ok(true))
      return true
    case 'TP_GET_STATE':
      respond(ok(window.__tpOverlay?.mounted ? (window.__tpState ?? null) : null))
      return true
    case 'TP_TOGGLE':
      void (async () => {
        if (!window.__tpOverlay?.mounted) {
          await mount()
          respond(ok({ active: true, visible: true }))
          return
        }
        // 已挂载时只切换工具栏的显隐：收起也能用同一个快捷键叫回来
        const store = useSceneStore.getState()
        const visible = !store.toolbarVisible
        if (store.toolbarVisible) {
          store.collapseToolbar()
          store.notify(t('toolbar.collapsed'))
        } else {
          store.setToolbarVisible(true)
        }
        respond(ok({ active: true, visible }))
      })()
      return true
    case 'TP_CLOSE':
      void unmount().then(() => respond(ok(true)))
      return true
    case 'TP_ADD_IMAGES':
      void (async () => {
        try {
          await ensureMounted()
          const count = await importPayloads(message.images)
          respond(ok({ count }))
        } catch (error) {
          respond(fail(error instanceof Error ? error.message : t('toast.insertFailed')))
        }
      })()
      return true
    case 'TP_SET_OPACITY':
      void (async () => {
        await ensureMounted()
        const store = useSceneStore.getState()
        const selected = store.selectedLayer()
        const value = Math.min(1, Math.max(0, message.value))
        if (selected) store.patchLayer(selected.id, { opacity: value }, true)
        else store.layers.forEach((layer) => store.patchLayer(layer.id, { opacity: value }))
        respond(ok({ opacity: value }))
      })()
      return true
    case 'TP_CLEAR':
      void (async () => {
        await ensureMounted()
        useSceneStore.getState().clear()
        respond(ok({ count: 0 }))
      })()
      return true
    case 'TP_OPEN_HELP':
      void (async () => {
        await ensureMounted()
        useSceneStore.getState().setToolbarVisible(true)
        useSceneStore.getState().setPanel('help')
        respond(ok(true))
      })()
      return true
    case 'TP_DIFF':
      void (async () => {
        await ensureMounted()
        const session = await runDiffFlow()
        respond(
          session
            ? ok({ findings: session.report.summary.findings, verdict: session.report.summary.verdict })
            : fail(t('diff.failed.detail')),
        )
      })()
      return true
    default:
      return false
  }
}

function registerMessages(): void {
  chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, sendResponse) =>
    handleMessage(message, sendResponse),
  )
}

/** 与 bootstrap、background 同步当前状态 */
function subscribeState(): void {
  useSceneStore.subscribe((state, previous) => {
    if (!window.__tpOverlay?.mounted) return
    if (
      state.layers === previous.layers &&
      state.selectedId === previous.selectedId &&
      state.frozen === previous.frozen
    ) {
      return
    }
    publishState(true, false)
  })
}

if (window.__tpInjected) {
  // 已经执行过：只把被关闭的界面重新挂起来，不重建模块
  void window.__tpResume?.()
} else {
  window.__tpInjected = true
  window.__tpResume = async () => {
    if (!window.__tpOverlay?.mounted) await mount()
  }
  window.__tpState = {
    active: false,
    layerCount: 0,
    selectedId: null,
    opacity: 1,
    blend: 'normal',
    frozen: false,
  }
  registerMessages()
  subscribeState()
  void mount()
}
