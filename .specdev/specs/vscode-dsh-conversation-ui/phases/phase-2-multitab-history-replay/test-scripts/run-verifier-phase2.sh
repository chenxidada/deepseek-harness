#!/usr/bin/env bash
# Phase 2 verifier: L2/L3 suite + independent scenarios + tsc.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$ROOT"
export PATH="/usr/local/n/versions/node/24.3.0/bin:${PATH:-}"
PHASE_SCRIPTS="$(cd "$(dirname "$0")" && pwd)"

echo "== Phase2 L2/L3 (implementer suite; evidence only) =="
bash "$PHASE_SCRIPTS/run-phase2-l2-l3.sh"

echo "== Verifier independent Phase2 =="
./node_modules/.bin/tsx "$PHASE_SCRIPTS/verifier-independent-phase2.mts"

echo "== tsc apps/vscode-dsh =="
./node_modules/.bin/tsc -p apps/vscode-dsh/tsconfig.json --noEmit
echo "tsc_exit=$?"

echo "ALL VERIFIER STEPS OK"
