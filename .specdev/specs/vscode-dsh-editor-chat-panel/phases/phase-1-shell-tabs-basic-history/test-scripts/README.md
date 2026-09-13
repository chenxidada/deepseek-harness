# Phase 1 verifier scripts

Vitest include only matches `apps/*/tests/**`, so independent Layer A/B suites live at:

- `apps/vscode-dsh/tests/verifier-phase1/layer-a-rtl.spec.tsx`
- `apps/vscode-dsh/tests/verifier-phase1/layer-b-lifecycle.spec.ts`

This directory keeps:

- `run-verifier.sh` — orchestrator
- `layer-v-capability-probe.mjs` — Layer V env + static proxy
- archived copies of early drafts (`verifier-layer-*.spec.*`) if present

Run: `bash .specdev/specs/vscode-dsh-editor-chat-panel/phases/phase-1-shell-tabs-basic-history/test-scripts/run-verifier.sh`
