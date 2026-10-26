import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const root = process.cwd()

/**
 * CLI 构建：把零依赖的 diff 核心打成一个 Node ESM 单文件，
 * 只把内置模块（node:zlib 等）留作 external，产物可直接 node 执行。
 */
export default defineConfig({
  root,
  publicDir: false,
  resolve: {
    alias: { '@': resolve(root, 'src') },
  },
  build: {
    outDir: 'dist-cli',
    emptyOutDir: true,
    target: 'node18',
    minify: false,
    lib: {
      entry: resolve(root, 'src/cli/index.ts'),
      formats: ['es'],
      fileName: () => 'tracing-diff.mjs',
    },
    rollupOptions: {
      external: [/^node:/],
      output: { inlineDynamicImports: true },
    },
  },
})
