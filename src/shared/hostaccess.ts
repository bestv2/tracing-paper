/**
 * 站点访问授权。
 * Firefox 的 MV3 把 host_permissions 当作「可选授权」：用户没有明确允许前，
 * 内容脚本不会注入、也无法截图，所以首次点击「开启」时补一次授权请求。
 * Chrome / Edge 安装即授予，这里直接放行。
 */
const ALL_ORIGINS = { origins: ['<all_urls>'] }

const IS_FIREFOX = typeof navigator !== 'undefined' && /\bFirefox\//.test(navigator.userAgent)

export async function hasSiteAccess(): Promise<boolean> {
  try {
    return (await chrome.permissions.contains(ALL_ORIGINS)) ?? true
  } catch {
    /* 老版本浏览器没有 permissions API 时按已授权处理 */
    return true
  }
}

/**
 * 必须在点击回调里第一时间调用：Firefox 只在用户手势内接受授权请求。
 * 已授权时 request 立即返回 true，不会重复弹窗。
 */
export async function ensureSiteAccess(): Promise<boolean> {
  if (!IS_FIREFOX) return true
  try {
    if (await chrome.permissions.request(ALL_ORIGINS)) return true
  } catch {
    /* 用户拒绝授权时抛错，回退到只读检查 */
  }
  return hasSiteAccess()
}
