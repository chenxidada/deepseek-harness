#!/usr/bin/env bash
# Verifier runner: implementer L2/L3 suite + independent scenarios (AC-54/84).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$ROOT"
export PATH="${PATH:-}"
if [[ -x /usr/local/n/versions/node/24.3.0/bin/node ]]; then
  export PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH"
fi

PHASE_SCRIPTS="$(cd "$(dirname "$0")" && pwd)"

echo "== (1) implementer Phase-1 L2/L3 runner =="
bash "$PHASE_SCRIPTS/run-phase1-l2-l3.sh"

echo "== (2) verifier-independent scenarios =="
./node_modules/.bin/tsx "$PHASE_SCRIPTS/verifier-independent-phase1.mts"

echo "== (3) full apps/vscode-dsh vitest =="
./node_modules/.bin/vitest run apps/vscode-dsh/tests

echo "== (4) tsc --noEmit =="
./node_modules/.bin/tsc -p apps/vscode-dsh/tsconfig.json --noEmit

echo "ALL VERIFIER PHASE-1 STEPS OK"
