import { defineConfig } from 'vitest/config'

/** Isolated vitest config for verifier-owned phase-1 scripts. */
export default defineConfig({
  test: {
    include: [
      '.specdev/specs/vscode-dsh-code-context-diff/phases/phase-1-code-context/test-scripts/**/*.spec.ts',
    ],
    environment: 'node',
  },
})
