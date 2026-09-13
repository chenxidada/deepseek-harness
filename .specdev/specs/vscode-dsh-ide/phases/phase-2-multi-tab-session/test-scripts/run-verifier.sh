#!/usr/bin/env bash
# Phase 2 verifier runner — independent scripts + implementer suite (for matrix only).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$ROOT"
export PATH="/usr/local/n/versions/node/24.3.0/bin:${PATH:-}"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
echo "node=$($NODE_BIN -v) PATH node=$(command -v node)"

TSX="$ROOT/node_modules/.bin/tsx"
VITEST="$ROOT/node_modules/.bin/vitest"
SCRIPTS="$ROOT/.specdev/specs/vscode-dsh-ide/phases/phase-2-multi-tab-session/test-scripts"

echo "=== verifier-independent-unit ==="
"$TSX" "$SCRIPTS/verifier-independent-unit.mts"

echo "=== verifier-dispose-map-handle ==="
"$TSX" "$SCRIPTS/verifier-dispose-map-handle.mts"

echo "=== verifier-independent-e2e ==="
"$TSX" "$SCRIPTS/verifier-independent-e2e.mts"

echo "=== verifier-gap-003-004-e2e ==="
"$TSX" "$SCRIPTS/verifier-gap-003-004-e2e.mts"

echo "=== implementer suite (recorded, not trusted alone) ==="
"$VITEST" run apps/vscode-dsh/tests packages/ide/ide-bridge/tests/ide-bridge.spec.ts
"$VITEST" run packages/sdk/server/tests/server.spec.ts -t "disposeSession clears"
"$VITEST" run apps/vscode-dsh/tests/gap-003-004-debt-fix.spec.ts

echo "ALL VERIFIER STEPS OK"
