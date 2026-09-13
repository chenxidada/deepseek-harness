#!/usr/bin/env bash
# Phase-5 verifier runner — implementer suite + independent + tsc
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$ROOT"
export PATH="/usr/local/n/versions/node/24.3.0/bin:${PATH}"

PHASE_DIR=".specdev/specs/vscode-dsh-chat-ready/phases/phase-5-should-polish"
SCRIPTS="$PHASE_DIR/test-scripts"

echo "== [1] vitest phase5 + phase3/4 related =="
./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/phase5-should-polish.spec.ts \
  apps/vscode-dsh/tests/phase4-new-conversation-chrome.spec.ts \
  apps/vscode-dsh/tests/phase3-restart-continue.spec.ts \
  apps/vscode-dsh/tests/phase3-chat-ui-chassis.spec.ts

echo "== [2] verifier independent =="
./node_modules/.bin/tsx "$SCRIPTS/verifier-independent-phase5.mts"

echo "== [3] tsc apps/vscode-dsh =="
./node_modules/.bin/tsc -p apps/vscode-dsh/tsconfig.json --noEmit

echo "== [4] agent-loop untouched =="
if git diff --name-only | grep -q 'packages/core/agent-loop'; then
  echo "FAIL: agent-loop modified"
  exit 1
fi
echo "OK: no agent-loop changes in working tree"

echo "ALL VERIFIER STEPS OK"
