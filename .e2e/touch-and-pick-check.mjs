/**
 * 验收：① 触摸屏上下拖动图层（touch-action 修复）② 比对列表勾选/单块复制/导出
 * 用法：node .e2e/touch-and-pick-check.mjs
 */
import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'

const EXT = 'ncfglfbdlbdpbdmmpollpedloanbdfnp'
const ROOT = process.cwd()
const SHOTS = `${ROOT}/.e2e/shots`
const SITE = 'http://127.0.0.1:8123/'
mkdirSync(SHOTS, { recursive: true })

const log = (...args) => console.log('·', ...args)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const problems = []

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

const cleanStorage = async () => {
  await page.goto('about:blank')
  const cleaner = await ctx.newPage()
  await cleaner.goto(`chrome-extension://${EXT}/popup.html`)
  await cleaner.evaluate(() => chrome.storage.local.clear()).catch(() => {})
  await cleaner.close().catch(() => {})
}

const upload = async (file) => {
  const popup = await ctx.newPage()
  await popup.setViewportSize({ width: 380, height: 720 })
  await popup.goto(`chrome-extension://${EXT}/popup.html`)
  await popup.waitForTimeout(600)
  const toggle = popup.locator('button.toggle')
  if ((await toggle.innerText()).includes('开启')) {
    await toggle.click()
    await popup.waitForTimeout(700)
  }
  const [chooser] = await Promise.all([
    popup.waitForEvent('filechooser'),
    popup.locator('.uploader').click(),
  ])
  await chooser.setFiles(`${ROOT}/.e2e/assets/${file}`)
  await popup.waitForTimeout(1500)
  await popup.close().catch(() => {})
  await page.bringToFront()
  await wait(600)
}

const layerStyle = () =>
  page.evaluate(() => {
    const layer = document.querySelector('tracing-paper-root')?.shadowRoot?.querySelector('.tp-layer')
    return layer
      ? {
          transform: layer.style.transform,
          touchAction: getComputedStyle(layer).touchAction,
          scrollY: Math.round(scrollY),
        }
      : null
  })

/* ① 触摸屏上下拖动 ------------------------------------------------------- */
await page.setViewportSize({ width: 390, height: 844 })
await page.goto(SITE)
await page.bringToFront()
await wait(800)
await cleanStorage()
await page.goto(SITE)
await page.bringToFront()
await wait(1200)
await upload('design-mobile.png')

const cdp = await ctx.newCDPSession(page)
await cdp.send('Overlay.disable').catch(() => {})
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })

log('拖动前:', JSON.stringify(await layerStyle()))

const box = await page.locator('.tp-layer').first().boundingBox()
const cx = Math.round(box.x + box.width / 2)
const cy = Math.round(box.y + box.height / 2)

const touch = async (type, x, y) =>
  cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
  })

await touch('touchStart', cx, cy)
for (let step = 1; step <= 8; step += 1) {
  await touch('touchMove', cx, cy - step * 12)
  await wait(30)
}
await touch('touchEnd', cx, cy)
await wait(300)
const draggedUp = await layerStyle()
log('上拖后:', JSON.stringify(draggedUp))

await touch('touchStart', cx, cy - 60)
for (let step = 1; step <= 6; step += 1) {
  await touch('touchMove', cx, cy - 60 + step * 10)
  await wait(30)
}
await touch('touchEnd', cx, cy)
await wait(300)
log('下拖后:', JSON.stringify(await layerStyle()))
await page.screenshot({ path: `${SHOTS}/30-touch-drag.png` })

const originY = Number((draggedUp.transform.match(/translate3d\([^,]+,\s*(-?[\d.]+)px/) ?? [])[1])
const endState = await layerStyle()
const endY = Number((endState.transform.match(/translate3d\([^,]+,\s*(-?[\d.]+)px/) ?? [])[1])
log('纵向位移:', Math.round(endY - originY), '(上拖 96 - 下拖 60 = 约 36)')

/* ② 比对列表：勾选 / 单块复制 / 导出 ------------------------------------ */
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }).catch(() => {})
await page.setViewportSize({ width: 1440, height: 900 })
await cleanStorage()
await page.goto(SITE)
await page.bringToFront()
await wait(1200)
await upload('design-desktop.png')

// 挪一点，制造可测的差异
for (let i = 0; i < 8; i += 1) await page.keyboard.press('ArrowRight')
for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowDown')

await page.locator('.tp-btn--diff').click()
await wait(9000)

const report = () =>
  page.evaluate(() => {
    const root = document.querySelector('tracing-paper-root')?.shadowRoot
    if (!root) return null
    return {
      rows: root.querySelectorAll('.tp-report__row').length,
      checks: root.querySelectorAll('.tp-check').length,
      pickedText: root.querySelector('.tp-report__pickcount')?.textContent?.trim() ?? null,
      copyButtons: root.querySelectorAll('.tp-report__copy').length,
      copyDisabled: [...root.querySelectorAll('.tp-report__pick .tp-chip')].map(
        (el) => `${el.textContent?.trim()}:${el.disabled}`,
      ),
      toast: root.querySelector('.tp-toast')?.textContent?.trim() ?? null,
    }
  })

log('报告初始:', JSON.stringify(await report()))

const checkCount = await page.locator('.tp-check').count()
if (checkCount < 2) {
  log('差异不足 2 条，勾选链路无法验证')
} else {
  await page.locator('.tp-check').nth(0).click()
  await page.locator('.tp-check').nth(1).click()
  await wait(250)
  log('勾选两条:', JSON.stringify(await report()))
  await page.screenshot({ path: `${SHOTS}/31-report-picked.png` })

  // 单块复制
  await page.locator('.tp-report__copy').first().click()
  await wait(300)
  log('单块复制后 toast:', (await report()).toast)

  // 复制所选
  await page.locator('.tp-report__pick .tp-chip', { hasText: '复制所选' }).click()
  await wait(300)
  log('复制所选后 toast:', (await report()).toast)

  // 导出所选 MD
  const [mdDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.locator('.tp-report__pick .tp-chip', { hasText: 'MD' }).click(),
  ])
  const mdPath = await mdDownload.path()
  const md = readFileSync(mdPath, 'utf8')
  log('MD 文件名:', mdDownload.suggestedFilename())
  log('MD 首行:', md.split('\n')[0])
  log('MD 块数:', (md.match(/^### /gm) ?? []).length)
  console.log(md.split('\n').slice(0, 12).join('\n'))

  // 导出所选 JSON
  const [jsonDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.locator('.tp-report__pick .tp-chip', { hasText: 'JSON' }).click(),
  ])
  const json = JSON.parse(readFileSync(await jsonDownload.path(), 'utf8'))
  log('JSON findings:', json.findings.length, '| summary.findings:', json.summary.findings)

  // 取消勾选后按钮禁用
  await page.locator('.tp-report__pick .tp-chip').first().click()
  await wait(250)
  log('取消全选后:', JSON.stringify(await report()))

  // 窄屏列表排版
  await page.setViewportSize({ width: 390, height: 844 })
  await wait(500)
  await page.screenshot({ path: `${SHOTS}/32-report-mobile.png` })
  await page.setViewportSize({ width: 1440, height: 900 })
}

console.log(problems.length ? `问题: ${problems.join(' | ')}` : '无控制台错误')
