#!/usr/bin/env bash
# Verifier orchestrator — Phase 1 vscode-dsh-editor-chat-panel
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../../" && pwd)"
PHASE_SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "=== Verifier Layer A (independent RTL) ==="
pnpm exec vitest run \
  apps/vscode-dsh/tests/verifier-phase1/layer-a-rtl.spec.tsx \
  --reporter=verbose

echo "=== Verifier Layer B (independent FakeWebview) ==="
pnpm exec vitest run \
  apps/vscode-dsh/tests/verifier-phase1/layer-b-lifecycle.spec.ts \
  --reporter=verbose

echo "=== Implementer suites (secondary; not sole evidence) ==="
pnpm exec vitest run \
  apps/vscode-dsh/tests/layer-a-rtl/editor-chat-shell.spec.tsx \
  apps/vscode-dsh/tests/editor-chat-panel.lifecycle.spec.ts \
  --reporter=dot

echo "=== Layer V capability probe ==="
node "$PHASE_SCRIPTS/layer-v-capability-probe.mjs"

echo "=== webview:build smoke ==="
pnpm --filter @deepseek-ai/dsh-vscode-dsh run webview:build

echo "=== ALL VERIFIER STEPS COMPLETE ==="
