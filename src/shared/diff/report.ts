import type {
  DiffArtifacts,
  DiffReport,
  Baseline,
  Finding,
  FindingKind,
  InputMeta,
  Alignment,
  SemanticReport,
  Severity,
} from './types'
import { unifiedDiff } from './textdiff'

export interface ReportContext {
  mode: 'cli' | 'extension'
  expected: InputMeta
  actual: InputMeta
  alignment?: Partial<Alignment>
  artifacts?: DiffArtifacts
  semantic?: SemanticReport
  baseline?: Baseline
  notes?: string[]
}

export function finalizeReport(report: DiffReport, context: ReportContext): DiffReport {
  const next: DiffReport = {
    ...report,
    tool: { ...report.tool, mode: context.mode },
    inputs: {
      expected: { ...context.expected, width: report.inputs.expected.width, height: report.inputs.expected.height },
      actual: { ...context.actual, width: report.inputs.actual.width, height: report.inputs.actual.height },
      alignment: {
        ...report.inputs.alignment,
        ...context.alignment,
        scale: context.alignment?.scale ?? report.inputs.alignment.scale,
        dx: context.alignment?.dx ?? report.inputs.alignment.dx,
        dy: context.alignment?.dy ?? report.inputs.alignment.dy,
        method: context.alignment?.method ?? report.inputs.alignment.method,
      },
    },
    artifacts: { ...report.artifacts, ...context.artifacts },
    semantic: context.semantic ?? report.semantic,
    baseline: context.baseline ?? report.baseline,
    notes: context.notes ? [...report.notes, ...context.notes] : report.notes,
  }
  return next
}

export const KIND_LABEL: Record<FindingKind, string> = {
  shift: '位移',
  color: '颜色',
  size: '尺寸',
  missing: '缺失',
  extra: '多余',
  content: '内容',
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  blocker: '严重',
  major: '主要',
  minor: '次要',
  info: '提示',
}

const SARIF_LEVEL: Record<Severity, 'error' | 'warning' | 'note'> = {
  blocker: 'error',
  major: 'error',
  minor: 'warning',
  info: 'note',
}

export function toJson(report: DiffReport): string {
  return `${JSON.stringify(report, null, 2)}\n`
}

/** 语义层的规范化文本行：字段顺序固定，便于 unified diff 稳定 */
export function findingLines(report: DiffReport): string[] {
  const lines = [
    `# tracing.findings/1  expected=${report.inputs.expected.name ?? 'design'}  actual=${report.inputs.actual.url ?? 'page'}`,
    `# policy tile=${report.policy.tile} deltaE=${report.policy.deltaE} ssim=${report.policy.ssim} minArea=${report.policy.minArea}`,
  ]
  report.findings.forEach((finding) => {
    const selector = finding.element?.selector ?? '-'
    const shift = finding.metrics.shift ? ` shift=${finding.metrics.shift.dx},${finding.metrics.shift.dy}` : ''
    lines.push(
      `${finding.kind} ${selector} box=${finding.box.x},${finding.box.y},${finding.box.w},${finding.box.h} dE=${finding.metrics.deltaE} ssim=${finding.metrics.ssim}${shift}`,
    )
  })
  return lines
}

/** 两次报告之间的 unified diff：+ 新增差异，- 已修复差异 */
export function diffReports(previous: DiffReport, current: DiffReport): string {
  return unifiedDiff(findingLines(previous), findingLines(current), {
    from: 'a/report.json (baseline)',
    to: 'b/report.json (current)',
  })
}

export function toSarif(report: DiffReport): string {
  const kinds = Array.from(new Set(report.findings.map((finding) => finding.kind)))
  const rules = kinds.map((kind) => ({
    id: `vi/${kind}`,
    name: `${KIND_LABEL[kind]}差异`,
    shortDescription: { text: kindShortText(kind) },
    fullDescription: { text: kindFullText(kind) },
    defaultConfiguration: { level: 'warning' },
    properties: { tags: ['visual-diff', 'ui', kind] },
  }))

  const uri = report.inputs.actual.url ?? report.inputs.actual.name ?? 'page'
  const results = report.findings.map((finding) => ({
    ruleId: `vi/${finding.kind}`,
    ruleIndex: kinds.indexOf(finding.kind),
    level: SARIF_LEVEL[finding.severity],
    message: { text: findingMessage(finding) },
    locations: [
      {
        physicalLocation: { artifactLocation: { uri } },
        logicalLocations: [
          {
            fullyQualifiedName: finding.element?.selector ?? `box:${finding.box.x},${finding.box.y}`,
            kind: finding.element ? 'member' : 'unknown',
            properties: finding.element?.tag ? { tag: finding.element.tag } : undefined,
          },
        ],
      },
    ],
    partialFingerprints: { 'tracingDiff/finding': finding.id },
    properties: {
      kind: finding.kind,
      severity: finding.severity,
      box: finding.box,
      metrics: finding.metrics,
      colors: { expected: finding.expected.hex, actual: finding.actual.hex },
      suggestion: finding.suggestion ?? null,
      note: finding.note ?? null,
    },
  }))

  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: report.tool.name,
            version: report.tool.version,
            rules,
          },
        },
        invocations: [
          {
            executionSuccessful: true,
            endTimeUtc: report.generatedAt,
            properties: { mode: report.tool.mode },
          },
        ],
        artifacts: report.artifacts.diffImage
          ? [{ location: { uri: report.artifacts.diffImage }, mimeType: 'image/png' }]
          : [],
        results,
        properties: {
          summary: report.summary,
          policy: report.policy,
          inputs: report.inputs,
          semantic: report.semantic ? summarizeSemantic(report.semantic) : undefined,
        },
      },
    ],
  }
  return `${JSON.stringify(sarif, null, 2)}\n`
}

