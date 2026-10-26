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

/* popup：开启 + 上传桌面设计稿 */
const popup = await ctx.newPage()
await popup.setViewportSize({ width: 360, height: 600 })
await popup.goto(`chrome-extension://${EXT}/popup.html`)
await popup.waitForTimeout(500)
await popup.getByRole('button', { name: '开启' }).click()
await popup.waitForTimeout(400)
const [chooser] = await Promise.all([popup.waitForEvent('filechooser'), popup.locator('.uploader').click()])
await chooser.setFiles(`${ROOT}/.e2e/assets/design-desktop.png`)
await popup.waitForTimeout(1500)
await popup.close()

await page.bringToFront()
await page.waitForTimeout(500)

/* Alt+4 铺满宽度，再拖到 0,0 吸附 */
await page.keyboard.press('Alt+4')
await page.waitForTimeout(250)
let box = (await boxes())[0]
await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2)
await page.mouse.down()
await page.mouse.move(box.w / 2 + 6, box.h / 2 + 6, { steps: 14 })
await page.screenshot({ path: `${SHOTS}/70-snap-0-0.png` })
await page.mouse.up()
await page.waitForTimeout(200)
log('aligned:', JSON.stringify(await boxes()))
await page.screenshot({ path: `${SHOTS}/71-aligned-100.png` })

/* 45% 透明度做像素比对 */
await page.keyboard.press('4')
await page.keyboard.press('5')
await page.waitForTimeout(400)
await page.screenshot({ path: `${SHOTS}/72-overlay-45.png` })

/* 再拖入移动端稿，摆到右侧 */
await page.evaluate(async () => {
  const response = await fetch('/assets/design-mobile.png')
  const blob = await response.blob()
  const file = new File([blob], 'design-mobile.png', { type: 'image/png' })
  const data = new DataTransfer()
  data.items.add(file)
  document.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }))
})
await page.waitForTimeout(1200)
box = (await boxes()).at(-1)
await page.mouse.move(box.x + box.w / 2, box.y + 80)
await page.mouse.down()
await page.mouse.move(1010, 420, { steps: 14 })
await page.mouse.up()
await page.waitForTimeout(300)
log('two layers:', JSON.stringify(await boxes()))
await page.screenshot({ path: `${SHOTS}/73-two-layers.png` })

/* 图层面板开着的成品图 */
await page.locator('.tp-btn[title="图层"]').click()
await page.waitForTimeout(300)
await page.screenshot({ path: `${SHOTS}/74-layers-final.png` })

console.log('PROBLEMS:', problems.length ? JSON.stringify(problems, null, 2) : 'none')
await browser.close()
