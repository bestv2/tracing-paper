import { chromium } from 'playwright'
import fs from 'node:fs'

const EXT = 'ncfglfbdlbdpbdmmpollpedloanbdfnp'
const ROOT = process.cwd()
const SHOTS = `${ROOT}/.e2e/shots`
const SITE = 'http://127.0.0.1:8123/'
fs.mkdirSync(SHOTS, { recursive: true })

const log = (...args) => console.log('·', ...args)
const problems = []
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const ctx = browser.contexts()[0]

const cleaner = await ctx.newPage()
await cleaner.goto(`chrome-extension://${EXT}/popup.html`)
await cleaner.evaluate(() => chrome.storage.local.clear())
await cleaner.close()

const page = ctx.pages().find((p) => p.url().startsWith(SITE)) ?? (await ctx.newPage())
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`))
await page.goto(SITE)
await page.setViewportSize({ width: 1440, height: 900 })
await page.bringToFront()
await page.waitForTimeout(500)

const boxes = () =>
  page.evaluate(() =>
    [...(document.querySelector('tracing-paper-root')?.shadowRoot?.querySelectorAll('.tp-layer') ?? [])].map(
      (el) => {
        const b = el.getBoundingClientRect()
        return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
      },
    ),
  )

/* 1. popup：开启 + 上传桌面设计稿 */
const popup = await ctx.newPage()
await popup.setViewportSize({ width: 360, height: 600 })
await popup.goto(`chrome-extension://${EXT}/popup.html`)
await popup.waitForTimeout(500)
await popup.getByRole('button', { name: '开启' }).click()
await popup.waitForTimeout(400)
const [chooser] = await Promise.all([popup.waitForEvent('filechooser'), popup.locator('.uploader').click()])
await chooser.setFiles(`${ROOT}/.e2e/assets/design-desktop.png`)
await popup.waitForTimeout(1600)
await popup.screenshot({ path: `${SHOTS}/80-popup-active.png` })
await popup.close()

/* 2. 半尺寸悬浮：选中框 / 手柄 / 尺寸标签 */
await page.bringToFront()
await page.waitForTimeout(400)
await page.keyboard.press('Alt+3')
await page.waitForTimeout(350)
log('half:', JSON.stringify(await boxes()))
await page.screenshot({ path: `${SHOTS}/81-floating-half.png` })

/* 3. 铺满视口 + 45% 透明度做像素比对 */
await page.keyboard.press('Alt+4')
await page.waitForTimeout(300)
await page.keyboard.press('4')
await page.keyboard.press('5')
await page.waitForTimeout(450)
log('aligned:', JSON.stringify(await boxes()))
await page.screenshot({ path: `${SHOTS}/82-diff-45.png` })

/* 4. 拖入移动端稿，摆到右侧 */
await page.evaluate(async () => {
  const response = await fetch('/assets/design-mobile.png')
  const blob = await response.blob()
  const file = new File([blob], 'design-mobile.png', { type: 'image/png' })
  const data = new DataTransfer()
  data.items.add(file)
  document.dispatchEvent(new DragEvent('dragenter', { dataTransfer: data, bubbles: true, cancelable: true }))
  window.__tpDropData = data
})
await page.waitForTimeout(250)
await page.evaluate(() => {
  document.dispatchEvent(
    new DragEvent('drop', { dataTransfer: window.__tpDropData, bubbles: true, cancelable: true }),
  )
})
await page.waitForTimeout(1400)

const mobile = (await boxes()).at(-1)
await page.mouse.move(mobile.x + mobile.w / 2, mobile.y + mobile.h / 2)
await page.mouse.down()
await page.mouse.move(1004 + mobile.w / 2, 40 + mobile.h / 2, { steps: 16 })
await page.mouse.up()
await page.waitForTimeout(350)
log('two layers:', JSON.stringify(await boxes()))
await page.screenshot({ path: `${SHOTS}/83-two-layers.png` })

/* 5. 图层面板 */
await page.locator('.tp-btn[title="图层"]').click()
await page.waitForTimeout(300)
await page.screenshot({ path: `${SHOTS}/84-layers-panel.png` })
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

/* 6. 窄窗口自适应：工具栏不得溢出 */
await page.setViewportSize({ width: 900, height: 700 })
await page.waitForTimeout(500)
const fit = await page.evaluate(() => {
  const root = document.querySelector('tracing-paper-root')?.shadowRoot
  const bar = root?.querySelector('.tp-toolbar')?.getBoundingClientRect()
  const cards = [...(root?.querySelectorAll('.tp-layer') ?? [])].map((el) => el.getBoundingClientRect().toJSON())
  return {
    viewport: { w: innerWidth, h: innerHeight },
    toolbar: bar ? { x: Math.round(bar.x), right: Math.round(bar.right), w: Math.round(bar.width) } : null,
    layers: cards.map((b) => ({ x: Math.round(b.x), w: Math.round(b.width) })),
  }
})
log('narrow:', JSON.stringify(fit))
if (fit.toolbar) {
  if (fit.toolbar.x < 0 || fit.toolbar.right > fit.viewport.w) problems.push('toolbar 溢出窄窗口')
}
await page.screenshot({ path: `${SHOTS}/85-narrow-900.png` })

console.log('PROBLEMS:', problems.length ? JSON.stringify(problems, null, 2) : 'none')
await browser.close()
