import { defineConfig } from 'vitest/config'

/** Isolated vitest config for verifier-owned phase-4 refs/changes/diff scripts. */
export default defineConfig({
  test: {
    include: [
      '.specdev/specs/vscode-dsh-chat-ux/phases/phase-4-refs-changes-diff/test-scripts/**/*.spec.ts',
    ],
    environment: 'node',
  },
})
