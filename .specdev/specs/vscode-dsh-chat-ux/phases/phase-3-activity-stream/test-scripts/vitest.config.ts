import { defineConfig } from 'vitest/config'

/** Isolated vitest config for verifier-owned phase-3 activity-stream scripts. */
export default defineConfig({
  test: {
    include: [
      '.specdev/specs/vscode-dsh-chat-ux/phases/phase-3-activity-stream/test-scripts/**/*.spec.ts',
    ],
    environment: 'node',
  },
})
