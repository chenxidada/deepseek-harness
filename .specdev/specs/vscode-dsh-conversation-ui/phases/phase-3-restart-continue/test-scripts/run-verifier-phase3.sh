#!/usr/bin/env bash
# Phase 3 verifier: L2/L3 + independent scenarios + tsc.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$ROOT"
export PATH="/usr/local/n/versions/node/24.3.0/bin:${PATH:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> L2/L3 (run-phase3-l2-l3.sh)"
bash "$SCRIPT_DIR/run-phase3-l2-l3.sh"

echo "==> Verifier independent (V-IND-1..5)"
./node_modules/.bin/tsx "$SCRIPT_DIR/verifier-independent-phase3.mts"

echo "==> tsc apps/vscode-dsh --noEmit"
./node_modules/.bin/tsc -p apps/vscode-dsh/tsconfig.json --noEmit

echo "ALL VERIFIER STEPS OK"
