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

const layerCount = () =>
  page.evaluate(
    () => document.querySelector('tracing-paper-root')?.shadowRoot?.querySelectorAll('.tp-layer').length ?? 0,
  )

/* 1. 真实 popup 尺寸（360 × 600） */
const popup = await ctx.newPage()
await popup.setViewportSize({ width: 360, height: 600 })
await popup.goto(`chrome-extension://${EXT}/popup.html`)
await popup.waitForTimeout(600)
await popup.screenshot({ path: `${SHOTS}/60-popup-360.png` })
log('popup 360×600 captured, scrollHeight:', await popup.evaluate(() => document.documentElement.scrollHeight))

await popup.getByRole('button', { name: '开启' }).click()
await popup.waitForTimeout(400)
const [chooser] = await Promise.all([popup.waitForEvent('filechooser'), popup.locator('.uploader').click()])
await chooser.setFiles(`${ROOT}/.e2e/assets/design-desktop.png`)
await popup.waitForTimeout(1500)
log('badge:', await popup.evaluate(async () => {
  const tabs = await chrome.tabs.query({ currentWindow: true })
  const target = tabs.find((t) => (t.url ?? '').startsWith('http'))
  return target?.id ? chrome.action.getBadgeText({ tabId: target.id }) : 'n/a'
}))
await popup.screenshot({ path: `${SHOTS}/61-popup-360-active.png` })

/* 2. 拖拽文件进页面 */
await page.bringToFront()
const before = await layerCount()
await page.evaluate(async () => {
  const response = await fetch('/assets/design-mobile.png')
  const blob = await response.blob()
  const file = new File([blob], 'dropped-mobile.png', { type: 'image/png' })
  const data = new DataTransfer()
  data.items.add(file)
  document.dispatchEvent(new DragEvent('dragenter', { dataTransfer: data, bubbles: true, cancelable: true }))
  window.__tpDropData = data
})
await page.waitForTimeout(250)
const hint = await page.evaluate(
  () => !!document.querySelector('tracing-paper-root')?.shadowRoot?.querySelector('.tp-drop'),
)
await page.evaluate(() => {
  const data = window.__tpDropData
  document.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }))
})
log('drop hint shown:', hint)
await page.waitForTimeout(1600)
log('layers after drop:', before, '->', await layerCount())
await page.screenshot({ path: `${SHOTS}/62-after-drop.png` })

/* 3. 素材库一键插入 */
await popup.bringToFront()
const shots = popup.locator('.shot')
log('library items:', await shots.count())
await shots.first().click()
await popup.waitForTimeout(1500)
await popup.screenshot({ path: `${SHOTS}/63-popup-library-insert.png` })

/* 4. 吸附开关 S */
await page.bringToFront()
await page.mouse.click(24, 300)
await page.waitForTimeout(200)
await page.keyboard.press('s')
await page.waitForTimeout(300)
await page.screenshot({ path: `${SHOTS}/64-snap-off-toast.png` })
const magnetActive = await page.evaluate(
  () =>
    document
      .querySelector('tracing-paper-root')
      ?.shadowRoot?.querySelector('.tp-btn[title*="吸附"]')
      ?.getAttribute('data-active') ?? 'missing',
)
log('magnet button active:', magnetActive)
await page.keyboard.press('s')

/* 5. 摆一个像样的对比画面 */
const arrange = await page.evaluate(() => {
  const shadow = document.querySelector('tracing-paper-root')?.shadowRoot
  const layers = [...(shadow?.querySelectorAll('.tp-layer') ?? [])]
  return layers.length
})
log('layers for arrange:', arrange)

await page.evaluate(() => {
  const shadow = document.querySelector('tracing-paper-root')?.shadowRoot
  const layer = shadow?.querySelector('.tp-layer')
  if (!layer) return
  const box = layer.getBoundingClientRect()
  return { x: box.x, y: box.y }
})

// 选中最大的桌面稿：点击其左上可见区域
await page.mouse.click(80, 90)
await page.waitForTimeout(200)
await page.keyboard.press('5')
await page.keyboard.press('5')
await page.waitForTimeout(400)
await page.screenshot({ path: `${SHOTS}/65-final-comparison.png` })

await popup.close()
console.log('PROBLEMS:', problems.length ? JSON.stringify(problems, null, 2) : 'none')
await browser.close()
