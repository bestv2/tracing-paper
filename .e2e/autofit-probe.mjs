import { chromium } from 'playwright'
import fs from 'node:fs'

const EXT = 'ncfglfbdlbdpbdmmpollpedloanbdfnp'
const ROOT = process.cwd()
const OUT = `${ROOT}/.e2e/shots/autofit`
fs.mkdirSync(OUT, { recursive: true })
const log = (...args) => console.log('·', ...args)

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const ctx = browser.contexts()[0]

const reloader = await ctx.newPage()
await reloader.goto(`chrome-extension://${EXT}/popup.html`)
await reloader.evaluate(() => chrome.runtime.reload()).catch(() => {})
await reloader.close().catch(() => {})
await new Promise((r) => setTimeout(r, 2000))

let page = ctx.pages().find((p) => p.url().includes('127.0.0.1:8123'))
if (!page) {
  page = await ctx.newPage()
  await page.goto('http://127.0.0.1:8123/')
}
await page.bringToFront()
await page.setViewportSize({ width: 1440, height: 900 })
page.on('console', (msg) => {
  const text = msg.text()
  if (text.includes('[tp-autofit]') || text.includes('[tp-autofit:')) console.log('console:', text)
})
await page.reload()
await page.waitForTimeout(1800)

log('viewport:', JSON.stringify(await page.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio }))))

const layers = await page.evaluate(() => {
  const root = document.querySelector('tracing-paper-root')?.shadowRoot
  const list = [...(root?.querySelectorAll('.tp-layer') ?? [])]
  return list.map((el) => ({
    id: el.dataset.layerId,
    transform: el.style.transform,
    w: Math.round(Number.parseFloat(el.style.width)),
    h: Math.round(Number.parseFloat(el.style.height)),
    visible: el.style.visibility,
    natural: (() => {
      const img = el.querySelector('img')
      return img ? [img.naturalWidth, img.naturalHeight] : null
    })(),
  }))
})
log('layers:', JSON.stringify(layers, null, 1))

/* 设计稿原图 + 当前页面，肉眼对比 */
const designImg = page.locator('.tp-layer img').last()
if (await designImg.count()) {
  await designImg.screenshot({ path: `${OUT}/probe-design.png` }).catch(() => {})
}
await page.screenshot({ path: `${OUT}/probe-page-1440.png` })

const bar = page.locator('.tp-toolbar')
await bar.waitFor({ timeout: 8000 })
const press = (locator) => locator.evaluate((el) => el.click())

/* 点工具栏 wand 触发自动对齐（若禁用则先选中一个图层） */
const wand = page.locator('.tp-btn--icon[data-tip]').filter({ has: page.locator('svg') })
log('toolbar icon buttons:', await wand.count())
const readRect = () =>
  page.evaluate(() => {
    const root = document.querySelector('tracing-paper-root')?.shadowRoot
    const list = [...(root?.querySelectorAll('.tp-layer') ?? [])]
    return list.map((el) => {
      const match = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px/.exec(el.style.transform)
      return {
        id: el.dataset.layerId,
        x: Math.round(Number(match?.[1] ?? 0)),
        y: Math.round(Number(match?.[2] ?? 0)),
        w: Math.round(Number.parseFloat(el.style.width)),
        h: Math.round(Number.parseFloat(el.style.height)),
      }
    })
  })

log('rect before:', JSON.stringify(await readRect()))

await press(page.locator('.tp-btn--diff'))
await page.waitForTimeout(7000)
const meta = await page.locator('.tracing-report__meta').innerText().catch(() => '(none)')
log('meta:', meta.replace(/\n/g, ' '))

const action = page.locator('.tracing-report__autofit')
log('autofit action:', await action.count())
if (await action.count()) {
  await press(action)
  await page.waitForTimeout(1000)
  log('toast@1s:', await page.locator('.tp-toast').innerText().catch(() => '(none)'))
  await page.waitForTimeout(10000)
  log('toast@11s:', await page.locator('.tp-toast').innerText().catch(() => '(none)'))
}
log('rect after:', JSON.stringify(await readRect()))
await page.locator('.tracing-report').screenshot({ path: `${OUT}/probe-report-after.png` }).catch(() => {})
await page.screenshot({ path: `${OUT}/probe-page-after.png` })

await browser.close()
