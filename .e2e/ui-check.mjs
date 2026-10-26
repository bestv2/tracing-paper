import { chromium } from 'playwright'
import fs from 'node:fs'

const EXT = 'ncfglfbdlbdpbdmmpollpedloanbdfnp'
const ROOT = process.cwd()
const OUT = `${ROOT}/.e2e/shots/ui-check`
fs.mkdirSync(OUT, { recursive: true })

const log = (...args) => console.log('·', ...args)

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const ctx = browser.contexts()[0]

/* 重载扩展，让新样式生效 */
const reloader = await ctx.newPage()
await reloader.goto(`chrome-extension://${EXT}/popup.html`)
await reloader.evaluate(() => chrome.runtime.reload()).catch(() => {})
await reloader.close().catch(() => {})
await new Promise((r) => setTimeout(r, 2000))

/* popup */
const popup = await ctx.newPage()
await popup.setViewportSize({ width: 372, height: 620 })
await popup.goto(`chrome-extension://${EXT}/popup.html`)
await popup.waitForTimeout(900)
await popup.screenshot({ path: `${OUT}/01-popup-zh.png` })
log('popup zh captured')

if (await popup.locator('.toggle').getAttribute('data-on') !== 'true') {
  await popup.locator('.toggle').click()
  await popup.waitForTimeout(700)
}

const [chooser] = await Promise.all([
  popup.waitForEvent('filechooser'),
  popup.locator('.uploader').click(),
])
await chooser.setFiles(`${ROOT}/.e2e/assets/design-desktop.png`)
await popup.waitForTimeout(1600)
await popup.screenshot({ path: `${OUT}/02-popup-library.png` })
log('popup library captured')

/* 页面 */
let page = ctx.pages().find((p) => p.url().includes('127.0.0.1:8123'))
if (!page) {
  page = await ctx.newPage()
  await page.goto('http://127.0.0.1:8123/')
}
await page.setViewportSize({ width: 1440, height: 900 })
await page.bringToFront()
await page.reload()
await page.waitForTimeout(1500)

const bar = page.locator('.tp-toolbar')
await bar.waitFor({ timeout: 8000 })
await bar.screenshot({ path: `${OUT}/03-toolbar-light.png` })

const box = await bar.boundingBox()
const clip = {
  x: Math.max(0, box.x - 24),
  y: Math.max(0, box.y - 52),
  width: Math.min(1440 - Math.max(0, box.x - 24), box.width + 48),
  height: box.height + 100,
}

/* hover 提示 */
await page.locator('.tp-btn--diff').hover()
await page.waitForTimeout(600)
await page.screenshot({ path: `${OUT}/04-tooltip-diff.png`, clip })
log('tooltip captured:', await page.locator('.tp-tooltip').innerText().catch(() => '(none)'))

await page.locator('.tp-btn--icon').nth(2).hover()
await page.waitForTimeout(600)
await page.screenshot({ path: `${OUT}/05-tooltip-icon.png`, clip })

/* 更多面板：主题 + 语言 */
await page.locator('.tp-btn--icon').last().hover()
await page.waitForTimeout(200)
// 打开 ⋯ 面板（倒数第二个图标按钮）
await page.locator('.tp-btn--icon').nth(6).click()
await page.waitForTimeout(400)
const popover = page.locator('.tp-popover')
await popover.waitFor({ timeout: 4000 })
await popover.screenshot({ path: `${OUT}/06-more-zh.png` })

await popover.locator('.tp-segment').first().locator('.tp-chip').nth(1).click()
await page.waitForTimeout(500)
await popover.screenshot({ path: `${OUT}/07-more-dark.png` })
await page.screenshot({ path: `${OUT}/08-page-dark.png` })
await bar.screenshot({ path: `${OUT}/09-toolbar-dark.png` })

await popover.locator('.tp-segment').nth(1).locator('.tp-chip').nth(1).click()
await page.waitForTimeout(500)
await popover.screenshot({ path: `${OUT}/10-more-en.png` })
const tip = await page.locator('.tp-btn').first().getAttribute('data-tip')
log('en tooltip attr:', tip)

/* 回到浅色 + 中文，并截取浮层整体 */
await popover.locator('.tp-segment').first().locator('.tp-chip').nth(0).click()
await popover.locator('.tp-segment').nth(1).locator('.tp-chip').nth(0).click()
await page.waitForTimeout(400)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await page.screenshot({ path: `${OUT}/11-page-light.png` })

/* 英文 popup */
await popup.bringToFront()
await popup.reload()
await popup.waitForTimeout(900)
await popup.locator('.locale-chip').nth(1).click()
await popup.waitForTimeout(500)
await popup.screenshot({ path: `${OUT}/12-popup-en.png` })
log('popup en captured')

/* 比对报告 */
await page.bringToFront()
await page.locator('.tp-btn--diff').click()
await page.waitForTimeout(6000)
const report = page.locator('.tracing-report')
if (await report.count()) {
  await report.first().screenshot({ path: `${OUT}/13-report.png` })
  log('report captured')
  await page.keyboard.press('Escape')
}

console.log(JSON.stringify({ ok: true, out: OUT }))
await browser.close()
