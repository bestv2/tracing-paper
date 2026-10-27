#!/usr/bin/env node
/**
 * 隐私政策发布页同步：以 store/privacy-policy.html 为唯一真源，
 * 复制到 docs/index.html 供 GitHub Pages（Settings → Pages → main /docs）托管。
 *
 * 单独维护一份 docs 副本会走样，所以这里只做单向复制，并且拒绝发布仍带
 * 〈待填：…〉占位符的版本——商店审核看到占位符会直接驳回。
 *
 * 用法：npm run store:docs
 * 产物：docs/index.html
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const source = resolve(root, 'store/privacy-policy.html')
const target = resolve(root, 'docs/index.html')

const html = readFileSync(source, 'utf8')

const pending = [...new Set(html.match(/〈待填：[^〉]*〉/g) ?? [])]
if (pending.length > 0) {
  console.error(`✗ ${source} 里还有 ${pending.length} 处占位符未替换：`)
  for (const item of pending) console.error(`  ${item}`)
  process.exit(1)
}

for (const required of ['<html lang="zh-CN"', 'id="zh"', 'id="en"']) {
  if (!html.includes(required)) {
    console.error(`✗ 隐私政策缺少 ${required}，检查是否被误改`)
    process.exit(1)
  }
}

mkdirSync(resolve(root, 'docs'), { recursive: true })
writeFileSync(target, html)
console.log('✓ docs/index.html  <- store/privacy-policy.html')
console.log('  GitHub Pages 发布后地址：https://bestv2.github.io/tracing-paper/')
