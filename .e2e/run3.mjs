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
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`))
await page.goto(SITE)
await page.setViewportSize({ width: 1440, height: 900 })
await page.bringToFront()
await page.waitForTimeout(500)

const layerCount = () =>
  page.evaluate(
    () => document.querySelector('tracing-paper-root')?.shadowRoot?.querySelectorAll('.tp-layer').length ?? 0,
  )
const boxes = () =>
  page.evaluate(() =>
    [...(document.querySelector('tracing-paper-root')?.shadowRoot?.querySelectorAll('.tp-layer') ?? [])].map(
      (el) => {
        const b = el.getBoundingClientRect()
        return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
      },
    ),
  )
const handlePoint = (handle) =>
  page.evaluate((name) => {
    const el = document
      .querySelector('tracing-paper-root')
      ?.shadowRoot?.querySelector(`.tp-handle[data-handle="${name}"]`)
    if (!el) return null
    const b = el.getBoundingClientRect()
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  }, handle)

/* 注入 + 插入两张设计稿 */
const popup = await ctx.newPage()
await popup.setViewportSize({ width: 380, height: 760 })
await popup.goto(`chrome-extension://${EXT}/popup.html`)
await popup.waitForTimeout(500)
await popup.getByRole('button', { name: '开启' }).click()
await popup.waitForTimeout(400)
const [chooser] = await Promise.all([popup.waitForEvent('filechooser'), popup.locator('.uploader').click()])
await chooser.setFiles([`${ROOT}/.e2e/assets/design-desktop.png`, `${ROOT}/.e2e/assets/design-mobile.png`])
await popup.waitForTimeout(2000)
await popup.screenshot({ path: `${SHOTS}/40-popup-two-assets.png` })
await popup.close()

await page.bringToFront()
await page.waitForTimeout(600)
log('layers:', await layerCount(), JSON.stringify(await boxes()))

/* 拖动第二层（移动端稿）到右侧 */
let list = await boxes()
let mobile = list[list.length - 1]
await page.mouse.move(mobile.x + mobile.w / 2, mobile.y + mobile.h / 2)
await page.mouse.down()
await page.mouse.move(mobile.x + mobile.w / 2 + 520, mobile.y + 120, { steps: 14 })
await page.mouse.up()
await page.waitForTimeout(200)
log('after move:', JSON.stringify(await boxes()))

/* e 手柄缩放（宽度） */
const e = await handlePoint('e')
await page.mouse.move(e.x, e.y)
await page.mouse.down()
await page.mouse.move(e.x - 120, e.y, { steps: 12 })
await page.mouse.up()
await page.waitForTimeout(200)
log('after e-resize:', JSON.stringify(await boxes()))

/* Shift + se 等比缩放 */
let se = await handlePoint('se')
await page.keyboard.down('Shift')
await page.mouse.move(se.x, se.y)
await page.mouse.down()
await page.mouse.move(se.x - 90, se.y - 90, { steps: 12 })
await page.mouse.up()
await page.keyboard.up('Shift')
await page.waitForTimeout(250)
log('after shift se-resize:', JSON.stringify(await boxes()))

/* Alt + 滚轮等比缩放 */
const anchor = (await boxes())[0]
await page.mouse.move(anchor.x + 200, anchor.y + 200)
await page.keyboard.down('Alt')
await page.mouse.wheel(0, -120)
await page.mouse.wheel(0, -120)
await page.keyboard.up('Alt')
await page.waitForTimeout(250)
log('after alt+wheel:', JSON.stringify(await boxes()))

/* 图层顺序 + 复制 + 删除 */
await page.locator('.tp-btn[title="图层"]').click()
await page.waitForTimeout(250)
await page.screenshot({ path: `${SHOTS}/41-layers-two.png` })
const rows = page.locator('.tp-layer-row')
log('layer rows:', await rows.count())
await rows.nth(1).locator('.tp-icon-btn[title="上移一层"]').click().catch(() => log('no up button'))
await page.waitForTimeout(200)
await page.keyboard.press('Escape')

await page.keyboard.press('Meta+d')
await page.waitForTimeout(300)
log('after duplicate:', await layerCount())
await page.keyboard.press('Delete')
await page.waitForTimeout(300)
log('after delete:', await layerCount())
await page.keyboard.press('Meta+z')
await page.waitForTimeout(300)
log('after undo delete:', await layerCount())

/* 图层顺序 + 复制 + 删除 */
await page.locator('.tp-btn[title="图层"]').click()
await page.waitForTimeout(200)
await page.screenshot({ path: `${SHOTS}/42-layers-after.png` })
await page.keyboard.press('Escape')

/* 快捷键面板（校准后的 kbd） */
await page.locator('.tp-btn[title="快捷键"]').click()
await page.waitForTimeout(250)
await page.screenshot({ path: `${SHOTS}/43-help-panel-fixed.png` })
await page.keyboard.press('Escape')

/* 尺寸面板（修正 比例 chip） */
await page.locator('.tp-btn[title="精确位置与尺寸"]').click()
await page.waitForTimeout(250)
await page.screenshot({ path: `${SHOTS}/44-size-panel-fixed.png` })
await page.keyboard.press('Escape')

/* 最终美化截图：55% 透明度、正常混合、图层与页面重叠 */
await page.keyboard.press('5')
await page.keyboard.press('5')
await page.waitForTimeout(300)
await page.screenshot({ path: `${SHOTS}/45-final.png` })

console.log('PROBLEMS:', problems.length ? JSON.stringify(problems, null, 2) : 'none')
await browser.close()
