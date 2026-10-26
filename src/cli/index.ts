/**
 * tp-diff：零依赖命令行。
 * 只吃纯数据（两张 PNG + 可选元数据），不算 DOM、不开浏览器，方便智能体在 CI/本地直接调。
 *
 *   node tracing-diff.mjs --expected design.png --actual shot.png --out .tracing-report
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import {
  compareRasters,
  compareSemantic,
  diffReports,
  finalizeReport,
  parseFigmaDocument,
  parseLayoutElements,
  toJson,
  toMarkdown,
  toSarif,
  type DiffReport,
  type MaskRect,
} from '@/shared/diff'
import { decodePng, encodePng } from '@/shared/diff/node/png'
import { KIND_LABEL, SEVERITY_LABEL } from '@/shared/diff/report'

interface Args {
  flags: Map<string, string[]>
  booleans: Set<string>
}

const USAGE = `tracing-diff —— 描图纸差异比对 CLI（零依赖）

必填
  --expected <file.png>       设计稿
  --actual <file.png>         页面截图（同尺寸最佳）
可选
  --out <dir>                 产物目录，默认 .tracing-report
  --format <list>             输出格式：json,md,sarif,png,crops（逗号分隔，默认全开）
  --tile <n>                  网格边长，默认 16
  --delta-e <n>               色差阈值 ΔE2000，默认 2.3
  --ssim <n>                  结构相似度下限，默认 0.98
  --pixel <n>                 像素级色差阈值，默认 6
  --min-area <n>              最小区域面积，默认 96
  --shift-search <n>          位移搜索半径，默认 4
  --max-findings <n>          最多输出条数，默认 120
  --mask <x,y,w,h[:原因]>     忽略区域，可重复
  --align <auto|off|dx,dy>    全局对齐，默认 auto（位移显著降低残差才采用）
  --scale <n>                 设计稿渲染缩放，默认 1
  --url <url>                 报告里记录的页面地址
  --figma <file.json>         Figma 节点导出（REST / 插件均可）
  --dom <file.json>           页面布局导出（扩展里导出）
  --baseline <report.json>    与上一次报告对比，输出 unified diff
  --stdout <json|sarif|md|diff>  只把小体积结果打到标准输出
  --exit-code                 有差异时退出码 1（默认始终 0）
  --quiet                     不打印摘要
  --help                      显示本帮助
`

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string[]>()
  const booleans = new Set<string>()
  const valueKeys = new Set([
    'expected',
    'actual',
    'out',
    'format',
    'tile',
    'delta-e',
    'ssim',
    'pixel',
    'min-area',
    'shift-search',
    'max-findings',
    'mask',
    'align',
    'scale',
    'url',
    'figma',
    'dom',
    'baseline',
    'stdout',
  ])

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const [rawKey, inline] = token.slice(2).split('=')
    if (valueKeys.has(rawKey)) {
      const value = inline ?? argv[i + 1]
      if (value === undefined) throw new Error(`参数 --${rawKey} 缺少值`)
      if (inline === undefined) i += 1
      const list = flags.get(rawKey) ?? []
      list.push(value)
      flags.set(rawKey, list)
    } else {
      booleans.add(rawKey)
    }
  }
  return { flags, booleans }
}

function num(args: Args, key: string): number | undefined {
  const value = args.flags.get(key)?.[0]
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (Number.isNaN(parsed)) throw new Error(`参数 --${key} 需要数字，收到 ${value}`)
  return parsed
}

function readPng(path: string) {
  const absolute = resolve(path)
  if (!existsSync(absolute)) throw new Error(`找不到文件：${absolute}`)
  const buffer = readFileSync(absolute)
  return {
    path: absolute,
    name: basename(absolute),
    sha256: createHash('sha256').update(buffer).digest('hex').slice(0, 16),
    raster: decodePng(buffer),
  }
}

function parseMasks(args: Args): MaskRect[] {
  return (args.flags.get('mask') ?? []).map((raw) => {
    const [box, reason] = raw.split(':')
    const parts = box.split(',').map((item) => Number(item.trim()))
    if (parts.length !== 4 || parts.some((item) => Number.isNaN(item))) {
      throw new Error(`--mask 需要 x,y,w,h[:原因]，收到 ${raw}`)
    }
    return { x: parts[0], y: parts[1], w: parts[2], h: parts[3], ...(reason ? { reason } : {}) }
  })
}

function parseAlign(args: Args): 'auto' | 'off' | { dx: number; dy: number } {
  const raw = args.flags.get('align')?.[0]
  if (raw === undefined || raw === 'auto') return 'auto'
  if (raw === 'off' || raw === 'none') return 'off'
  const parts = raw.split(',').map((item) => Number(item.trim()))
  if (parts.length !== 2 || parts.some((item) => Number.isNaN(item))) {
    throw new Error(`--align 需要 auto、off 或 dx,dy，收到 ${raw}`)
  }
  return { dx: parts[0], dy: parts[1] }
}

function parseLayout(path: string) {
  return parseLayoutElements(JSON.parse(readFileSync(resolve(path), 'utf8')) as unknown)
}

function formatFindingLine(index: number, report: DiffReport): string {
  const finding = report.findings[index]
  const where = finding.element?.selector ?? `(${finding.box.x},${finding.box.y})`
  const shift = finding.metrics.shift ? ` shift=${finding.metrics.shift.dx},${finding.metrics.shift.dy}` : ''
  return `  ${index + 1}. [${SEVERITY_LABEL[finding.severity]}/${KIND_LABEL[finding.kind]}] ${where} ΔE=${finding.metrics.deltaE}${shift}`
}

function main(): number {
  const args = parseArgs(process.argv.slice(2))
  if (args.booleans.has('help') || !args.flags.get('expected') || !args.flags.get('actual')) {
    process.stdout.write(USAGE)
    return args.booleans.has('help') ? 0 : 2
  }

  const expectedArg = readPng(args.flags.get('expected')![0])
  const actualArg = readPng(args.flags.get('actual')![0])
  const outDir = resolve(args.flags.get('out')?.[0] ?? '.tracing-report')
  const formats = new Set((args.flags.get('format')?.[0] ?? 'json,md,sarif,png,crops').split(',').map((item) => item.trim()))
  const masks = parseMasks(args)

  const result = compareRasters({
    expected: expectedArg.raster,
    actual: actualArg.raster,
    masks,
    align: parseAlign(args),
    scale: num(args, 'scale'),
    policy: {
      ...(num(args, 'tile') !== undefined ? { tile: num(args, 'tile')! } : {}),
      ...(num(args, 'delta-e') !== undefined ? { deltaE: num(args, 'delta-e')! } : {}),
      ...(num(args, 'ssim') !== undefined ? { ssim: num(args, 'ssim')! } : {}),
      ...(num(args, 'pixel') !== undefined ? { pixel: num(args, 'pixel')! } : {}),
      ...(num(args, 'min-area') !== undefined ? { minArea: num(args, 'min-area')! } : {}),
      ...(num(args, 'shift-search') !== undefined ? { shiftSearch: num(args, 'shift-search')! } : {}),
      ...(num(args, 'max-findings') !== undefined ? { maxFindings: num(args, 'max-findings')! } : {}),
    },
  })

  const semanticPath = args.flags.get('figma')?.[0]
  const domPath = args.flags.get('dom')?.[0]
  let semantic: ReturnType<typeof compareSemantic> | undefined
  const extraNotes: string[] = []
  if (semanticPath && domPath) {
    const nodes = parseFigmaDocument(JSON.parse(readFileSync(resolve(semanticPath), 'utf8')) as unknown)
    const elements = parseLayout(domPath)
    const deltaE = num(args, 'delta-e')
    semantic = compareSemantic(nodes, elements, deltaE === undefined ? {} : { deltaE })
  } else if (semanticPath || domPath) {
    extraNotes.push('语义层需要同时提供 --figma 与 --dom，本次仅输出像素级结论')
  }

  const report = finalizeReport(result.report, {
    mode: 'cli',
    expected: {
      name: expectedArg.name,
      sha256: expectedArg.sha256,
      width: expectedArg.raster.width,
      height: expectedArg.raster.height,
    },
    actual: {
      name: actualArg.name,
      sha256: actualArg.sha256,
      width: actualArg.raster.width,
      height: actualArg.raster.height,
      ...(args.flags.get('url')?.[0] ? { url: args.flags.get('url')![0] } : {}),
    },
    artifacts: {},
    semantic,
    notes: extraNotes,
    ...(num(args, 'scale') !== undefined ? { alignment: { scale: num(args, 'scale')!, method: 'given' as const } } : {}),
  })

  mkdirSync(outDir, { recursive: true })
  const artifacts: DiffReport['artifacts'] = {}

  if (formats.has('png') && result.diffImage) {
    writeFileSync(join(outDir, 'diff.png'), encodePng(result.diffImage))
    artifacts.diffImage = 'diff.png'
  }
  if (formats.has('crops')) {
    artifacts.crops = []
    const cropDir = join(outDir, 'crops')
    mkdirSync(cropDir, { recursive: true })
    result.crops.forEach((crop) => {
      const base = `crops/${crop.id}`
      writeFileSync(join(outDir, `${base}.expected.png`), encodePng(crop.expected))
      writeFileSync(join(outDir, `${base}.actual.png`), encodePng(crop.actual))
      writeFileSync(join(outDir, `${base}.diff.png`), encodePng(crop.diff))
      artifacts.crops!.push({
        id: crop.id,
        expected: `${base}.expected.png`,
        actual: `${base}.actual.png`,
        diff: `${base}.diff.png`,
      })
    })
  }

  const finalReport: DiffReport = { ...report, artifacts: { ...artifacts } }
  if (formats.has('json')) {
    writeFileSync(join(outDir, 'report.json'), toJson(finalReport))
    finalReport.artifacts.report = 'report.json'
  }
  if (formats.has('md')) {
    writeFileSync(join(outDir, 'report.md'), toMarkdown(finalReport))
    finalReport.artifacts.markdown = 'report.md'
  }
  if (formats.has('sarif')) {
    writeFileSync(join(outDir, 'report.sarif'), toSarif(finalReport))
    finalReport.artifacts.sarif = 'report.sarif'
  }
  if (semantic?.layout.diff) {
    writeFileSync(join(outDir, 'layout.diff'), `${semantic.layout.diff}\n`)
  }

  let baselineDiff = ''
  const baselinePath = args.flags.get('baseline')?.[0]
  if (baselinePath) {
    const baseline = JSON.parse(readFileSync(resolve(baselinePath), 'utf8')) as DiffReport
    baselineDiff = diffReports(baseline, finalReport)
    writeFileSync(join(outDir, 'report.diff'), `${baselineDiff}\n`)
  }

  const stdout = args.flags.get('stdout')?.[0]
  if (stdout === 'json') process.stdout.write(toJson(finalReport))
  if (stdout === 'sarif') process.stdout.write(toSarif(finalReport))
  if (stdout === 'md') process.stdout.write(toMarkdown(finalReport))
  if (stdout === 'diff') process.stdout.write(`${baselineDiff || semantic?.layout.diff || ''}\n`)

  if (!args.booleans.has('quiet')) {
    const { summary } = finalReport
    const lines: string[] = []
    lines.push(`tp-diff  ${summary.verdict === 'clean' ? '未发现差异' : `${summary.findings} 处差异`}  (变化格 ${summary.changedTiles}/${summary.tiles}, 最大 ΔE ${summary.maxDeltaE})`)
    lines.push(`  设计稿 ${expectedArg.name} ${expectedArg.raster.width}×${expectedArg.raster.height}  →  页面 ${actualArg.name} ${actualArg.raster.width}×${actualArg.raster.height}`)
    const { alignment } = finalReport.inputs
    if (alignment.dx || alignment.dy) {
      lines.push(`  对齐 ${alignment.method === 'auto' ? '自动' : '指定'}  dx=${alignment.dx} dy=${alignment.dy}`)
    }
    if (semantic) {
      lines.push(`  语义层 ${semantic.matched}/${semantic.nodes} 命中，属性差异 ${semantic.findings.length} 处`)
    }
    finalReport.findings.slice(0, 6).forEach((_, index) => lines.push(formatFindingLine(index, finalReport)))
    if (summary.findings > 6) lines.push(`  … 其余 ${summary.findings - 6} 条见 report.md`)
    lines.push(`  产物目录 ${outDir}`)
    if (baselineDiff) lines.push(`  与基线对比已写入 report.diff`)
    process.stdout.write(`${lines.join('\n')}\n`)
  }

  if (args.booleans.has('exit-code') && finalReport.findings.length) return 1
  return 0
}

try {
  process.exitCode = main()
} catch (error) {
  process.stderr.write(`tp-diff 失败：${(error as Error).message}\n`)
  process.exitCode = 2
}
