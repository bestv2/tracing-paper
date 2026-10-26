import { chromium } from 'playwright'
import fs from 'node:fs'

const EXT = 'ncfglfbdlbdpbdmmpollpedloanbdfnp'
const ROOT = process.cwd()
const SHOTS = `${ROOT}/.e2e/shots`
fs.mkdirSync(SHOTS, { recursive: true })

const log = (...args) => console.log('·', ...args)
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const ctx = browser.contexts()[0]

let page = ctx.pages().find((p) => p.url().includes('127.0.0.1:8123'))
if (!page) {
  page = await ctx.newPage()
  await page.goto('http://127.0.0.1:8123/')
}
await page.setViewportSize({ width: 1440, height: 900 })
await page.bringToFront()
await page.waitForTimeout(400)

/* ---------------------------------------------------------------- popup */
const popup = await ctx.newPage()
await popup.setViewportSize({ width: 380, height: 720 })
await popup.goto(`chrome-extension://${EXT}/popup.html`)
await popup.waitForTimeout(700)
await popup.screenshot({ path: `${SHOTS}/01-popup-idle.png` })
log('popup idle captured')

const status = await popup.locator('.status-text').innerText()
log('popup status:', status.replace(/\n/g, ' / '))

await popup.getByRole('button', { name: '开启' }).click()
await popup.waitForTimeout(700)
await popup.screenshot({ path: `${SHOTS}/02-popup-on.png` })
log('popup after enable:', (await popup.locator('.status-text').innerText()).replace(/\n/g, ' / '))

/* ------------------------------------------------------- 插入设计稿 */
const [chooser] = await Promise.all([
  popup.waitForEvent('filechooser'),
  popup.locator('.uploader').click(),
])
await chooser.setFiles(`${ROOT}/.e2e/assets/design-desktop.png`)
await popup.waitForTimeout(1400)
await popup.screenshot({ path: `${SHOTS}/03-popup-library.png` })
log('insert result:', (await popup.locator('.notice').innerText().catch(() => '(no notice)')).trim())

await page.bringToFront()
await page.waitForTimeout(700)
const layerCount = await page.evaluate(
  () => document.querySelector('tracing-paper-root')?.shadowRoot?.querySelectorAll('.tp-layer').length ?? 0,
)
log('layers on page:', layerCount)
await page.screenshot({ path: `${SHOTS}/04-page-inserted.png` })

console.log(JSON.stringify({ ok: true }))
await browser.close()
