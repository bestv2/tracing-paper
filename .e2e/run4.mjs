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
const drag = async (from, to, holdShift = false) => {
  if (holdShift) await page.keyboard.down('Shift')
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.mouse.up()
  if (holdShift) await page.keyboard.up('Shift')
  await page.waitForTimeout(180)
}

/* 注入 + 插入两张设计稿 */
const popup = await ctx.newPage()
await popup.setViewportSize({ width: 380, height: 780 })
await popup.goto(`chrome-extension://${EXT}/popup.html`)
await popup.waitForTimeout(500)
await popup.getByRole('button', { name: '开启' }).click()
await popup.waitForTimeout(400)
const [chooser] = await Promise.all([popup.waitForEvent('filechooser'), popup.locator('.uploader').click()])
await chooser.setFiles([`${ROOT}/.e2e/assets/design-desktop.png`, `${ROOT}/.e2e/assets/design-mobile.png`])
await popup.waitForTimeout(2000)
await popup.screenshot({ path: `${SHOTS}/50-popup-two-assets.png` })
await popup.close()

await page.bringToFront()
await page.waitForTimeout(500)
log('initial:', JSON.stringify(await boxes()))

/* e 手柄：改宽度 */
let e = await handlePoint('e')
log('e handle at', JSON.stringify(e))
await drag(e, { x: e.x - 120, y: e.y })
log('after e-resize:', JSON.stringify(await boxes()))

/* s 手柄：改高度 */
let s = await handlePoint('s')
log('s handle at', JSON.stringify(s))
await drag(s, { x: s.x, y: s.y - 320 })
log('after s-resize:', JSON.stringify(await boxes()))

/* Shift + se：等比缩放 */
let se = await handlePoint('se')
log('se handle at', JSON.stringify(se))
const beforeShift = (await boxes()).at(-1)
await drag(se, { x: se.x + 60, y: se.y + 60 }, true)
const afterShift = (await boxes()).at(-1)
log('after shift se-resize:', JSON.stringify(afterShift))
log(
  'ratio before/after:',
  (beforeShift.w / beforeShift.h).toFixed(3),
  '/',
  (afterShift.w / afterShift.h).toFixed(3),
)
await page.screenshot({ path: `${SHOTS}/51-resized-mobile.png` })

/* nw 手柄：同时改位置与尺寸 */
const nw = await handlePoint('nw')
await drag(nw, { x: nw.x + 40, y: nw.y + 40 })
log('after nw-resize:', JSON.stringify(await boxes()))

/* 复位：Alt+0 */
await page.keyboard.press('Alt+0')
await page.waitForTimeout(250)
log('after alt+0 reset:', JSON.stringify(await boxes()))
await page.screenshot({ path: `${SHOTS}/52-reset.png` })

/* 第二层切到差值 + 40% 透明度，检查重叠区 */
await page.keyboard.press('Meta+z')
await page.waitForTimeout(200)

console.log('PROBLEMS:', problems.length ? JSON.stringify(problems, null, 2) : 'none')
await browser.close()
