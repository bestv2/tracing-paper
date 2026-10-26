import { chromium } from 'playwright'
import fs from 'node:fs'

const EXT = 'ncfglfbdlbdpbdmmpollpedloanbdfnp'
const ROOT = process.cwd()
const SITE = 'http://127.0.0.1:8123/'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const ctx = browser.contexts()[0]

/* 清空场景，确保新页面不会自动挂 overlay */
const cleaner = await ctx.newPage()
await cleaner.goto(`chrome-extension://${EXT}/popup.html`)
await cleaner.evaluate(() => chrome.storage.local.clear())
await cleaner.close()

const page = await ctx.newPage()
await page.setViewportSize({ width: 1440, height: 900 })
await page.goto(SITE)
await page.waitForTimeout(700)
await page.screenshot({ path: `${ROOT}/.e2e/shots/actual-1440.png` })

const mounted = await page.evaluate(() => Boolean(document.querySelector('tracing-paper-root')?.shadowRoot))
console.log('overlay mounted:', mounted, 'size:', fs.statSync(`${ROOT}/.e2e/shots/actual-1440.png`).size)
await page.close()
await browser.close()
