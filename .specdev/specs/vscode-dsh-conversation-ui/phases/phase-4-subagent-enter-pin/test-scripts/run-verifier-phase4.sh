#!/usr/bin/env bash
# Phase 4 verifier: L2/L3 + independent scenarios + tsc.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$ROOT"
export PATH="/usr/local/n/versions/node/24.3.0/bin:${PATH:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> L2/L3 (run-phase4-l2-l3.sh)"
bash "$SCRIPT_DIR/run-phase4-l2-l3.sh"

echo "==> Verifier independent (V-IND-1..5)"
./node_modules/.bin/tsx "$SCRIPT_DIR/verifier-independent-phase4.mts"

echo "==> Verifier independent e2e (V-IND-A..E + V-SF-1 closed)"
./node_modules/.bin/tsx "$SCRIPT_DIR/verifier-e2e-phase4.mts"

echo "==> Verifier SHOULD-FIX closure (V-FIX-1/2)"
./node_modules/.bin/tsx "$SCRIPT_DIR/verifier-should-fix-phase4.mts"

echo "==> Full apps/vscode-dsh vitest (regression)"
./node_modules/.bin/vitest run apps/vscode-dsh/tests

echo "==> tsc apps/vscode-dsh --noEmit"
./node_modules/.bin/tsc -p apps/vscode-dsh/tsconfig.json --noEmit

echo "ALL VERIFIER STEPS OK"
