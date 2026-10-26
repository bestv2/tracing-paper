#!/usr/bin/env node
/**
 * 商店素材生成（零依赖，用 Node 22 内置 WebSocket 直连 CDP）。
 *
 * 做两件事：
 * 1. 用 headless Chromium 加载 dist 扩展，在 .e2e/site 演示页上真实走一遍
 *    「插入设计稿 → 叠加 → 图层面板 → 像素比对」，截取 2× 原图；
 * 2. 把原图合成 1280×800 的商店截图（Chrome / Edge 通用），并输出
 *    440×280 小型推广图、1400×560 顶部大图与各尺寸商店图标。
 *
 * 用法：npm run store:assets
 * 产物：store/assets/{screenshots,promo,icons}
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join, normalize, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const BUILD = resolve(root, 'store/.build')
const RAW = resolve(BUILD, 'raw')
const SLIDES = resolve(BUILD, 'slides')
const OUT = resolve(root, 'store/assets')
const DESIGN = resolve(root, '.e2e/assets/design-desktop.png')
const PORT = 8123
const DEBUG_PORT = 9333

const wait = (ms) => new Promise((done) => setTimeout(done, ms))

/* ------------------------------------------------------------------ 浏览器 */

const BROWSERS = [
  process.env.TP_BROWSER,
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean)

const browserBin = BROWSERS.find((path) => existsSync(path))
if (!browserBin) {
  console.error('✗ 找不到 Chromium 内核浏览器（Edge / Chrome），可用 TP_BROWSER 指定路径')
  process.exit(1)
}

/** 扩展 ID 由解压目录的绝对路径派生，和浏览器分配规则一致 */
function extensionId(dir) {
  const hex = createHash('sha256').update(dir, 'utf8').digest('hex').slice(0, 32)
  return [...hex].map((char) => String.fromCharCode(97 + Number.parseInt(char, 16))).join('')
}

/* --------------------------------------------------------------- 静态服务器 */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
}

async function startServer(dir) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0])
    const file = join(dir, normalize(path.endsWith('/') ? `${path}index.html` : path).replace(/^\/+/, ''))
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404)
      res.end('not found')
    }
  })
  await new Promise((done) => server.listen(PORT, '127.0.0.1', done))
  return server
}

/* --------------------------------------------------------------- CDP client */

class Cdp {
  constructor(socket) {
    this.socket = socket
    this.nextId = 0
    this.pending = new Map()
    this.waiters = []
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id && this.pending.has(message.id)) {
        this.pending.get(message.id)(message)
        this.pending.delete(message.id)
      }
      for (const waiter of [...this.waiters]) {
        if (waiter.test(message)) {
          this.waiters.splice(this.waiters.indexOf(waiter), 1)
          waiter.resolve(message)
        }
      }
    })
  }

  static async connect(port) {
    let info
    for (let i = 0; i < 80; i++) {
      try {
        info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
        break
      } catch {
        await wait(250)
      }
    }
    if (!info) throw new Error('浏览器调试端口未就绪')
    const socket = new WebSocket(info.webSocketDebuggerUrl)
    await new Promise((done, fail) => {
      socket.addEventListener('open', done)
      socket.addEventListener('error', fail)
    })
    return new Cdp(socket)
  }

  send(method, params = {}, sessionId) {
    const id = ++this.nextId
    return new Promise((done, fail) => {
      this.pending.set(id, (message) => {
        if (message.error) fail(new Error(`${method}: ${message.error.message}`))
        else done(message.result)
      })
      this.socket.send(JSON.stringify({ id, method, params, sessionId }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          fail(new Error(`${method} 超时`))
        }
      }, 30_000)
    })
  }

  waitFor(test, timeout = 20_000) {
    return new Promise((done, fail) => {
      const waiter = { test, resolve: done }
      this.waiters.push(waiter)
      setTimeout(() => {
        const index = this.waiters.indexOf(waiter)
        if (index >= 0) this.waiters.splice(index, 1)
        fail(new Error('等待事件超时'))
      }, timeout)
    })
  }

  async attach(targetId) {
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true })
    const client = this
    return {
      sessionId,
      targetId,
      send: (method, params) => client.send(method, params, sessionId),
      async eval(expression) {
        const { result, exceptionDetails } = await client.send(
          'Runtime.evaluate',
          { expression, awaitPromise: true, returnByValue: true },
          sessionId,
        )
        if (exceptionDetails) throw new Error(exceptionDetails.text ?? '页面脚本执行失败')
        return result?.value
      },
      async viewport(width, height, scale = 1) {
        await client.send(
          'Emulation.setDeviceMetricsOverride',
          { width, height, deviceScaleFactor: scale, mobile: false },
          sessionId,
        )
      },
      async shot(file) {
        const { data } = await client.send('Page.captureScreenshot', { format: 'png' }, sessionId)
        writeFileSync(file, Buffer.from(data, 'base64'))
        return file
      },
    }
  }

  async open(url) {
    const { targetId } = await this.send('Target.createTarget', { url })
    const page = await this.attach(targetId)
    await page.send('Page.enable')
    return page
  }
}

