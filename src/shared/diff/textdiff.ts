/** 行级 diff：LCS 后输出 unified diff，用于"两次报告之间"或"设计行 vs 页面行"的对比 */

export interface LineChange {
  type: ' ' | '-' | '+'
  text: string
  /** 原始行号（1 基） */
  aLine?: number
  bLine?: number
}

/** 经典 LCS DP。报告行数在千行量级，O(n·m) 足够且实现稳定 */
export function diffLines(previous: string[], next: string[]): LineChange[] {
  const n = previous.length
  const m = next.length
  const table = new Uint32Array((n + 1) * (m + 1))
  const at = (i: number, j: number) => i * (m + 1) + j

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[at(i, j)] =
        previous[i] === next[j]
          ? table[at(i + 1, j + 1)] + 1
          : Math.max(table[at(i + 1, j)], table[at(i, j + 1)])
    }
  }

  const changes: LineChange[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (previous[i] === next[j]) {
      changes.push({ type: ' ', text: previous[i], aLine: i + 1, bLine: j + 1 })
      i += 1
      j += 1
    } else if (table[at(i + 1, j)] >= table[at(i, j + 1)]) {
      changes.push({ type: '-', text: previous[i], aLine: i + 1 })
      i += 1
    } else {
      changes.push({ type: '+', text: next[j], bLine: j + 1 })
      j += 1
    }
  }
  while (i < n) {
    changes.push({ type: '-', text: previous[i], aLine: i + 1 })
    i += 1
  }
  while (j < m) {
    changes.push({ type: '+', text: next[j], bLine: j + 1 })
    j += 1
  }
  return changes
}

export interface UnifiedDiffOptions {
  from?: string
  to?: string
  context?: number
}

/** 输出标准 unified diff（带 ---/+++ 头与 @@ -a,b +c,d @@ 块） */
export function unifiedDiff(previous: string[], next: string[], options: UnifiedDiffOptions = {}): string {
  const { from = 'a/expected.layout', to = 'b/actual.layout', context = 3 } = options
  const changes = diffLines(previous, next)
  if (!changes.some((change) => change.type !== ' ')) return ''

  const hunks: string[] = []
  let index = 0
  while (index < changes.length) {
    while (index < changes.length && changes[index].type === ' ') index += 1
    if (index >= changes.length) break

    const start = Math.max(0, index - context)
    let end = index
    let cursor = index
    let trailing = 0
    while (cursor < changes.length) {
      if (changes[cursor].type === ' ') {
        trailing += 1
        if (trailing > context * 2) break
      } else {
        trailing = 0
        end = cursor
      }
      cursor += 1
    }
    const stop = Math.min(changes.length, end + context + 1)
    const slice = changes.slice(start, stop)

    const aStart = slice.find((change) => change.aLine !== undefined)?.aLine ?? 1
    const bStart = slice.find((change) => change.bLine !== undefined)?.bLine ?? 1
    const aCount = slice.filter((change) => change.type !== '+').length
    const bCount = slice.filter((change) => change.type !== '-').length

    hunks.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`)
    slice.forEach((change) => hunks.push(`${change.type}${change.text}`))
    index = stop
  }

  return [`--- ${from}`, `+++ ${to}`, ...hunks].join('\n')
}
