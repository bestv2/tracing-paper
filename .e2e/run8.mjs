/**
 * 扩展侧比对验证：
 * 1. 干净路径 —— 用页面自身截图当设计稿，期望 0 条结论
 * 2. 真实路径 —— 手绘设计稿 vs 真页面，验证 DOM 归因、面板、导出
 */

import { chromium } from 'playwright'
import fs from 'node:fs'

const EXT = 'ncfglfbdlbdpbdmmpollpedloanbdfnp'
const ROOT = process.cwd()
const SHOTS = `${ROOT}/.e2e/shots`
const OUT = `${ROOT}/.e2e/extension-report`
const SITE = 'http://127.0.0.1:8123/'
const SELF = `${ROOT}/.e2e/fixtures/page-self.png`
const MOCK = `${ROOT}/.e2e/assets/design-desktop.png`

fs.mkdirSync(SHOTS, { recursive: true })
fs.mkdirSync(OUT, { recursive: true })

const log = (...args) => console.log('·', ...args)
const problems = []
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const ctx = browser.contexts()[0]

/* 0. 让新构建生效 */
const reloader = await ctx.newPage()
await reloader.goto(`chrome-extension://${EXT}/popup.html`)
await reloader.evaluate(() => chrome.runtime.reload()).catch(() => {})
await wait(1500)
await reloader.close().catch(() => {})

const cleaner = await ctx.newPage()
await cleaner.goto(`chrome-extension://${EXT}/popup.html`)
await cleaner.evaluate(() => chrome.storage.local.clear())
await cleaner.close()

/* 1. 打开站点 */
const page = ctx.pages().find((p) => p.url().startsWith(SITE)) ?? (await ctx.newPage())
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
page.on('console', (message) => message.type() === 'error' && problems.push(`console: ${message.text()}`))

/**
 * 真实窗口尺寸（不用 setViewportSize）：
 * 视口模拟会让 innerWidth 与 captureVisibleTab 的实际宽度脱钩，几何对不上。
 */
const setWindowSize = async (width, height) => {
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {})
  for (let i = 0; i < 5; i += 1) {
    const metric = await page.evaluate(() => ({
      iw: innerWidth,
      ih: innerHeight,
      ow: outerWidth,
      oh: outerHeight,
    }))
    if (Math.abs(metric.iw - width) <= 1 && Math.abs(metric.ih - height) <= 1) break
    const { windowId } = await cdp.send('Browser.getWindowForTarget')
    await cdp.send('Browser.setWindowBounds', {
      windowId,
      bounds: {
        width: width + (metric.ow - metric.iw),
        height: height + (metric.oh - metric.ih),
        windowState: 'normal',
      },
    })
    await wait(450)
  }
  return page.evaluate(() => ({ iw: innerWidth, ih: innerHeight, dpr: devicePixelRatio, ow: outerWidth, oh: outerHeight }))
}

await page.goto(SITE)
await page.bringToFront()
await wait(700)
log('window', JSON.stringify(await setWindowSize(1440, 900)))
await page.goto(SITE)
await page.bringToFront()
await wait(800)

const openPopup = async () => {
  const popup = await ctx.newPage()
  await popup.setViewportSize({ width: 360, height: 620 })
  await popup.goto(`chrome-extension://${EXT}/popup.html`)
  await popup.waitForTimeout(400)
  return popup
}

const popup = await openPopup()
await popup.getByRole('button', { name: '开启', exact: true }).click()
await popup.waitForTimeout(700)
await popup.close()

const upload = async (file) => {
  const popup = await openPopup()
  const [chooser] = await Promise.all([popup.waitForEvent('filechooser'), popup.locator('.uploader').click()])
  await chooser.setFiles(file)
  await popup.waitForTimeout(1600)
  const count = await popup.evaluate(() => document.body.innerText.match(/(\d+)\s*个图层/)?.[1] ?? '?')
  await popup.close()
  await wait(600)
  return count
}

const clearLayers = async () => {
  const popup = await openPopup()
  const clear = popup.getByRole('button', { name: '清空本页' })
  if (await clear.count()) await clear.click()
  await popup.waitForTimeout(500)
  await popup.close()
  await wait(500)
}

