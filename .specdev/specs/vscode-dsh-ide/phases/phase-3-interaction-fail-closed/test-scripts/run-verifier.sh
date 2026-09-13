#!/usr/bin/env bash
# Phase 3 verifier runner — independent scripts + implementer suite (recorded only).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$ROOT"
export PATH="/usr/local/n/versions/node/24.3.0/bin:${PATH:-}"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
echo "node=$($NODE_BIN -v) PATH node=$(command -v node)"

TSX="$ROOT/node_modules/.bin/tsx"
VITEST="$ROOT/node_modules/.bin/vitest"
SCRIPTS="$ROOT/.specdev/specs/vscode-dsh-ide/phases/phase-3-interaction-fail-closed/test-scripts"

echo "=== verifier-independent-unit ==="
"$TSX" "$SCRIPTS/verifier-independent-unit.mts"

echo "=== verifier-independent-e2e ==="
"$TSX" "$SCRIPTS/verifier-independent-e2e.mts"

echo "=== implementer suite (recorded, not trusted alone) ==="
"$VITEST" run \
  packages/ide/ide-bridge/tests/ide-bridge.spec.ts \
  apps/vscode-dsh/tests/

echo "=== gap-005-009 debt-fix suite (recorded) ==="
"$VITEST" run apps/vscode-dsh/tests/gap-005-009-debt-fix.spec.ts

echo "ALL VERIFIER STEPS OK"
