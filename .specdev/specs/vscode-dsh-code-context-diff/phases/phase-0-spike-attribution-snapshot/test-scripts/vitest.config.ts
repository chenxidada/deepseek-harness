import { defineConfig } from 'vitest/config'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../../../../../')

export default defineConfig({
  root: repoRoot,
  test: {
    include: [
      resolve(here, 'verifier-independent.spec.ts'),
    ],
  },
})