const reportState = () =>
  page.evaluate(() => {
    const root = document.querySelector('tracing-paper-root')?.shadowRoot
    const panel = root?.querySelector('.tracing-report')
    const rows = [...(root?.querySelectorAll('.tracing-report__row') ?? [])].map((row) =>
      row.textContent.replace(/\s+/g, ' ').trim(),
    )
    return {
      mounted: !!root,
      panel: !!panel,
      title: panel?.querySelector('.tracing-report__title b')?.textContent?.trim() ?? null,
      meta: panel?.querySelector('.tracing-report__meta')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      legend: panel?.querySelector('.tracing-report__legend')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      busy: !!panel?.querySelector('.tracing-report__busy'),
      toast: root?.querySelector('.tp-toast')?.textContent ?? null,
      rows,
      focus: root?.querySelector('.tracing-report__row[data-active="true"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      detail: root?.querySelector('.tracing-report__facts')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      crops: [...(root?.querySelectorAll('.tp-crops img') ?? [])].length,
      markers: [...(root?.querySelectorAll('.tp-marker') ?? [])].length,
    }
  })

const runCompare = async () => {
  await page.locator('.tp-btn--diff').click()
  for (let i = 0; i < 60; i += 1) {
    await wait(500)
    const state = await reportState()
    if (!state.panel || state.busy) continue
    if (state.title === '视觉比对' || state.title === '正在比对…') {
      if (state.toast) throw new Error(`比对失败：${state.toast}`)
      continue
    }
    return state
  }
  throw new Error('比对超时')
}

/* 2. 干净路径：隐藏浮层截一张页面图，再把它当设计稿 */
await clearLayers()
await page.evaluate(() => {
  const host = document.querySelector('tracing-paper-root')
  if (host) host.style.setProperty('display', 'none', 'important')
})
await page.waitForTimeout(250)
await page.screenshot({ path: SELF })
await page.evaluate(() => {
  const host = document.querySelector('tracing-paper-root')
  if (host) host.style.removeProperty('display')
})
await page.waitForTimeout(300)
const size = await page.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio }))
log('viewport', JSON.stringify(size))

log('layers after self upload:', await upload(SELF))
await page.bringToFront()
await page.keyboard.press('Alt+4')
await page.waitForTimeout(500)

const clean = await runCompare()
log('clean:', JSON.stringify({ title: clean.title, meta: clean.meta, rows: clean.rows.slice(0, 4) }))
await page.screenshot({ path: `${SHOTS}/90-diff-clean.png` })

/* 3. 真实路径：换成手绘设计稿 */
await page.keyboard.press('Escape')
await clearLayers()
log('layers after mock upload:', await upload(MOCK))
await page.bringToFront()
await page.keyboard.press('Alt+4')
await page.waitForTimeout(500)

const changed = await runCompare()
log('changed:', JSON.stringify({ title: changed.title, meta: changed.meta, legend: changed.legend }, null, 2))
log('rows:', JSON.stringify(changed.rows.slice(0, 6), null, 2))
log('markers', changed.markers, 'crops', changed.crops, 'focus', changed.focus)
await page.screenshot({ path: `${SHOTS}/91-diff-panel.png` })

/* 4. 聚焦第一条：放大差异图 + 切片 */
await page.locator('.tracing-report__preview').click()
await page.waitForTimeout(300)
await page.locator('.tracing-report__row').first().click()
await page.waitForTimeout(400)
const focused = await reportState()
log('focused:', JSON.stringify({ focus: focused.focus, detail: focused.detail, crops: focused.crops }))
await page.screenshot({ path: `${SHOTS}/92-diff-focus.png` })

/* 5. 导出 JSON / MD / PNG */
const exportChip = async (index, name) => {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.locator(`.tracing-report__exports > .tp-chip`).nth(index).click(),
  ])
  const target = `${OUT}/${name}`
  await download.saveAs(target)
  return { name, size: fs.statSync(target).size }
}
log('export json', JSON.stringify(await exportChip(0, 'report.json')))
log('export md', JSON.stringify(await exportChip(1, 'report.md')))
log('export sarif', JSON.stringify(await exportChip(2, 'report.sarif')))
log('export png', JSON.stringify(await exportChip(3, 'diff.png')))

const report = JSON.parse(fs.readFileSync(`${OUT}/report.json`, 'utf8'))
const attributed = report.findings.filter((finding) => finding.element?.selector).length
log(
  'report',
  JSON.stringify({
    schema: report.schemaVersion,
    mode: report.tool.mode,
    verdict: report.summary.verdict,
    findings: report.summary.findings,
    byKind: report.summary.byKind,
    bySeverity: report.summary.bySeverity,
    attributed: `${attributed}/${report.findings.length}`,
    artifacts: report.artifacts,
    inputs: report.inputs,
    notes: report.notes,
  }),
)
log('first findings:', JSON.stringify(report.findings.slice(0, 3), null, 2))

console.log('PROBLEMS:', problems.length ? JSON.stringify(problems.slice(0, 10), null, 2) : 'none')
process.exit(0)
