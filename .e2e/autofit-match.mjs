/**
 * 自动对齐算法回归：用真实夹具在 Node 里跑 estimation，不依赖浏览器。
 * 用法：node .e2e/autofit-match.mjs [--hint x,y,w,h]
 *
 * 夹具由 autofit-fixture.mjs 导出：设计稿原图 + 页面顶部截图（1440×900）。
 * 已知真值：设计稿应当落在页面顶部附近（scale ≈ 1，x/y ≈ 0）。
 */
import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const CACHE = `${ROOT}/.e2e/.cache`
fs.mkdirSync(CACHE, { recursive: true })

const outfile = path.join(CACHE, 'autofit-entry.mjs')
await build({
  entryPoints: [path.join(ROOT, '.e2e/autofit-entry.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile,
  logLevel: 'error',
})

const { run, scoreAt, overlay, profiles } = await import(`${outfile}?t=${Date.now()}`)

const FIXTURES = `${ROOT}/.e2e/shots/autofit`
const design = `${FIXTURES}/fx-design.png`
const page = `${FIXTURES}/fx-page.png`
if (!fs.existsSync(design) || !fs.existsSync(page)) {
  console.error('缺少夹具，先跑 node .e2e/autofit-fixture.mjs')
  process.exit(1)
}

const hints = [
  { label: '无先验', hint: null },
  { label: '偏右下（390,491,1303×710）', hint: { x: 390, y: 491, width: 1303, height: 710 } },
  { label: '贴顶部（54,38,1440×900）', hint: { x: 54, y: 38, width: 1440, height: 900 } },
  { label: '缩到左上角（0,0,300×188）', hint: { x: 0, y: 0, width: 300, height: 188 } },
  { label: '实测（246,19,1293×808）', hint: { x: 246, y: 19, width: 1293, height: 808 } },
]

for (const item of hints) {
  const result = run({ design, page, hint: item.hint })
  const placement = result.placement
  console.log(
    `· ${item.label}`,
    placement
      ? `→ x=${placement.rect.x} y=${placement.rect.y} ${placement.rect.width}×${placement.rect.height} scale=${placement.scale.toFixed(3)} score=${placement.score.toFixed(3)} (${result.ms}ms)`
      : `→ 未匹配 (${result.ms}ms)`,
  )
  if (placement && item.hint === null) {
    overlay({
      design,
      page,
      rect: placement.rect,
      scale: placement.scale,
      out: `${FIXTURES}/match-overlay.png`,
    })
  }
}

/* 一维剖面：单独看垂直、水平方向的真实位移 */
const bestShift = (a, b, radius) => {
  const norm = (values) => {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    return values.map((value) => value - mean)
  }
  const left = norm([...a])
  const right = norm([...b])
  let best = { shift: 0, score: -1 }
  for (let shift = -radius; shift <= radius; shift += 1) {
    let dot = 0
    let na = 0
    let nb = 0
    for (let i = 0; i < left.length; i += 1) {
      const other = i + shift
      if (other < 0 || other >= right.length) continue
      dot += left[i] * right[other]
      na += left[i] * left[i]
      nb += right[other] * right[other]
    }
    const score = dot / Math.sqrt(na * nb || 1)
    if (score > best.score) best = { shift, score }
  }
  return best
}

let truth = null
{
  const { design: rowsA, page: rowsB, designCols: colsA, pageCols: colsB } = profiles({ design, page })
  const dy = bestShift(rowsA, rowsB, 80)
  const dx = bestShift(colsA, colsB, 120)
  truth = { dx: dx.shift, dy: dy.shift }
  console.log(
    `· 一维真值 dx=${dx.shift} (corr=${dx.score.toFixed(3)}) dy=${dy.shift} (corr=${dy.score.toFixed(3)})`,
  )
  for (const item of hints) {
    const result = run({ design, page, hint: item.hint })
    if (!result.placement) continue
    const { rect, scale } = result.placement
    const atTruth = scoreAt({ design, page, rect: { ...rect, x: truth.dx, y: truth.dy }, scale: 1 })
    console.log(
      `  ↳ ${item.label}: 得分 ${result.placement.score.toFixed(3)}；真值处(scale=1) 得分 ${atTruth.toFixed(3)}`,
    )
  }
}

/* 真值扫描：看相关度曲面到底峰在哪里，判断搜索有没有跑偏 */
const scan = (scales, xs, ys) => {
  let best = null
  for (const scale of scales) {
    for (const x of xs) {
      for (const y of ys) {
        const rect = { x, y, width: Math.round(1440 * scale), height: Math.round(900 * scale) }
        const score = scoreAt({ design, page, rect, scale })
        if (!best || score > best.score) best = { scale, x, y, score }
      }
    }
  }
  return best
}

const range = (from, to, step) => {
  const out = []
  for (let value = from; value <= to + 1e-9; value += step) out.push(Number(value.toFixed(4)))
  return out
}

const coarse = scan(range(0.92, 1.08, 0.02), range(-30, 50, 10), range(-20, 60, 10))
console.log(
  `· 粗扫峰值 scale=${coarse.scale.toFixed(2)} x=${coarse.x} y=${coarse.y} score=${coarse.score.toFixed(3)}`,
)
const fineScan = scan(
  range(coarse.scale - 0.01, coarse.scale + 0.01, 0.005),
  range(coarse.x - 6, coarse.x + 6, 3),
  range(coarse.y - 6, coarse.y + 6, 3),
)
console.log(
  `· 细扫峰值 scale=${fineScan.scale.toFixed(3)} x=${fineScan.x} y=${fineScan.y} score=${fineScan.score.toFixed(3)}`,
)
