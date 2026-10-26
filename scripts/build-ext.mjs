#!/usr/bin/env node
/**
 * 多浏览器构建：同一份源码产出两套目录
 *   dist/          Chrome / Edge（MV3 + ESM service worker）
 *   dist-firefox/  Firefox（MV3 + 事件页 background.scripts，classic 脚本）
 *
 * 用法：
 *   node scripts/build-ext.mjs              # 两套都构建
 *   node scripts/build-ext.mjs chrome       # 只构建 Chrome / Edge
 *   node scripts/build-ext.mjs firefox      # 只构建 Firefox
 *   node scripts/build-ext.mjs chrome --watch
 */
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildManifest } from './manifest.mjs'

const root = resolve(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const baseManifest = JSON.parse(readFileSync(resolve(root, 'public/manifest.json'), 'utf8'))
const VITE = resolve(root, 'node_modules/vite/bin/vite.js')

const TARGETS = {
  // Chrome / Edge 共用 Chromium MV3 产物
  chrome: { outDir: 'dist', bgFormat: 'es', target: 'chrome110' },
  firefox: { outDir: 'dist-firefox', bgFormat: 'iife', target: 'firefox115' },
}

/** popup 必须最先构建：它负责清空输出目录，其余配置都是 emptyOutDir: false 叠加 */
const CONFIGS = [
  'vite.config.ts',
  'vite.config.background.ts',
  'vite.config.overlay.ts',
  'vite.config.bootstrap.ts',
]

const argv = process.argv.slice(2)
const watch = argv.includes('--watch')
const requested = argv.filter((arg) => !arg.startsWith('-'))
const names = requested.length ? requested : ['chrome', 'firefox']

for (const name of names) {
  if (!TARGETS[name]) throw new Error(`未知目标：${name}（可选 chrome / firefox）`)
}

function runVite(config, env) {
  const args = [VITE, 'build', '--config', config, ...(watch ? ['--watch'] : [])]
  const childEnv = { ...process.env, ...env }
  if (watch) {
    spawn(process.execPath, args, { cwd: root, stdio: 'inherit', env: childEnv })
    return
  }
  execFileSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: childEnv })
}

for (const name of names) {
  const target = TARGETS[name]
  const env = {
    TP_OUT_DIR: target.outDir,
    TP_BG_FORMAT: target.bgFormat,
    TP_TARGET: target.target,
  }

  console.log(`\n▶ ${name} → ${target.outDir}/（target=${target.target}, background=${target.bgFormat}）`)
  for (const config of CONFIGS) runVite(config, env)

  const manifest = buildManifest(name, baseManifest, pkg)
  writeFileSync(resolve(root, target.outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`✓ ${target.outDir}/manifest.json 已生成`)
}

if (watch) {
  console.log('\n⏳ 监听中，Ctrl+C 退出')
} else {
  console.log('\n构建完成，打包安装包请运行：npm run release')
}