/* ------------------------------------------------------------------- 流程 */

const extDir = resolve(root, 'dist')
if (!existsSync(join(extDir, 'manifest.json'))) {
  console.error('✗ 需要先构建 Chrome 产物：npm run build:chrome')
  process.exit(1)
}

rmSync(BUILD, { recursive: true, force: true })
for (const dir of [RAW, SLIDES, OUT, join(OUT, 'icons'), join(OUT, 'screenshots'), join(OUT, 'promo')]) {
  mkdirSync(dir, { recursive: true })
}

const server = await startServer(resolve(root, '.e2e/site'))
const profile = mkdtempSync(join(tmpdir(), 'tp-store-'))
const browser = spawn(
  browserBin,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--window-size=1440,900',
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const cdp = await Cdp.connect(DEBUG_PORT)
const extId = extensionId(extDir)
const log = (...args) => console.log('·', ...args)

const raw = {}
try {
  /* 1. 演示页 + popup */
  const page = await cdp.open(`http://127.0.0.1:${PORT}/`)
  await page.viewport(1440, 900, 2)
  await wait(900)

  const popup = await cdp.open(`chrome-extension://${extId}/popup.html`)
  await popup.viewport(380, 720, 2)
  await wait(800)

  /** 在页面 shadow DOM 里按 selector / aria-label 点按钮 */
  const clickShadow = (label) => `(() => {
    const root = document.querySelector('tracing-paper-root')?.shadowRoot
    const buttons = root?.querySelectorAll('button') ?? []
    const target = [...buttons].find((node) =>
      (node.getAttribute('aria-label') || '').includes(${JSON.stringify(label)}) ||
      (node.dataset.tip || '').includes(${JSON.stringify(label)}),
    )
    if (!target) return 'missing'
    target.click()
    return 'ok'
  })()`
  log('popup 语言：', await popup.eval(`document.body.innerText.slice(0, 40).replace(/\\s+/g, ' ')`))

  await popup.eval(`document.querySelector('.toggle')?.click()`)
  await wait(1000)

  /* 2. 插入设计稿（隐藏的 file input 直接塞文件） */
  const { root: domRoot } = await popup.send('DOM.getDocument')
  const { nodeId } = await popup.send('DOM.querySelector', {
    nodeId: domRoot.nodeId,
    selector: '.input-file',
  })
  if (!nodeId) throw new Error('找不到文件输入框')
  await popup.send('DOM.setFileInputFiles', { files: [DESIGN], nodeId })
  await wait(2200)
  log('插入后状态：', await popup.eval(`document.querySelector('.status-text')?.innerText.replace(/\\s+/g, ' ')`))

  raw.popup = await popup.shot(join(RAW, 'popup.png'))
  log('截图 popup')

  /* 把透明度调到 55%，截出来的叠加效果更像「描图纸」 */
  await popup.eval(`(() => {
    const slider = document.querySelector('input[type="range"]')
    if (!slider) return 'missing'
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(slider, '55')
    slider.dispatchEvent(new Event('input', { bubbles: true }))
    return slider.value
  })()`)
  await wait(500)
  raw.popup = await popup.shot(join(RAW, 'popup.png'))

  /* 3. 页面叠加：先让设计稿自动对齐页面，叠出来的效果更干净 */
  await cdp.send('Target.activateTarget', { targetId: page.targetId })
  await wait(800)
  log('自动对齐：', await page.eval(clickShadow('自动缩放')))
  await wait(2600)
  raw.overlay = await page.shot(join(RAW, 'overlay.png'))
  log('截图 叠加')

  /* 4. 图层面板：点工具栏按钮（在 shadow DOM 内） */
  if ((await page.eval(clickShadow('图层列表'))) === 'ok') {
    await wait(700)
    raw.layers = await page.shot(join(RAW, 'layers.png'))
    log('截图 图层')
    await page.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
    await wait(400)
  } else {
    log('跳过图层截图：找不到按钮')
  }

  /* 5. 关闭 popup，让页面成为可见标签页后再比对（captureVisibleTab 只能拍可见页） */
  await cdp.send('Target.closeTarget', { targetId: popup.targetId })
  await cdp.send('Target.activateTarget', { targetId: page.targetId })
  await wait(800)

  /* 先选中图层：没有选中图层时快捷键会被忽略 */
  const clickShadowSelector = (selector) => `(() => {
    const root = document.querySelector('tracing-paper-root')?.shadowRoot
    const node = root?.querySelector(${JSON.stringify(selector)})
    if (!node) return 'missing'
    node.click()
    return 'ok'
  })()`

  if ((await page.eval(clickShadowSelector('button.tp-btn--diff'))) !== 'ok') {
    log('找不到比对按钮')
  }

  let diffState = 'none'
  for (let i = 0; i < 30; i++) {
    await wait(500)
    diffState = await page.eval(`(() => {
      const report = document.querySelector('tracing-paper-root')?.shadowRoot?.querySelector('.tp-report')
      if (!report) return 'none'
      if (report.querySelector('.tp-report__busy')) return 'busy'
      if (report.querySelector('.tp-report__empty')) return 'empty'
      return 'done'
    })()`)
    if (diffState === 'done' || diffState === 'empty') break
  }
  const diffReady = diffState === 'done'
  if (diffState === 'empty') log('比对没有产出结果（headless 下 captureVisibleTab 可能不可用）')
  if (diffState === 'none') log('比对面板没有打开')
  if (diffReady) {
    await wait(600)
    raw.diff = await page.shot(join(RAW, 'diff.png'))
    log('截图 比对')
  } else {
    log('比对未完成，跳过比对截图（headless 下 captureVisibleTab 可能不可用）')
  }
} finally {
  browser.kill()
  server.close()
}

/* --------------------------------------------------------------- 合成素材 */

const ink = '#211d17'
const paper = '#f6f1e6'
const accent = '#bf3f27'
const mono = "ui-monospace, 'SF Mono', 'Menlo', monospace"
const sans = "-apple-system, 'PingFang SC', 'Hiragino Sans GB', sans-serif"
const serif = "'Songti SC', 'Noto Serif SC', Georgia, serif"

/** 截图幻灯片：整幅截图 + 左上角说明 */
function overlaySlide(src, index, title, subtitle, en) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1280px;height:800px;overflow:hidden;background:#000}
  .shot{position:absolute;inset:0;width:1280px;height:800px;object-fit:cover}
  .cap{position:absolute;left:40px;top:38px;padding:20px 28px 22px 24px;color:#f7f2e7;
    background:rgba(26,22,17,.84);backdrop-filter:blur(14px);border-left:3px solid ${accent};
    border-radius:2px;box-shadow:0 18px 40px -22px rgba(0,0,0,.8)}
  .idx{font:600 12px/1 ${mono};letter-spacing:.3em;color:${accent};text-transform:uppercase;margin-bottom:12px}
  .t{font:600 34px/1.2 ${serif};letter-spacing:.01em}
  .s{margin-top:10px;font:400 15px/1.5 ${sans};color:rgba(247,242,231,.86)}
  .en{margin-top:6px;font:400 11px/1.5 ${mono};letter-spacing:.1em;color:rgba(247,242,231,.5);text-transform:uppercase}
  .mark{position:absolute;right:40px;bottom:34px;padding:7px 12px;display:flex;align-items:center;gap:8px;
    background:rgba(26,22,17,.78);border-radius:2px;color:rgba(247,242,231,.85);font:500 11px/1 ${mono};letter-spacing:.16em}
  .mark img{width:18px;height:18px;border-radius:2px}
  </style></head><body>
  <img class="shot" src="${src}">
  <div class="cap">
    <div class="idx">${index}</div>
    <div class="t">${title}</div>
    <div class="s">${subtitle}</div>
    <div class="en">${en}</div>
  </div>
  <div class="mark"><img src="../icons/128.png">描图纸 · TRACING PAPER</div>
  </body></html>`
}

/** popup 幻灯片：左文右弹窗 */
function popupSlide(src, index, title, subtitle, bullets) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1280px;height:800px;overflow:hidden}
  body{background:${paper};font-family:${sans};color:${ink};position:relative}
  body::before{content:'';position:absolute;inset:0;background:
    radial-gradient(900px 520px at 12% 8%, #fffdf7 0%, rgba(255,253,247,0) 70%),
    repeating-linear-gradient(0deg, rgba(120,100,70,.045) 0 1px, rgba(120,100,70,0) 1px 3px)}
  .left{position:absolute;left:88px;top:150px;width:520px}
  .idx{font:600 13px/1 ${mono};letter-spacing:.28em;color:${accent};text-transform:uppercase}
  .rule{width:64px;height:2px;background:${accent};margin:22px 0 26px}
  .t{font:600 46px/1.24 ${serif};letter-spacing:.01em}
  .s{margin-top:18px;font:400 17px/1.7 ${sans};color:#5d5446}
  ul{margin-top:30px;list-style:none;display:flex;flex-direction:column;gap:12px}
  li{font:400 15px/1.5 ${sans};color:#3d372d;display:flex;align-items:center;gap:10px}
  li::before{content:'';width:5px;height:5px;background:${accent};flex:none}
  .frame{position:absolute;right:80px;top:76px;width:380px;height:648px;border:1px solid rgba(40,34,24,.22);
    background:#fff;box-shadow:0 30px 60px -30px rgba(40,34,24,.4);overflow:hidden}
  .frame img{width:380px;height:648px;object-fit:cover;object-position:top;display:block}
  .mark{position:absolute;left:88px;bottom:56px;font:500 12px/1 ${mono};letter-spacing:.16em;color:#7a6f5d}
  </style></head><body>
  <div class="left">
    <div class="idx">${index}</div>
    <div class="rule"></div>
    <div class="t">${title}</div>
    <div class="s">${subtitle}</div>
    <ul>${bullets.map((item) => `<li>${item}</li>`).join('')}</ul>
  </div>
  <div class="frame"><img src="${src}"></div>
  <div class="mark">描图纸 · TRACING PAPER</div>
  </body></html>`
}

