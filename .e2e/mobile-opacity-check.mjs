/**
 * 窄屏验收：透明度调节从工具栏滑块改为浮层（按钮 + 大滑块 + 预设）
 * 用法：node .e2e/mobile-opacity-check.mjs
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const EXT = 'ncfglfbdlbdpbdmmpollpedloanbdfnp'
const ROOT = process.cwd()
const SHOTS = `${ROOT}/.e2e/shots`
const SITE = 'http://127.0.0.1:8123/'
mkdirSync(SHOTS, { recursive: true })

const log = (...args) => console.log('·', ...args)
const problems = []
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const ctx = browser.contexts()[0]

// 跑刚构建的 dist
const admin = await ctx.newPage()
await admin.goto(`chrome-extension://${EXT}/popup.html`)
await admin.evaluate(() => chrome.runtime.reload()).catch(() => {})
await wait(2500)
await admin.close().catch(() => {})

const page = ctx.pages().find((p) => p.url().startsWith(SITE)) ?? (await ctx.newPage())
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console: ${message.text()}`)
})
await page.setViewportSize({ width: 390, height: 844 })
await page.goto(SITE)
await page.bringToFront()
await wait(800)

const cleaner = await ctx.newPage()
await cleaner.goto(`chrome-extension://${EXT}/popup.html`)
await cleaner.evaluate(() => chrome.storage.local.clear()).catch(() => {})
await cleaner.close().catch(() => {})
await page.goto(SITE)
await page.bringToFront()
await wait(1200)

const popup = await ctx.newPage()
await popup.setViewportSize({ width: 380, height: 720 })
await popup.goto(`chrome-extension://${EXT}/popup.html`)
await popup.waitForTimeout(600)
const toggle = popup.locator('button.toggle')
log('popup 开关:', (await toggle.innerText()).replace(/\s+/g, ' '))
if ((await toggle.innerText()).includes('开启')) {
  await toggle.click()
  await popup.waitForTimeout(700)
}
const [chooser] = await Promise.all([
  popup.waitForEvent('filechooser'),
  popup.locator('.uploader').click(),
])
await chooser.setFiles(`${ROOT}/.e2e/assets/design-mobile.png`)
await popup.waitForTimeout(1500)
await popup.close()

await page.bringToFront()
await wait(800)

const cdp = await ctx.newCDPSession(page)
await cdp.send('Overlay.disable').catch(() => {})

const snapshot = () =>
  page.evaluate(() => {
    const root = document.querySelector('tracing-paper-root')?.shadowRoot
    if (!root) return null
    const button = root.querySelector('.tp-btn--opacity')
    const slider = root.querySelector('.tp-opacity .tp-slider')
    const panelSlider = root.querySelector('.tp-opacity-panel .tp-slider')
    const layer = root.querySelector('.tp-layer')
    return {
      viewport: [innerWidth, innerHeight],
      toolbarRows: Math.round(
        (root.querySelector('.tp-toolbar')?.getBoundingClientRect().height ?? 0) / 34,
      ),
      opacityButton: button
        ? { text: button.textContent?.trim(), visible: button.offsetParent !== null }
        : null,
      desktopSlider: !!slider,
      panelSlider: panelSlider ? panelSlider.getBoundingClientRect().toJSON() : null,
      presets: [...root.querySelectorAll('.tp-opacity-presets .tp-chip')].map(
        (el) => el.textContent?.trim(),
      ),
      layerOpacity: layer ? layer.style.opacity : null,
      popoverBottom: root.querySelector('.tp-popover')
        ? Math.round(root.querySelector('.tp-popover').getBoundingClientRect().bottom)
        : null,
      toolbarTop: root.querySelector('.tp-toolbar')
        ? Math.round(root.querySelector('.tp-toolbar').getBoundingClientRect().top)
        : null,
    }
  })

log('初始:', JSON.stringify(await snapshot()))
await page.screenshot({ path: `${SHOTS}/20-mobile-toolbar.png` })

await page.locator('.tp-btn--opacity').click()
await wait(300)
log('打开浮层:', JSON.stringify(await snapshot()))
await page.screenshot({ path: `${SHOTS}/21-mobile-opacity-panel.png` })

// 预设 50%：按钮与图层同步
await page.locator('.tp-opacity-presets .tp-chip', { hasText: '50%' }).click()
await wait(250)
log('点 50%:', JSON.stringify(await snapshot()))

// 滑块拖到约 20%：用键盘把焦点交给滑块更稳
const slider = page.locator('.tp-opacity-panel .tp-slider')
await slider.click({ position: { x: 20, y: 13 } })
await wait(250)
log('滑块左段:', JSON.stringify(await snapshot()))
await page.screenshot({ path: `${SHOTS}/22-mobile-opacity-dragged.png` })

// 桌面宽度回落：浮层收起、滑块回到工具栏
await page.setViewportSize({ width: 1440, height: 900 })
await wait(400)
const wide = await page.evaluate(() => {
  const root = document.querySelector('tracing-paper-root')?.shadowRoot
  return {
    button: !!root?.querySelector('.tp-btn--opacity'),
    slider: !!root?.querySelector('.tp-opacity .tp-slider'),
    popover: !!root?.querySelector('.tp-popover'),
  }
})
log('宽屏回落:', JSON.stringify(wide))

console.log(problems.length ? `问题: ${problems.join(' | ')}` : '无控制台错误')
