#!/usr/bin/env bash
# Verifier runner — phase-3-chat-ui-chassis (independent + implementer + regression + tsc)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$ROOT"
export PATH="/usr/local/n/versions/node/24.3.0/bin:${PATH}"
TSX="${ROOT}/node_modules/.bin/tsx"
VITEST="${ROOT}/node_modules/.bin/vitest"
TSC="${ROOT}/node_modules/.bin/tsc"
PHASE_SCRIPTS="$(cd "$(dirname "$0")" && pwd)"

echo "=== [1/4] Verifier independent V-IND-1..13 (incl. SF suite ownership) ==="
"$TSX" "$PHASE_SCRIPTS/verifier-independent-phase3.mts"

echo "=== [2/4] Implementer phase3 suite (recorded, not trusted alone) ==="
"$VITEST" run apps/vscode-dsh/tests/phase3-chat-ui-chassis.spec.ts

echo "=== [3/4] Full apps/vscode-dsh regression (AC-27) ==="
"$VITEST" run apps/vscode-dsh/tests

echo "=== [4/4] tsc --noEmit ==="
"$TSC" -p apps/vscode-dsh/tsconfig.json --noEmit

echo "ALL VERIFIER STEPS OK"
