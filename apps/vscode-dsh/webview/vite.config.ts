import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const webviewRoot = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  root: webviewRoot,
  base: './',
  build: {
    outDir: resolve(webviewRoot, 'dist'),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: resolve(webviewRoot, 'index.html'),
      output: {
        entryFileNames: 'assets/index.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
