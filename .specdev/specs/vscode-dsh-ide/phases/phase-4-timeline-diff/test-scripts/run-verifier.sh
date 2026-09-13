#!/usr/bin/env bash
# Phase 4 verifier runner — independent scripts + implementer suite (recorded only).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$ROOT"
export PATH="/usr/local/n/versions/node/24.3.0/bin:${PATH:-}"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
echo "node=$($NODE_BIN -v) PATH node=$(command -v node)"

TSX="$ROOT/node_modules/.bin/tsx"
VITEST="$ROOT/node_modules/.bin/vitest"
SCRIPTS="$ROOT/.specdev/specs/vscode-dsh-ide/phases/phase-4-timeline-diff/test-scripts"

echo "=== verifier-independent-unit ==="
"$TSX" "$SCRIPTS/verifier-independent-unit.mts"

echo "=== verifier-independent-e2e ==="
"$TSX" "$SCRIPTS/verifier-independent-e2e.mts"

echo "=== implementer suite (recorded, not trusted alone) ==="
"$VITEST" run \
  apps/vscode-dsh/tests/timeline-projector.spec.ts \
  apps/vscode-dsh/tests/timeline-diff.integration.spec.ts \
  apps/vscode-dsh/tests/timeline-diff.e2e.spec.ts

echo "=== related regression (recorded) ==="
"$VITEST" run \
  apps/vscode-dsh/tests/multi-tab-session.integration.spec.ts \
  apps/vscode-dsh/tests/session-host.spec.ts \
  apps/vscode-dsh/tests/conversation-registry.spec.ts

echo "ALL VERIFIER STEPS OK"
