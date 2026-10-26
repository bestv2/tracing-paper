import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const root = process.cwd()

/**
 * 走查 UI 构建：单文件 IIFE，CSS 通过 ?inline 打进 JS（注入 Shadow DOM），
 * 不产生任何全局样式文件，避免参考版本全局注入带来的样式污染。
 * 该文件仅在用户开启工具时由 chrome.scripting 按需注入。
 */
export default defineConfig({
  root,
  publicDir: false,
  plugins: [react()],
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
    cssCodeSplit: false,
    lib: {
      entry: resolve(root, 'src/content/index.tsx'),
      name: 'TracingPaper',
      formats: ['iife'],
      fileName: () => 'overlay.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
})
