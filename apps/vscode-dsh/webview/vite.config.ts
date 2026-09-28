import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const webviewRoot = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  root: webviewRoot,
  base: './',
  resolve: {
    alias: {
      '@dsh/safe-markdown': resolve(webviewRoot, '../src/markdown/rich-markdown.ts'),
    },
  },
  server: {
    fs: {
      allow: [resolve(webviewRoot, '..')],
    },
  },
  build: {
    outDir: resolve(webviewRoot, 'dist'),
    emptyOutDir: true,
    sourcemap: false,
    // Every surface loads its own document from this dist directory, and each Host
    // document links one stylesheet. Splitting CSS per entry would hoist the shared
    // design system into a sheet neither entry's document names.
    cssCodeSplit: false,
    rollupOptions: {
      input: {
        // One entry per shipped surface: the Conversation Panel SPA and the History
        // sidebar view load their own document from the same dist directory.
        index: resolve(webviewRoot, 'index.html'),
        sidebar: resolve(webviewRoot, 'sidebar.html'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
