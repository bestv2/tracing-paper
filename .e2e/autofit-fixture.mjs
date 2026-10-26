/**
 * 导出自动对齐用的夹具：设计稿原图 + 当前页面截图（隐藏浮层、滚动到顶部）。
 * 产出的两张 PNG 可以直接喂给 .e2e/autofit-match.mjs 调算法。
 */
import { chromium } from 'playwright'
import fs from 'node:fs'

const EXT = 'ncfglfbdlbdpbdmmpollpedloanbdfnp'
const ROOT = process.cwd()
const OUT = `${ROOT}/.e2e/shots/autofit`
fs.mkdirSync(OUT, { recursive: true })
const log = (...args) => console.log('·', ...args)

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const ctx = browser.contexts()[0]

let page = ctx.pages().find((p) => p.url().includes('127.0.0.1:8123'))
if (!page) {
  page = await ctx.newPage()
  await page.goto('http://127.0.0.1:8123/')
}
await page.bringToFront()
await page.setViewportSize({ width: 1440, height: 900 })
await page.reload()
await page.waitForTimeout(1600)

/* 设计稿原图：从图层 <img> 里取回 dataURL */
const design = await page.evaluate(async () => {
  const root = document.querySelector('tracing-paper-root')?.shadowRoot
  const layers = [...(root?.querySelectorAll('.tp-layer') ?? [])]
  const target = layers.find((el) => el.dataset.layerId === 'ly_mvp4h4af_uhfpp') ?? layers[layers.length - 1]
  const img = target?.querySelector('img')
  if (!img) return null
  const blob = await (await fetch(img.src)).blob()
  const buffer = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < buffer.length; i += 1) binary += String.fromCharCode(buffer[i])
  return { size: [img.naturalWidth, img.naturalHeight], base64: btoa(binary) }
})
if (!design) throw new Error('没找到设计稿图层')
fs.writeFileSync(`${OUT}/fx-design.png`, Buffer.from(design.base64, 'base64'))
log('design:', design.size.join('x'))

/* 页面截图：藏掉浮层、回到顶部，让「设计稿 = 页面顶部」成为已知真值 */
await page.evaluate(() => {
  const host = document.querySelector('tracing-paper-root')
  if (host) host.style.setProperty('display', 'none', 'important')
  window.scrollTo(0, 0)
})
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}/fx-page.png` })
log('page:', JSON.stringify(await page.evaluate(() => ({ w: innerWidth, h: innerHeight, y: scrollY }))))

await page.evaluate(() => {
  const host = document.querySelector('tracing-paper-root')
  if (host) host.style.removeProperty('display')
})

await browser.close()
