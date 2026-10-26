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

// 每次从干净的存储开始（在扩展页里调用 storage）
const cleaner = await ctx.newPage()
await cleaner.goto(`chrome-extension://${EXT}/popup.html`)
await cleaner.evaluate(() => chrome.storage.local.clear())
await cleaner.close()

const page = ctx.pages().find((p) => p.url().startsWith(SITE)) ?? (await ctx.newPage())
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console: ${message.text()}`)
})
await page.goto(SITE)
await page.setViewportSize({ width: 1440, height: 900 })
await page.bringToFront()
await page.waitForTimeout(500)

const layerBox = async () => {
  const el = page.locator('.tp-layer').first()
  return await el.boundingBox()
}

/* 1. 通过 popup 注入 + 上传 ------------------------------------------------ */
const popup = await ctx.newPage()
popup.on('pageerror', (error) => problems.push(`popup: ${error.message}`))
await popup.setViewportSize({ width: 380, height: 720 })
await popup.goto(`chrome-extension://${EXT}/popup.html`)
await popup.waitForTimeout(600)
await popup.getByRole('button', { name: '开启' }).click()
await popup.waitForTimeout(500)

const [chooser] = await Promise.all([popup.waitForEvent('filechooser'), popup.locator('.uploader').click()])
await chooser.setFiles(`${ROOT}/.e2e/assets/design-desktop.png`)
await popup.waitForTimeout(1500)
await popup.screenshot({ path: `${SHOTS}/10-popup-with-library.png` })

await page.bringToFront()
await page.waitForTimeout(500)
log('inserted box:', JSON.stringify(await layerBox()))
await page.screenshot({ path: `${SHOTS}/11-layer.png` })

/* 2. 拖动 + 吸附参考线 ---------------------------------------------------- */
let box = await layerBox()
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.mouse.down()
await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2 + 40, { steps: 8 })
await page.mouse.move(32 + box.width / 2, box.y + box.height / 2 + 40, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(200)
const afterDrag = await layerBox()
log('after drag x:', Math.round(afterDrag.x), '(期望贴近 0 或吸附中线)')

// 拖到贴近左边缘，触发吸附参考线并截图
box = afterDrag
await page.mouse.move(box.x + box.width / 2, box.y + 60)
await page.mouse.down()
await page.mouse.move(4 + box.width / 2, box.y + 60, { steps: 10 })
await page.waitForTimeout(150)
await page.screenshot({ path: `${SHOTS}/12-snap-guides.png` })
await page.mouse.up()
const snapped = await layerBox()
log('snapped x:', Math.round(snapped.x), 'guides visible while dragging')

/* 3. 8 向缩放（se 手柄 + Shift 锁比例） ---------------------------------- */
box = await layerBox()
await page.mouse.move(box.x + box.width, box.y + box.height)
await page.mouse.down()
await page.mouse.move(box.x + box.width - 150, box.y + box.height - 40, { steps: 10 })
await page.mouse.up()
await page.waitForTimeout(200)
const resized = await layerBox()
log('resized:', Math.round(resized.width), '×', Math.round(resized.height))
await page.screenshot({ path: `${SHOTS}/13-resized.png` })

/* 4. 键盘：方向键微调 + 双击复位 + 数字键透明度 ---------------------------- */
await page.keyboard.press('ArrowRight')
await page.keyboard.press('ArrowRight')
await page.keyboard.press('ArrowRight')
const nudged = await layerBox()
log('nudge dx:', Math.round(nudged.x - resized.x), '(期望 3)')

await page.keyboard.press('4')
await page.keyboard.press('4')
await page.waitForTimeout(150)
const opacityText = await page.locator('.tp-btn__value').first().innerText()
log('two-digit opacity:', opacityText, '(期望 44%)')
await page.screenshot({ path: `${SHOTS}/14-opacity-44.png` })

/* 5. 混合模式差值对比 ---------------------------------------------------- */
await page.locator('.tp-btn', { hasText: '正常' }).first().click()
await page.waitForTimeout(250)
await page.screenshot({ path: `${SHOTS}/15-blend-panel.png` })
await page.locator('.tp-option', { hasText: '差值' }).first().click()
await page.waitForTimeout(200)
const container = await page.evaluate(
  () => document.querySelector('tracing-paper-root')?.shadowRoot?.querySelector('.tp-layer')?.style.mixBlendMode,
)
log('blend applied:', container)
await page.screenshot({ path: `${SHOTS}/16-difference.png` })

/* 6. 尺寸面板 / 图层面板 / 快捷键面板截图 -------------------------------- */
await page.locator('.tp-btn[title="精确位置与尺寸"]').click()
await page.waitForTimeout(250)
await page.screenshot({ path: `${SHOTS}/17-size-panel.png` })
await page.keyboard.press('Escape')
await page.waitForTimeout(150)

await page.locator('.tp-btn[title="图层"]').click()
await page.waitForTimeout(250)
await page.screenshot({ path: `${SHOTS}/18-layers-panel.png` })
await page.keyboard.press('Escape')
await page.waitForTimeout(150)

await page.locator('.tp-btn[title="快捷键"]').click()
await page.waitForTimeout(250)
await page.screenshot({ path: `${SHOTS}/19-help-panel.png` })
await page.keyboard.press('Escape')
await page.waitForTimeout(150)

/* 7. 冻结：点击穿透到页面 ------------------------------------------------ */
await page.keyboard.press('f')
await page.waitForTimeout(250)
await page.screenshot({ path: `${SHOTS}/20-frozen.png` })
const frozenHit = await page.evaluate(() => {
  const el = document.elementFromPoint(window.innerWidth / 2, 300)
  return el?.tagName.toLowerCase() + '.' + (el?.className || '')
})
log('frozen hit test:', frozenHit)
await page.keyboard.press('f')

/* 8. 撤销 / 重做 ---------------------------------------------------------- */
const beforeUndo = await layerBox()
await page.keyboard.press('Meta+z')
await page.keyboard.press('Meta+z')
await page.waitForTimeout(250)
const afterUndo = await layerBox()
log('undo changed box:', Math.round(beforeUndo.x) !== Math.round(afterUndo.x) || Math.round(beforeUndo.width) !== Math.round(afterUndo.width))
await page.keyboard.press('Meta+Shift+z')
await page.waitForTimeout(200)

/* 9. 刷新后按 URL 恢复 ---------------------------------------------------- */
await page.reload()
await page.waitForTimeout(2000)
const restoredCount = await page.evaluate(
  () => document.querySelector('tracing-paper-root')?.shadowRoot?.querySelectorAll('.tp-layer').length ?? 0,
)
log('layers restored after reload:', restoredCount)
await page.screenshot({ path: `${SHOTS}/21-restored.png` })

/* 10. 再开 popup 查看状态 -------------------------------------------------- */
await popup.close()
const popup2 = await ctx.newPage()
await popup2.setViewportSize({ width: 380, height: 720 })
await popup2.goto(`chrome-extension://${EXT}/popup.html`)
await popup2.waitForTimeout(700)
await popup2.screenshot({ path: `${SHOTS}/22-popup-active.png` })
log('popup status:', (await popup2.locator('.status-text').innerText()).replace(/\n/g, ' / '))
await popup2.close()

console.log('PROBLEMS:', problems.length ? JSON.stringify(problems, null, 2) : 'none')
await browser.close()