function summarizeSemantic(semantic: SemanticReport) {
  return {
    source: semantic.source,
    nodes: semantic.nodes,
    matched: semantic.matched,
    unmatched: semantic.unmatched,
    findings: semantic.findings.length,
  }
}

function kindShortText(kind: FindingKind): string {
  switch (kind) {
    case 'shift':
      return '元素相对设计稿整体偏移'
    case 'color':
      return '结构一致但颜色不一致'
    case 'size':
      return '尺寸或内边距与设计稿不一致'
    case 'missing':
      return '设计稿有、页面缺失'
    case 'extra':
      return '页面多出设计稿没有的内容'
    default:
      return '区域内容不一致'
  }
}

function kindFullText(kind: FindingKind): string {
  switch (kind) {
    case 'shift':
      return '区域在 ±N px 位移后残差显著下降，判为整体位移；metrics.shift 给出 dx/dy。'
    case 'color':
      return '颜色差超过阈值而边缘能量接近，判为颜色不一致；colors 字段给出两侧实际颜色。'
    case 'size':
      return '差异集中在单侧边界，通常是宽高、内边距或行高变化。'
    case 'missing':
      return '设计稿该区域有内容，页面渲染为空白，通常是元素未渲染或被遮挡。'
    case 'extra':
      return '页面该区域多出内容，设计稿为空白。'
    default:
      return '结构与颜色都发生变化，需人工确认或对照 crops 中的切片。'
  }
}

function findingMessage(finding: Finding): string {
  const where = finding.element?.selector ? `（${finding.element.selector}）` : ''
  const extra = finding.note ? `：${finding.note}` : ''
  return `${KIND_LABEL[finding.kind]}差异${where} ΔE=${finding.metrics.deltaE} SSIM=${finding.metrics.ssim}${extra}`
}

export function toMarkdown(report: DiffReport): string {
  const { summary, inputs, policy } = report
  const lines: string[] = []
  lines.push(`# 描图纸 · 差异报告`)
  lines.push('')
  lines.push(`- 结论：**${summary.verdict === 'clean' ? '未发现差异' : `${summary.findings} 处差异`}**`)
  lines.push(`- 设计稿：\`${inputs.expected.name ?? 'design.png'}\` ${inputs.expected.width}×${inputs.expected.height}`)
  lines.push(`- 页面：\`${inputs.actual.url ?? inputs.actual.name ?? 'page'}\` ${inputs.actual.width}×${inputs.actual.height}`)
  lines.push(`- 变化格数：${summary.changedTiles}/${summary.tiles}（${(summary.changedRatio * 100).toFixed(2)}%），最大 ΔE ${summary.maxDeltaE}`)
  lines.push(
    `- 判定口径：tile ${policy.tile}px / ΔE≥${policy.deltaE} / SSIM<${policy.ssim} / 最小面积 ${policy.minArea}px²`,
  )
  if (policy.masks.length) lines.push(`- 忽略区域：${policy.masks.length} 处`)
  const baseline = report.baseline
  if (baseline) {
    const label =
      baseline.verdict === 'ok' ? '可信' : baseline.verdict === 'drift' ? '有偏移' : '不可信'
    lines.push(
      `- 基准自检：**${label}**（匹配 ${baseline.score}，偏移 ${baseline.drift.dx},${baseline.drift.dy}px，尺寸 ${Math.round(
        baseline.scaleRatio * 100,
      )}%）`,
    )
  }
  if (report.notes.length) {
    lines.push('')
    report.notes.forEach((note) => lines.push(`> ${note}`))
  }

  if (report.findings.length) {
    lines.push('')
    lines.push('| # | 类型 | 严重度 | 区域 (x,y,w,h) | ΔE | SSIM | 元素 | 建议 |')
    lines.push('|---|---|---|---|---|---|---|---|')
    report.findings.forEach((finding, index) => {
      const box = `${finding.box.x},${finding.box.y},${finding.box.w},${finding.box.h}`
      const element = finding.element?.selector ? `\`${finding.element.selector}\`` : '—'
      const suggestion = finding.suggestion
        ? `\`${finding.suggestion.property}: ${finding.suggestion.to}\``
        : '—'
      lines.push(
        `| ${index + 1} | ${KIND_LABEL[finding.kind]} | ${SEVERITY_LABEL[finding.severity]} | ${box} | ${finding.metrics.deltaE} | ${finding.metrics.ssim} | ${element} | ${suggestion} |`,
      )
    })
  }

  if (report.semantic) {
    const semantic = report.semantic
    lines.push('')
    lines.push(`## 语义层（${semantic.source}）`)
    lines.push('')
    lines.push(`节点 ${semantic.nodes}，命中 ${semantic.matched}，未命中 ${semantic.unmatched}，属性差异 ${semantic.findings.length} 处`)
    if (semantic.findings.length) {
      lines.push('')
      lines.push('| 节点 | 元素 | IoU | 属性 | 设计稿 | 页面 |')
      lines.push('|---|---|---|---|---|---|')
      semantic.findings.slice(0, 40).forEach((finding) => {
        finding.diffs.forEach((diff, index) => {
          lines.push(
            `| ${index === 0 ? finding.node.name : ''} | ${index === 0 ? (finding.element?.selector ?? '—') : ''} | ${index === 0 ? finding.match.toFixed(2) : ''} | ${diff.property} | ${diff.expected} | ${diff.actual} |`,
          )
        })
      })
    }
  }

  if (report.artifacts.diffImage) {
    lines.push('')
    lines.push(`![差异图](${report.artifacts.diffImage})`)
  }
  lines.push('')
  return lines.join('\n')
}
