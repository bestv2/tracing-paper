/**
 * 自动缩放定位（autofit）端到端验收
 *
 * 流程：选中桌面设计稿 → 故意用「原图 ÷2」把它缩错 → 依次验证三条入口
 * （比对报告 / 工具栏 wand / 适配面板）能否一键还原到 ~1440×900，
 * 并在报告入口上确认重新比对后的差异率明显下降。
 */
import { chromium } from 'playwright'
import fs from 'node:fs'

const EXT = 'ncfglfbdlbdpbdmmpollpedloanbdfnp'
const ROOT = process.cwd()
const OUT = `${ROOT}/.e2e/shots/autofit`
fs.mkdirSync(OUT, { recursive: true })

const log = (...args) => console.log('·', ...args)
const DESIGN = 'design-desktop'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const ctx = browser.contexts()[0]

/* 重载扩展，确保跑的是最新构建 */
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
await page.reload()
await page.waitForTimeout(1800)

const bar = page.locator('.tp-toolbar')
await bar.waitFor({ timeout: 8000 })

// 浮层是 fixed 定位，真实窗口尺寸与 Playwright 视口可能不同，统一用 DOM click
const press = (locator) => locator.evaluate((el) => el.click())
const sleep = (ms) => page.waitForTimeout(ms)

/** 扩展刚重载时内容脚本可能还没把图层恢复出来，等一会儿 */
const waitForLayers = async (timeout = 15000) => {
  const from = Date.now()
  while (Date.now() - from < timeout) {
    const count = await page
      .evaluate(() => document.querySelector('tracing-paper-root')?.shadowRoot?.querySelectorAll('.tp-layer').length ?? 0)
      .catch(() => 0)
    if (count > 0) return count
    await sleep(400)
  }
  return 0
}
const layerCount = await waitForLayers()
log('layers:', layerCount)
if (!layerCount) throw new Error('没有图层，先往页面上放一张设计稿再跑')

/** 选中图层的实时几何（文档坐标） */
const selectedRect = () =>
  page.evaluate(() => {
    const root = document.querySelector('tracing-paper-root')?.shadowRoot
    const el = root?.querySelector('.tp-selection')?.parentElement
    if (!el) return null
    const match = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px/.exec(el.style.transform)
    const round = (value) => Math.round(Number.parseFloat(value) || 0)
    return {
      id: el.dataset.layerId,
      x: Math.round(Number(match?.[1] ?? 0)),
      y: Math.round(Number(match?.[2] ?? 0)),
      w: round(el.style.width),
      h: round(el.style.height),
    }
  })

const reportMeta = () =>
  page
    .locator('.tracing-report__meta')
    .innerText()
    .then((text) => text.replace(/\n/g, ' '))
    .catch(() => '(no report)')

const toast = () =>
  page
    .locator('.tp-toast')
    .innerText()
    .catch(() => '(no toast)')

const changedRate = async () => {
  const match = /(?:Changed|变化)\s*([\d.]+)%/.exec(await reportMeta())
  return match ? Number(match[1]) : null
}

/* 工具栏 wand 紧挨 diff 按钮，fitBusy 时两者都置灰，是统一的忙状态信号 */
const wand = page.locator('.tp-btn--diff').locator('xpath=preceding-sibling::button[1]')
const busy = () => wand.evaluate((el) => el.disabled).catch(() => false)

const waitIdle = async (timeout = 60000) => {
  const from = Date.now()
  await sleep(600)
  while (Date.now() - from < timeout) {
    if (!(await busy())) return true
    await sleep(400)
  }
  return false
}

/* 打开图层列表并按名字选中设计稿 */
const selectLayer = async (name) => {
  const toggle = page.locator('.tp-btn[data-tip*="图层"], .tp-btn[data-tip*="Layers"]').first()
  const row = page.locator('.tp-layer-row', { hasText: name }).first()
  for (let i = 0; i < 6; i += 1) {
    await press(toggle)
    await sleep(400)
    if (await row.count()) break
  }
  await press(row)
  await sleep(200)
  await page.keyboard.press('Escape')
  await sleep(300)
  return selectedRect()
}

/* 用适配面板的「原图 ÷2」制造错误状态：尺寸应缩到一半 */
const breakLayer = async () => {
  await press(page.locator('.tp-btn', { hasText: /适配|Fit/ }).first())
  await sleep(350)
  await press(page.locator('.tp-option', { hasText: /原图 ÷2|Natural ÷2/ }).first())
  await sleep(500)
  await page.keyboard.press('Escape')
  await sleep(300)
  return selectedRect()
}

