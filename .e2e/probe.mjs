import { chromium } from 'playwright'

const shot = process.argv[2] ?? `${process.cwd()}/.e2e/shots`
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const ctx = browser.contexts()[0]
const page = ctx.pages().find((p) => p.url().includes('127.0.0.1:8123'))
if (!page) throw new Error('tab not found')

await page.setViewportSize({ width: 1440, height: 900 })
await page.bringToFront()
await page.waitForTimeout(600)

const probe = await page.evaluate(() => {
  const host = document.querySelector('tracing-paper-root')
  const shadow = host?.shadowRoot
  return {
    host: !!host,
    shadow: !!shadow,
    toolbar: !!shadow?.querySelector('.tp-toolbar'),
    empty: !!shadow?.querySelector('.tp-empty'),
    styles: shadow?.querySelectorAll('style').length ?? 0,
    layerCount: shadow?.querySelectorAll('.tp-layer').length ?? 0,
    bodyText: shadow?.textContent?.slice(0, 120) ?? '',
  }
})
console.log(JSON.stringify(probe, null, 2))
console.log('errors:', await page.evaluate(() => 0))

await page.screenshot({ path: `${shot}/00-auto-mount.png` })
await browser.close()
