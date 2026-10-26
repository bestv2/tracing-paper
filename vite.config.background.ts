import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const root = process.cwd()

/**
 * background 构建。
 * - Chrome / Edge：ESM service worker（manifest.background.type = module）
 * - Firefox：MV3 只支持事件页 background.scripts，且按 classic 脚本解析 → 必须打成 IIFE
 * 由 TP_BG_FORMAT 切换（es / iife），见 scripts/build-ext.mjs。
 */
const format = process.env.TP_BG_FORMAT === 'iife' ? 'iife' : 'es'

export default defineConfig({
  root,
  publicDir: false,
  resolve: {
    alias: { '@': resolve(root, 'src') },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: process.env.TP_OUT_DIR || 'dist',
    emptyOutDir: false,
    target: process.env.TP_TARGET || 'chrome110',
    lib: {
      entry: resolve(root, 'src/background/index.ts'),
      name: 'TracingPaperBackground',
      formats: [format],
      fileName: () => 'background.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
})
