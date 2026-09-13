import { defineConfig } from 'vitest/config'

/** Isolated vitest config for verifier-owned phase-3 scripts. */
export default defineConfig({
  test: {
    include: [
      '.specdev/specs/vscode-dsh-code-context-diff/phases/phase-3-review-revert-replay/test-scripts/**/*.spec.ts',
    ],
    environment: 'node',
  },
})
