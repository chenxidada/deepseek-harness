import { defineConfig } from 'vitest/config'

/** Isolated vitest config for verifier-owned phase-2 scripts. */
export default defineConfig({
  test: {
    include: [
      '.specdev/specs/vscode-dsh-code-context-diff/phases/phase-2-change-list-display/test-scripts/**/*.spec.ts',
    ],
    environment: 'node',
  },
})
