import { defineConfig } from 'vitest/config'

/** Isolated vitest config for verifier-owned phase-5 fork/retry/branch scripts. */
export default defineConfig({
  test: {
    include: [
      '.specdev/specs/vscode-dsh-chat-ux/phases/phase-5-fork-retry-branch/test-scripts/**/*.spec.ts',
    ],
    environment: 'node',
  },
})
