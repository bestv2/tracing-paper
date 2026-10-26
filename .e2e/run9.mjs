import { chromium } from 'playwright'

const EXT = 'ncfglfbdlbdpbdmmpollpedloanbdfnp'
const ROOT = process.cwd()
const SITE = 'http://127.0.0.1:8123/'
const SELF = `${ROOT}/.e2e/fixtures/page-self.png`

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const ctx = browser.contexts()[0]

const page = ctx.pages().find((p) => p.url().startsWith(SITE)) ?? (await ctx.newPage())
page.on('console', (m) => console.log('[page]', m.type(), m.text().slice(0, 200)))
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.setViewportSize({ width: 1440, height: 900 })
await page.goto(SITE)
await page.bringToFront()
await wait(800)

const popup = await ctx.newPage()
await popup.setViewportSize({ width: 360, height: 640 })
await popup.goto(`chrome-extension://${EXT}/popup.html`)
await popup.waitForTimeout(500)
console.log('status:', (await popup.locator('.status').innerText()).replace(/\s+/g, ' '))

const toggle = popup.locator('button.toggle')
if ((await toggle.innerText()).includes('开启')) {
  await toggle.click()
  await popup.waitForTimeout(700)
}
console.log('after toggle:', (await popup.locator('.status').innerText()).replace(/\s+/g, ' '))

const [chooser] = await Promise.all([popup.waitForEvent('filechooser'), popup.locator('.uploader').click()])
await chooser.setFiles(SELF)
await popup.waitForTimeout(2000)
console.log('after upload:', (await popup.locator('.status').innerText()).replace(/\s+/g, ' '))
console.log('notice:', await popup.locator('.notice').innerText().catch(() => 'none'))
await popup.close()

await page.bringToFront()
await wait(600)
console.log(
  'layers:',
  await page.evaluate(() => {
    const root = document.querySelector('tracing-paper-root')?.shadowRoot
    return [...(root?.querySelectorAll('.tp-layer') ?? [])].map((el) => {
      const b = el.getBoundingClientRect()
      const img = el.querySelector('img')
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), src: img?.src.slice(0, 24) }
    })
  }),
)

await page.keyboard.press('Alt+4')
await wait(500)
console.log(
  'after alt+4:',
  await page.evaluate(() => {
    const root = document.querySelector('tracing-paper-root')?.shadowRoot
    return [...(root?.querySelectorAll('.tp-layer') ?? [])].map((el) => {
      const b = el.getBoundingClientRect()
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
    })
  }),
)

await page.locator('.tp-btn--diff').click()
await wait(600)
console.log(
  'panel:',
  await page.evaluate(() => {
    const root = document.querySelector('tracing-paper-root')?.shadowRoot
    const toast = root?.querySelector('.tp-toast')?.textContent
    const report = root?.querySelector('.tracing-report')?.textContent?.replace(/\s+/g, ' ').slice(0, 200)
    return { toast, report, busy: !!root?.querySelector('.tracing-report__busy') }
  }),
)
await wait(6000)
console.log(
  'panel later:',
  await page.evaluate(() => {
    const root = document.querySelector('tracing-paper-root')?.shadowRoot
    return {
      toast: root?.querySelector('.tp-toast')?.textContent,
      title: root?.querySelector('.tracing-report__title b')?.textContent,
      meta: root?.querySelector('.tracing-report__meta')?.textContent,
      busy: !!root?.querySelector('.tracing-report__busy'),
      rows: [...(root?.querySelectorAll('.tracing-report__row') ?? [])].length,
    }
  }),
)
process.exit(0)
