/**
 * 多浏览器 manifest 生成：以 public/manifest.json 为唯一真源，
 * 按目标浏览器打补丁，避免维护三份容易走样的副本。
 */

/**
 * Firefox 扩展 ID：AMO 要求 MV3 必须自带 ID，且首次发布后不可更改。
 * 如需换成自己的域名 / 邮箱，请在第一次提交前替换。
 */
export const GECKO_ID = 'tracing-paper@wangduo.dev'

const BROWSERS = ['chrome', 'edge', 'firefox']

export function buildManifest(browser, base, pkg) {
  if (!BROWSERS.includes(browser)) throw new Error(`未知浏览器：${browser}`)

  const manifest = structuredClone(base)
  manifest.version = pkg.version

  if (browser === 'firefox') {
    // Firefox 不支持 minimum_chrome_version
    delete manifest.minimum_chrome_version
    // Firefox MV3 只有事件页，没有 service worker；background.js 需按 classic 脚本打包（IIFE）
    manifest.background = { scripts: ['background.js'] }
    manifest.browser_specific_settings = {
      gecko: {
        id: GECKO_ID,
        strict_min_version: '115.0',
        // AMO 自 2025-11-03 起强制声明数据收集项：本扩展不收集、不上传任何数据
        data_collection_permissions: { required: ['none'] },
      },
    }
  }

  // Edge 与 Chrome 同为 Chromium MV3，manifest 完全一致，仅打包名不同
  return manifest
}
