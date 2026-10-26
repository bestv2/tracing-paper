import { getScene, getSettings, sceneKey } from '@/shared/storage'
import { ok } from '@/shared/messaging'
import type { ContentMessage, TabState } from '@/shared/types'

/**
 * 常驻引导脚本：体积极小，默认不加载任何 UI 运行时。
 * 1. 响应 popup 的状态查询
 * 2. 页面刷新后，若该 URL 存有设计稿，通知 background 按需注入 overlay.js
 */
const globalWindow = window as Window & {
  __tpState?: TabState
  __tpBootstrapInstalled?: boolean
}

if (!globalWindow.__tpBootstrapInstalled) {
  globalWindow.__tpBootstrapInstalled = true

  chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, sendResponse) => {
    if (message?.type === 'TP_GET_STATE') {
      sendResponse(ok(globalWindow.__tpState ?? null))
      return true
    }
    if (message?.type === 'TP_PING') {
      sendResponse(ok(true))
      return true
    }
    return false
  })

  void (async () => {
    try {
      const settings = await getSettings()
      if (!settings.autoRestore) return
      const scene = await getScene(sceneKey(location.href))
      if (!scene?.layers.length) return
      chrome.runtime.sendMessage({ type: 'TP_ENSURE_OVERLAY', reason: 'restore' })
    } catch {
      /* 隐私模式等场景下读取失败时静默跳过 */
    }
  })()
}
