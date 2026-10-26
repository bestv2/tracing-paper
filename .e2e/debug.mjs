import { chromium } from 'playwright'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const ctx = browser.contexts()[0]
const page = ctx.pages().find((p) => p.url().includes('127.0.0.1:8123'))
await page.bringToFront()
await page.setViewportSize({ width: 1440, height: 900 })
await page.waitForTimeout(400)

const info = await page.evaluate(() => {
  const shadow = document.querySelector('tracing-paper-root')?.shadowRoot
  const layer = shadow?.querySelector('.tp-layer')
  const handles = [...(shadow?.querySelectorAll('.tp-handle') ?? [])]
  const box = layer?.getBoundingClientRect()
  const se = handles.find((h) => h.getAttribute('data-handle') === 'se')
  const seBox = se?.getBoundingClientRect()
  const at = seBox ? document.elementFromPoint(seBox.x + seBox.width / 2, seBox.y + seBox.height / 2) : null
  return {
    layer: box && { x: box.x, y: box.y, w: box.width, h: box.height },
    handles: handles.map((h) => h.getAttribute('data-handle')),
    se: seBox && { x: seBox.x, y: seBox.y, w: seBox.width, h: seBox.height },
    hit: at && at.tagName + '.' + at.className + '|' + (at.getAttribute('data-handle') ?? ''),
    vw: innerWidth,
    vh: innerHeight,
  }
})
console.log(JSON.stringify(info, null, 2))

const se = info.se
if (se) {
  const cx = se.x + se.w / 2
  const cy = se.y + se.h / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx - 200, cy - 100, { steps: 12 })
  await page.waitForTimeout(120)
  const mid = await page.evaluate(() => {
    const layer = document.querySelector('tracing-paper-root')?.shadowRoot?.querySelector('.tp-layer')
    const b = layer?.getBoundingClientRect()
    return { w: b?.width, h: b?.height }
  })
  console.log('during resize:', JSON.stringify(mid))
  await page.mouse.up()
  const after = await page.evaluate(() => {
    const layer = document.querySelector('tracing-paper-root')?.shadowRoot?.querySelector('.tp-layer')
    const b = layer?.getBoundingClientRect()
    return { x: b?.x, y: b?.y, w: b?.width, h: b?.height }
  })
  console.log('after resize:', JSON.stringify(after))
  await page.screenshot({ path: `${process.cwd()}/.e2e/shots/30-resize-debug.png` })
}
await browser.close()
