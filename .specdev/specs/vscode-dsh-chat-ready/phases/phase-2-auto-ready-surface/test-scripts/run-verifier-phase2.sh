#!/usr/bin/env bash
# Phase 2 verifier: implementer L2 (recorded, not trusted) + independent V-IND + regression + tsc.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$ROOT"
export PATH="/usr/local/n/versions/node/24.3.0/bin:${PATH:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Implementer L2 (phase2 + phase1 + orchestrator) — recorded, not trusted alone"
./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/phase2-auto-ready.spec.ts \
  apps/vscode-dsh/tests/phase1-auto-start.spec.ts \
  apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts

echo "==> Focused AC-1a reverse (phase1) still green"
./node_modules/.bin/vitest run apps/vscode-dsh/tests/phase1-auto-start.spec.ts \
  -t "AC-1a reverse"

echo "==> Focused hide→show during applyInFlight (implementer L1 — recorded)"
./node_modules/.bin/vitest run apps/vscode-dsh/tests/phase2-auto-ready.spec.ts \
  -t "hide→show during applyInFlight"

echo "==> Verifier independent V-IND-1..11"
./node_modules/.bin/tsx "$SCRIPT_DIR/verifier-independent-phase2.mts"

echo "==> AC-27 regression sample: restore/continue + multitab + close/delete"
./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/phase3-restart-continue.spec.ts \
  apps/vscode-dsh/tests/phase2-multitab-history-replay.spec.ts \
  apps/vscode-dsh/tests/panel-close-delete.e2e.spec.ts

echo "==> Full apps/vscode-dsh/tests regression"
./node_modules/.bin/vitest run apps/vscode-dsh/tests

echo "==> tsc apps/vscode-dsh --noEmit"
./node_modules/.bin/tsc -p apps/vscode-dsh/tsconfig.json --noEmit

echo "ALL VERIFIER STEPS OK"
