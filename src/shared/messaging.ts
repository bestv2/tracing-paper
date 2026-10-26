import type { ApiResponse, ContentMessage } from './types'

/** 内容脚本返回的消息响应统一包一层，方便 popup 判断失败原因 */
export function ok<T>(data?: T): ApiResponse<T> {
  return { ok: true, data }
}

export function fail<T = never>(error: string): ApiResponse<T> {
  return { ok: false, error }
}

/** 向指定标签页的内容脚本发消息，页面没有内容脚本时抛出可读错误 */
export async function sendToTab<T = unknown>(
  tabId: number,
  message: ContentMessage,
): Promise<ApiResponse<T>> {
  try {
    const response = (await chrome.tabs.sendMessage(tabId, message)) as ApiResponse<T> | undefined
    return response ?? fail<T>('页面没有响应，请刷新后重试')
  } catch {
    return fail<T>('当前页面不支持该工具（chrome:// 等内部页面除外）')
  }
}

export async function sendToActiveTab<T = unknown>(message: ContentMessage): Promise<ApiResponse<T>> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return fail<T>('找不到当前标签页')
  return sendToTab<T>(tab.id, message)
}

export function notifyBackground(message: unknown): void {
  try {
    void chrome.runtime.sendMessage(message)
  } catch {
    /* service worker 未唤醒时忽略 */
  }
}
