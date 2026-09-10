import { defineConfig } from 'vitest/config'

/** Isolated vitest config for verifier-owned phase-2 streaming/cancel/follow scripts. */
export default defineConfig({
  test: {
    include: [
      '.specdev/specs/vscode-dsh-chat-ux/phases/phase-2-streaming-cancel-follow/test-scripts/**/*.spec.ts',
    ],
    environment: 'node',
  },
})
