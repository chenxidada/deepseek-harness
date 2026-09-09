#!/usr/bin/env bash
# Phase 4 verifier runner — independent + implementer suite + AC-27 regression + tsc
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$ROOT"
export PATH="/usr/local/n/versions/node/24.3.0/bin:${PATH:-}"
VITEST=./node_modules/.bin/vitest
TSC=./node_modules/.bin/tsc
PHASE_SCRIPTS=".specdev/specs/vscode-dsh-chat-ready/phases/phase-4-new-conversation-chrome/test-scripts"

echo "=== V-IND independent ==="
./node_modules/.bin/tsx "$PHASE_SCRIPTS/verifier-independent-phase4.mts"

echo "=== Implementer phase4 suite ==="
"$VITEST" run apps/vscode-dsh/tests/phase4-new-conversation-chrome.spec.ts

echo "=== AC-27 / feature regression (prior L2) ==="
"$VITEST" run \
  apps/vscode-dsh/tests/phase1-auto-start.spec.ts \
  apps/vscode-dsh/tests/phase2-auto-ready.spec.ts \
  apps/vscode-dsh/tests/phase3-chat-ui-chassis.spec.ts \
  apps/vscode-dsh/tests/phase3-restart-continue.spec.ts \
  apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts \
  apps/vscode-dsh/tests/panel-close-delete.e2e.spec.ts

echo "=== Static DEBT-003 / chrome source probes ==="
bash "$PHASE_SCRIPTS/verify-static-phase4.sh"

echo "=== tsc ==="
"$TSC" -p apps/vscode-dsh/tsconfig.json --noEmit

echo "ALL VERIFIER STEPS OK"
