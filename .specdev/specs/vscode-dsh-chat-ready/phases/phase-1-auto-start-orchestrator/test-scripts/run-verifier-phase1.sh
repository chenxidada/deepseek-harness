#!/usr/bin/env bash
# Phase 1 verifier: L1 orchestrator + L2 phase1 + independent scenarios + tsc + static gates.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$ROOT"
export PATH="/usr/local/n/versions/node/24.3.0/bin:${PATH:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> L1 AutoStartOrchestrator + L2 phase1-auto-start"
./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts \
  apps/vscode-dsh/tests/phase1-auto-start.spec.ts

echo "==> Focused AC-1a + AC-13 connecting + deleteHistory unbound/bound (implementer L2)"
./node_modules/.bin/vitest run apps/vscode-dsh/tests/phase1-auto-start.spec.ts \
  -t "AC-1a reverse|AC-13: Host starting|AC-1e: deleteHistory unbound|AC-1e: deleteHistory bound"

echo "==> Verifier independent (V-IND-1..12)"
./node_modules/.bin/tsx "$SCRIPT_DIR/verifier-independent-phase1.mts"

echo "==> Static README matrix + agent-loop gate"
bash "$SCRIPT_DIR/verify-static-phase1.sh"

echo "==> Regression: full apps/vscode-dsh/tests"
./node_modules/.bin/vitest run apps/vscode-dsh/tests

echo "==> tsc apps/vscode-dsh --noEmit"
./node_modules/.bin/tsc -p apps/vscode-dsh/tsconfig.json --noEmit

echo "ALL VERIFIER STEPS OK"
