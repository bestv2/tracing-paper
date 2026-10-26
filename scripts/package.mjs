#!/usr/bin/env node
/**
 * 商店安装包打包：把 dist / dist-firefox 压成可直接上传的 zip，
 * 并输出 manifest 副本与 sha256 校验值。
 *
 * 产物：
 *   release/tracing-paper-<version>-chrome.zip
 *   release/tracing-paper-<version>-edge.zip
 *   release/tracing-paper-<version>-firefox.zip
 *   release/manifests/<browser>.json
 *   release/SHA256SUMS.txt
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { createZip } from './zip.mjs'

const root = resolve(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const releaseDir = resolve(root, 'release')

/** Chrome / Edge 共用 dist，Firefox 用 dist-firefox */
const ARTIFACTS = [
  { browser: 'chrome', dir: resolve(root, 'dist') },
  { browser: 'edge', dir: resolve(root, 'dist') },
  { browser: 'firefox', dir: resolve(root, 'dist-firefox') },
]

function walk(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) files.push(...walk(full))
    else if (entry.isFile()) files.push(full)
  }
  return files
}

function assertBuild(dir) {
  try {
    if (!statSync(resolve(dir, 'manifest.json')).isFile()) throw new Error('missing manifest')
  } catch {
    console.error(`✗ 找不到 ${relative(root, dir)}/manifest.json，请先运行 npm run build`)
    process.exit(1)
  }
}

const kib = (bytes) => `${(bytes / 1024).toFixed(0)} KB`

rmSync(releaseDir, { recursive: true, force: true })
mkdirSync(resolve(releaseDir, 'manifests'), { recursive: true })

const sums = []
for (const { browser, dir } of ARTIFACTS) {
  assertBuild(dir)
  const files = walk(dir).sort()
  const entries = files.map((file) => ({
    name: relative(dir, file).split(sep).join('/'),
    data: readFileSync(file),
  }))
  const zip = createZip(entries)
  const name = `tracing-paper-${pkg.version}-${browser}.zip`
  writeFileSync(resolve(releaseDir, name), zip)
  writeFileSync(
    resolve(releaseDir, 'manifests', `${browser}.json`),
    readFileSync(resolve(dir, 'manifest.json')),
  )
  sums.push(`${createHash('sha256').update(zip).digest('hex')}  ${name}`)
  console.log(`✓ ${name}  ${kib(zip.length)} · ${entries.length} 个文件`)
}

writeFileSync(resolve(releaseDir, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`)
console.log(`\n全部产物在 ${relative(root, releaseDir)}/，校验值见 SHA256SUMS.txt`)
