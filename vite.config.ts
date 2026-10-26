import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const root = process.cwd()

/**
 * 主构建：popup 页面（ESM）。
 * background / 内容脚本 / 引导脚本分别由 vite.config.background.ts / .overlay.ts / .bootstrap.ts 构建，
 * 以便按浏览器切换格式（Chrome 的 ESM service worker vs Firefox 的 classic 事件页）。
 * 输出目录与语法目标由 TP_OUT_DIR / TP_TARGET 控制，见 scripts/build-ext.mjs。
 */
export default defineConfig({
  root,
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(root, 'src') },
  },
  build: {
    outDir: process.env.TP_OUT_DIR || 'dist',
    emptyOutDir: true,
    target: process.env.TP_TARGET || 'chrome110',
    rollupOptions: {
      input: {
        popup: resolve(root, 'popup.html'),
      },
      output: {
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
