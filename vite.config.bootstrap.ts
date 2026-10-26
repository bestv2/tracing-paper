import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const root = process.cwd()

/**
 * 引导脚本构建：常驻所有页面，但不含 React。
 * 只负责：上报开关状态、页面刷新后按需唤起走查 UI。
 */
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
      entry: resolve(root, 'src/bootstrap/index.ts'),
      name: 'TracingPaperBootstrap',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
})