/** 小推广图 440×280：图标 + 名称 + 一行说明 */
function tileSlide() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:440px;height:280px;overflow:hidden}
  body{background:${paper};color:${ink};font-family:${sans};position:relative;display:flex;align-items:center;
    gap:20px;padding:0 26px}
  body::before{content:'';position:absolute;inset:0;background:
    radial-gradient(70% 120% at 8% 0%, #fffdf7 0%, rgba(255,253,247,0) 70%),
    repeating-linear-gradient(0deg, rgba(120,100,70,.05) 0 1px, rgba(120,100,70,0) 1px 3px)}
  .icon{position:relative;width:64px;height:64px;flex:none;border:1px solid rgba(40,34,24,.18);border-radius:4px;
    box-shadow:0 10px 24px -14px rgba(40,34,24,.5)}
  .text{position:relative;min-width:0}
  .name{font:600 24px/1.15 ${serif};letter-spacing:.02em}
  .bar{width:36px;height:2px;background:${accent};margin:10px 0 9px}
  .tag{font:400 11.5px/1.55 ${sans};color:#5d5446}
  </style></head><body>
  <img class="icon" src="../icons/128.png">
  <div class="text">
    <div class="name">描图纸 Tracing Paper</div>
    <div class="bar"></div>
    <div class="tag">设计稿描在网页上：多图层叠加、像素级差异定位。</div>
  </div>
  </body></html>`
}

/** 顶部大图 1400×560：左文案 + 右侧截图 */
function marqueeSlide() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1400px;height:560px;overflow:hidden}
  body{background:${paper};color:${ink};font-family:${sans};position:relative}
  body::before{content:'';position:absolute;inset:0;background:
    radial-gradient(60% 120% at 6% 0%, #fffdf7 0%, rgba(255,253,247,0) 70%),
    repeating-linear-gradient(0deg, rgba(120,100,70,.05) 0 1px, rgba(120,100,70,0) 1px 3px)}
  .left{position:absolute;left:88px;top:120px;width:600px}
  .icon{width:56px;height:56px;border:1px solid rgba(40,34,24,.18);border-radius:4px;
    box-shadow:0 10px 24px -14px rgba(40,34,24,.5);margin-bottom:24px}
  .name{font:600 54px/1.12 ${serif};letter-spacing:.02em}
  .en{margin-top:10px;font:500 12px/1 ${mono};letter-spacing:.26em;color:#8a7d68}
  .bar{width:54px;height:2px;background:${accent};margin:20px 0 16px}
  .tag{font:400 16px/1.6 ${sans};color:#5d5446;max-width:520px}
  .shot{position:absolute;right:-40px;top:82px;width:600px;height:375px;object-fit:cover;
    border:1px solid rgba(40,34,24,.22);box-shadow:0 40px 80px -40px rgba(40,34,24,.5)}
  </style></head><body>
  <div class="left">
    <img class="icon" src="../icons/128.png">
    <div class="name">描图纸 Tracing Paper</div>
    <div class="en">VISUAL INSPECTION · PIXEL DIFF</div>
    <div class="bar"></div>
    <div class="tag">把设计稿描在网页上做走查：多图层叠加、像素级差异定位，结论可直接交给 AI 与 CI。</div>
  </div>
  <img class="shot" src="../raw/overlay.png">
  </body></html>`
}

const SLIDE_DEFS = [
  raw.overlay && {
    file: '01-overlay.png',
    html: overlaySlide('../raw/overlay.png', '01 / Overlay', '把设计稿盖到页面上',
      '拖动、缩放、吸附对齐，边看边改', 'Drag · resize · snap to page'),
  },
  raw.layers && {
    file: '02-layers.png',
    html: overlaySlide('../raw/layers.png', '02 / Layers', '图层与透明度随手调',
      '显隐、锁定、排序、复制，一屏切换', 'Show · lock · reorder · duplicate'),
  },
  raw.diff && {
    file: '03-diff.png',
    html: overlaySlide('../raw/diff.png', '03 / Diff', '像素比对，差异带证据',
      '偏移、颜色 ΔE、SSIM 与修改建议', 'Offset · ΔE · SSIM · suggestion'),
  },
  raw.popup && {
    file: '04-popup.png',
    html: popupSlide('../raw/popup.png', '04 / Popup', '素材库存一次，随时复用',
      '设计稿存在本地浏览器里，下次一键插入；刷新页面自动恢复上次的图层。',
      ['拖入、粘贴或选择图片', '多图层与透明度批量管理', '按 URL 记忆位置与尺寸']),
  },
]

const iconsDir = join(OUT, 'icons')
for (const [name, source] of [
  ['128.png', 'icon128.png'],
  ['512.png', 'icon512.png'],
]) {
  copyFileSync(resolve(root, 'public/icons', source), join(iconsDir, name))
}

/* Edge 商店要求 300×300 logo：用系统 sips 缩一张（非 macOS 环境跳过） */
if (existsSync('/usr/bin/sips')) {
  spawnSync('/usr/bin/sips', ['-z', '300', '300', resolve(root, 'public/icons/icon512.png'), '--out', join(iconsDir, '300.png')], {
    stdio: 'ignore',
  })
}

const render = async (htmlPath, outPath, width = 1280, height = 800) => {
  const slide = await painter.open(`file://${htmlPath}`)
  await slide.viewport(width, height, 1)
  await slide.eval(
    `document.fonts.ready.then(() => Promise.all([...document.images].map((img) => img.decode().catch(() => 0)))).then(() => true)`,
  )
  await wait(300)
  await slide.shot(outPath)
  await painter.send('Target.closeTarget', { targetId: slide.targetId })
}

const shotsDir = join(OUT, 'screenshots')
const promoDir = join(OUT, 'promo')
mkdirSync(shotsDir, { recursive: true })
mkdirSync(promoDir, { recursive: true })

const renderProfile = mkdtempSync(join(tmpdir(), 'tp-render-'))
const renderer = spawn(
  browserBin,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--hide-scrollbars',
    '--allow-file-access-from-files',
    `--remote-debugging-port=${DEBUG_PORT + 1}`,
    `--user-data-dir=${renderProfile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)
const painter = await Cdp.connect(DEBUG_PORT + 1)

/** 把模板里的相对路径换成 file:// 可读的绝对路径 */
const absoluteSources = (html) =>
  html.replace(/\.\.\/raw\//g, `${RAW}/`).replace(/\.\.\/icons\//g, `${OUT}/icons/`)

try {
  for (const def of SLIDE_DEFS.filter(Boolean)) {
    const htmlPath = join(SLIDES, def.file.replace('.png', '.html'))
    writeFileSync(htmlPath, absoluteSources(def.html))
    await render(htmlPath, join(shotsDir, def.file))
    console.log(`✓ screenshots/${def.file}`)
  }

  const promos = [
    { file: 'promo-440x280.png', width: 440, height: 280, html: tileSlide() },
    { file: 'marquee-1400x560.png', width: 1400, height: 560, html: marqueeSlide() },
  ]
  for (const promo of promos) {
    const htmlPath = join(SLIDES, promo.file.replace('.png', '.html'))
    writeFileSync(htmlPath, absoluteSources(promo.html))
    await render(htmlPath, join(promoDir, promo.file), promo.width, promo.height)
    console.log(`✓ promo/${promo.file}`)
  }
} finally {
  renderer.kill()
  rmSync(profile, { recursive: true, force: true })
  rmSync(renderProfile, { recursive: true, force: true })
  painter.socket.close()
}

console.log(`\n素材已生成：${'store/assets'}/`)
console.log('提示：截图取自 .e2e/site 演示页，如需换演示站点请改 scripts/store-assets.mjs')
