import { defineConfig } from 'vitest/config'

/** Isolated vitest config for verifier-owned phase-6 session-search scripts. */
export default defineConfig({
  test: {
    include: [
      '.specdev/specs/vscode-dsh-chat-ux/phases/phase-6-session-search/test-scripts/**/*.spec.ts',
    ],
    environment: 'node',
  },
})
