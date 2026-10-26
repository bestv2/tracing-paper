import type { BackgroundMessage, CapturePayload } from '@/shared/types'
import { fail, ok } from '@/shared/messaging'

const BADGE_COLOR = '#ffb570'

async function setBadge(tabId: number, active: boolean): Promise<void> {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR })
    await chrome.action.setBadgeText({ tabId, text: active ? 'ON' : '' })
  } catch {
    /* 标签页已关闭 */
  }
}

async function injectOverlay(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['overlay.js'] })
    return true
  } catch {
    return false
  }
}

/** 截取当前可见区域：只能由扩展上下文调用，内容脚本通过消息转交 */
async function captureVisible(windowId?: number): Promise<CapturePayload> {
  const target = windowId ?? (await chrome.windows.getCurrent()).id
  if (target === undefined) throw new Error('找不到当前窗口')
  const dataUrl = await chrome.tabs.captureVisibleTab(target, { format: 'png' })
  if (!dataUrl) throw new Error('截图返回空数据')
  return { dataUrl }
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR })
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') void setBadge(tabId, false)
})

chrome.runtime.onMessage.addListener(
  (
    message: BackgroundMessage & { type: string },
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => {
    if (message?.type === 'TP_STATE_CHANGED' && sender.tab?.id !== undefined) {
      void setBadge(sender.tab.id, message.active)
      return false
    }
    if (message?.type === 'TP_ENSURE_OVERLAY' && sender.tab?.id !== undefined) {
      void injectOverlay(sender.tab.id)
      return false
    }
    if (message?.type === 'TP_CAPTURE_VISIBLE') {
      captureVisible(sender.tab?.windowId)
        .then((payload) => sendResponse(ok(payload)))
        .catch((error: unknown) =>
          sendResponse(fail(error instanceof Error ? error.message : '截图失败')),
        )
      return true
    }
    return false
  },
)

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-inspector') return
  void (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return
    try {
      const state = (await chrome.tabs.sendMessage(tab.id, { type: 'TP_GET_STATE' })) as
        | { ok?: boolean; data?: { active?: boolean } }
        | undefined
      if (state?.data?.active) {
        // 已在本页：只切换工具栏收起 / 展开，不卸载界面
        await chrome.tabs.sendMessage(tab.id, { type: 'TP_TOGGLE' })
        return
      }
    } catch {
      /* 没有内容脚本时直接注入 */
    }
    await injectOverlay(tab.id)
  })()
})
