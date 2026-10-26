/**
 * 界面验收：收起重开 / 基准自检 / 结果失效 / 大图查看 / 纸墨视觉
 * 用法：node .e2e/restyle-check.mjs
 *
 * 用真实扩展跑：先截一张干净页面当设计稿，再上传、比对，
 * 让基准自检走一遍「偏移 → 一键对齐 → 可信」的完整链路。
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const EXT = 'ncfglfbdlbdpbdmmpollpedloanbdfnp'
const ROOT = process.cwd()
const SITE = 'http://127.0.0.1:8123/'
const DESIGN = `${ROOT}/.e2e/fixtures/self-live.png`
const OUT = `${ROOT}/.e2e/shots`
mkdirSync(OUT, { recursive: true })

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const ctx = browser.contexts()[0]

// 重载扩展，确保跑的是刚构建的 dist
const admin = await ctx.newPage()
await admin.goto(`chrome-extension://${EXT}/popup.html`)
await admin.evaluate(() => chrome.runtime.reload()).catch(() => {})
await wait(2500)
await admin.close().catch(() => {})

let page = ctx.pages().find((p) => p.url().startsWith(SITE))
page = page ?? (await ctx.newPage())
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.goto(SITE)
await page.bringToFront()
await wait(1200)

// 清掉上一轮的图层：先卸载页面（否则旧实例在 pagehide 时会把场景写回），再清空存储。
// 重载扩展后旧的 popup 上下文已失效，必须重新开一个页面才拿得到 storage。
await page.goto('about:blank')
const cleaner = await ctx.newPage()
await cleaner.goto(`chrome-extension://${EXT}/popup.html`)
await cleaner.evaluate(() => chrome.storage.local.clear()).catch(() => {})
await cleaner.close().catch(() => {})
await page.goto(SITE)
await page.bringToFront()
await wait(1500)

// DevTools 的元素检查高亮会整屏染色并叠一行尺寸标签，截图前必须关掉
const cdp = await ctx.newCDPSession(page)
await cdp.send('Overlay.disable').catch(() => {})

const viewport = await page.evaluate(() => ({
  w: innerWidth,
  h: innerHeight,
  dpr: devicePixelRatio,
  layers: document.querySelector('tracing-paper-root')?.shadowRoot?.querySelectorAll('.tp-layer').length ?? 0,
}))
console.log('viewport:', viewport)

// 1. 截一张干净页面当设计稿（隐藏浮层，和扩展抓图时一致）
// host 自带 display:block !important，隐藏必须同样带 important，否则浮层会进画面
await page.evaluate(() => {
  const hosts = [...document.querySelectorAll('tracing-paper-root')]
  window.__tpStyle = hosts.map((h) => h.getAttribute('style'))
  hosts.forEach((h) => h.style.setProperty('display', 'none', 'important'))
})
await wait(400)
await page.screenshot({ path: DESIGN })
await page.evaluate(() => {
  const hosts = [...document.querySelectorAll('tracing-paper-root')]
  hosts.forEach((h, i) => {
    const saved = window.__tpStyle?.[i]
    if (saved == null) h.removeAttribute('style')
    else h.setAttribute('style', saved)
  })
})
console.log('design captured:', DESIGN)

const ask = (fn) => page.evaluate(fn)
const shadowInfo = () =>
  ask(() => {
    const s = document.querySelector('tracing-paper-root')?.shadowRoot
    const txt = (q) => s?.querySelector(q)?.textContent?.replace(/\s+/g, ' ').trim() ?? null
    const layers = [...(s?.querySelectorAll('.tp-layer') ?? [])].map((el) => {
      const b = el.getBoundingClientRect()
      return `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}`
    })
    return {
      toolbar: !!s?.querySelector('.tp-toolbar'),
      mini: !!s?.querySelector('.tp-mini'),
      title: txt('.tp-report__title b'),
      verdict: s?.querySelector('.tp-baseline')?.dataset.verdict ?? null,
      baseline: txt('.tp-baseline'),
      stale: txt('.tp-stale'),
      meta: txt('.tp-report__meta'),
      rows: (s?.querySelectorAll('.tp-report__row') ?? []).length,
      layers,
    }
  })

// 2. 上传设计稿
const popup = await ctx.newPage()
await popup.goto(`chrome-extension://${EXT}/popup.html`)
await popup.waitForTimeout(400)
const toggle = popup.locator('button.toggle')
if ((await toggle.innerText()).includes('开启')) {
  await toggle.click()
  await popup.waitForTimeout(700)
}
const [chooser] = await Promise.all([popup.waitForEvent('filechooser'), popup.locator('.uploader').click()])
await chooser.setFiles(DESIGN)
await popup.waitForTimeout(2000)
await popup.close()
await page.bringToFront()
await wait(800)
console.log('uploaded:', (await shadowInfo()).layers)

// 3. 收起 / 展开
await page.keyboard.press('Shift+F')
await wait(400)
console.log('collapsed:', { toolbar: (await shadowInfo()).toolbar, mini: (await shadowInfo()).mini })
await page.screenshot({ path: `${OUT}/collapsed.png` })
await page.locator('.tp-mini').click()
await wait(500)
console.log('restored by mini:', (await shadowInfo()).toolbar)
await page.keyboard.press('Shift+F')
await wait(400)
await page.keyboard.press('Shift+F')
await wait(400)
console.log('restored by shortcut:', (await shadowInfo()).toolbar)

// 4. 比对：图层只有 90%，基准应判「偏移」
await page.locator('.tp-btn--diff').click()
await wait(9000)
const first = await shadowInfo()
console.log('first diff:', first)
await page.screenshot({ path: `${OUT}/report-drift.png` })

// 5. 大图：单张（差异总览图）
if (await page.locator('.tp-report__preview').count()) {
  await page.locator('.tp-report__preview').click()
  await wait(600)
  console.log(
    'lightbox:',
    await ask(() => {
      const s = document.querySelector('tracing-paper-root')?.shadowRoot
      const lb = s?.querySelector('.tp-lightbox')
      const img = lb?.querySelector('img')?.getBoundingClientRect()
      return {
        open: !!lb,
        label: lb?.querySelector('.tp-lightbox__label')?.textContent,
        size: img ? `${Math.round(img.width)}x${Math.round(img.height)}` : null,
      }
    }),
  )
  await page.screenshot({ path: `${OUT}/lightbox.png` })
  // 倍率：4× 后图片应明显变大（小图也能放大读细节）
  await page.locator('.tp-lightbox__zoom').last().click()
  await wait(400)
  console.log(
    'zoom 4x:',
    await ask(() => {
      const s = document.querySelector('tracing-paper-root')?.shadowRoot
      const stage = s?.querySelector('.tp-lightbox__stage')
      const img = s?.querySelector('.tp-lightbox__one img')?.getBoundingClientRect()
      return { zoom: stage?.style.getPropertyValue('--lb-zoom'), w: img ? Math.round(img.width) : null }
    }),
  )
  await page.locator('.tp-lightbox__zoom').first().click()
  await wait(200)
  await page.keyboard.press('Escape')
  await wait(400)
  console.log('lightbox closed:', await ask(() => !document.querySelector('tracing-paper-root')?.shadowRoot?.querySelector('.tp-lightbox')))
}

// 6. 大图：三联并排（有差异行时才有裁剪图）
const crops = await ask(() => document.querySelector('tracing-paper-root')?.shadowRoot?.querySelectorAll('.tp-crop').length ?? 0)
console.log('crops:', crops)
console.log(
  'crop sizes:',
  await ask(() =>
    [...(document.querySelector('tracing-paper-root')?.shadowRoot?.querySelectorAll('.tp-crop img') ?? [])].map(
      (img) => `${img.naturalWidth}x${img.naturalHeight}`,
    ),
  ),
)
if (crops) {
  await page.locator('.tp-crop').first().click()
  await wait(600)
  console.log(
    'crops lightbox:',
    await ask(() => {
      const s = document.querySelector('tracing-paper-root')?.shadowRoot
      const lb = s?.querySelector('.tp-lightbox')
      return {
        side: !!lb?.querySelector('.tp-lightbox__side'),
        tiles: [...(lb?.querySelectorAll('.tp-lightbox__side figcaption') ?? [])].map((el) => el.textContent),
        pager: lb?.querySelectorAll('.tp-lightbox__pager button').length ?? 0,
      }
    }),
  )
  await page.screenshot({ path: `${OUT}/lightbox-crops.png` })
  await page.keyboard.press('ArrowRight')
  await wait(400)
  console.log(
    'after arrow:',
    await ask(() => {
      const s = document.querySelector('tracing-paper-root')?.shadowRoot
      return [...(s?.querySelectorAll('.tp-lightbox__side figure') ?? [])].findIndex(
        (f) => f.dataset.active === 'true',
      )
    }),
  )
  await page.keyboard.press('Escape')
  await wait(300)
}

// 7. 一键对齐重比
if (await page.locator('.tp-baseline__fix').count()) {
  await page.locator('.tp-baseline__fix').click()
  await wait(12000)
  console.log('after align:', await shadowInfo())
  await page.screenshot({ path: `${OUT}/report-aligned.png` })
} else {
  console.log('!! 没有出现「对齐并重比」按钮')
}

// 8. 挪动图层 → 结果失效
await page.keyboard.press('ArrowRight')
await page.keyboard.press('ArrowRight')
await wait(500)
console.log('stale:', (await shadowInfo()).stale)
await page.screenshot({ path: `${OUT}/report-stale.png` })

// 9. 深色
await ask(() => {
  document.querySelector('tracing-paper-root')?.shadowRoot?.querySelector('.tp-root')?.setAttribute('data-theme', 'dark')
})
await wait(400)
await page.screenshot({ path: `${OUT}/dark.png` })

console.log('done')
process.exit(0)
