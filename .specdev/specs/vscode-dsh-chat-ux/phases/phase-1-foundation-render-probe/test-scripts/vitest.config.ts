import { defineConfig } from 'vitest/config'

/** Isolated vitest config for verifier-owned phase-1 foundation scripts. */
export default defineConfig({
  test: {
    include: [
      '.specdev/specs/vscode-dsh-chat-ux/phases/phase-1-foundation-render-probe/test-scripts/**/*.spec.ts',
    ],
    environment: 'node',
  },
})