const runDiff = async () => {
  await press(page.locator('.tp-btn--diff'))
  await waitIdle()
  await sleep(900)
  return changedRate()
}

const halfOf = (rect) => Math.abs(rect.w - Math.round(1440 / 2)) < 24 && Math.abs(rect.h - Math.round(900 / 2)) < 24
const restored = (rect) => rect.w > 1200 && Math.abs(rect.w / rect.h - 1440 / 900) < 0.03

const report = { checks: [] }
const check = (name, ok, detail) => {
  report.checks.push({ name, ok, detail })
  log(`${ok ? 'PASS' : 'FAIL'} ${name} :: ${detail}`)
}

/* ------------------------------------------------------------------ 0. 选中 */
const start = await selectLayer(DESIGN)
log('viewport:', JSON.stringify(await page.evaluate(() => ({ w: innerWidth, h: innerHeight, y: scrollY }))))
log('selected:', JSON.stringify(start))
check('select', !!start && start.w > 1300, `初始尺寸 ${start?.w}×${start?.h}`)

/* ------------------------------------------- 1. 报告入口：摆歪 → 一键对齐 */
const broken = await breakLayer()
log('broken:', JSON.stringify(broken))
check('break', !!broken && halfOf(broken), `原图 ÷2 后 ${broken?.w}×${broken?.h}`)

const before = await runDiff()
log('meta broken:', await reportMeta())
await page.locator('.tracing-report').screenshot({ path: `${OUT}/20-report-before.png` })
check('report-entry', (await page.locator('.tracing-report__autofit').count()) === 1, '报告内存在自动对齐按钮')

await press(page.locator('.tracing-report__autofit'))
await sleep(700)
log('toast@0.7s:', await toast())
await page.locator('.tracing-report').screenshot({ path: `${OUT}/21-report-busy.png` })
const idleReport = await waitIdle()
await sleep(1500)
log('toast done:', await toast())
const afterReport = await selectedRect()
const metaAfter = await reportMeta()
const after = await changedRate()
log('meta after:', metaAfter)
log('rect after:', JSON.stringify(afterReport))
check('report-idle', idleReport, '按钮恢复可点')
check('report-restored', !!afterReport && restored(afterReport), `${afterReport?.w}×${afterReport?.h}`)
check('report-diff-drop', before !== null && after !== null && after < before - 10, `${before}% → ${after}%`)
await page.locator('.tracing-report').screenshot({ path: `${OUT}/22-report-after.png` })

/* ------------------------------------------------- 2. 工具栏 wand 一键还原 */
const broken2 = await breakLayer()
const rect2 = await selectedRect()
check('break-2', !!rect2 && halfOf(rect2), `${rect2?.w}×${rect2?.h}`)
log('toolbar wand disabled:', await wand.evaluate((el) => el.disabled))
await press(wand)
await sleep(700)
log('toolbar toast@0.7s:', await toast())
const idleToolbar = await waitIdle()
await sleep(600)
log('toolbar toast:', await toast())
const rect2After = await selectedRect()
check('toolbar-idle', idleToolbar, '按钮恢复可点')
check('toolbar-restored', !!rect2After && restored(rect2After), `${rect2After?.w}×${rect2After?.h}`)
await bar.screenshot({ path: `${OUT}/23-toolbar.png` })

/* --------------------------------------------- 3. 适配面板「自动对齐页面」 */
const broken3 = await breakLayer()
const rect3 = await selectedRect()
check('break-3', !!rect3 && halfOf(rect3), `${rect3?.w}×${rect3?.h}`)
await press(page.locator('.tp-btn', { hasText: /适配|Fit/ }).first())
await sleep(400)
await page.locator('.tp-popover').screenshot({ path: `${OUT}/24-fit-panel.png` })
await press(page.locator('.tp-option--accent'))
await sleep(700)
log('panel toast@0.7s:', await toast())
const idlePanel = await waitIdle()
await sleep(600)
log('panel toast:', await toast())
const rect3After = await selectedRect()
check('panel-idle', idlePanel, '按钮恢复可点')
check('panel-restored', !!rect3After && restored(rect3After), `${rect3After?.w}×${rect3After?.h}`)
await page.keyboard.press('Escape')
await sleep(300)

await page.screenshot({ path: `${OUT}/25-page-after.png` })

const failed = report.checks.filter((item) => !item.ok)
console.log(JSON.stringify({ ok: !failed.length, before, after, failed, out: OUT }, null, 2))

await browser.close()
process.exit(failed.length ? 1 : 0)
