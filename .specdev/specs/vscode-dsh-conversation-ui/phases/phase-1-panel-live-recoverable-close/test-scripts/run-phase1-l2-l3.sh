#!/usr/bin/env bash
# Phase 1 L2 + L3 runner (AC-54/84 / VP-1-*).
# Repo-equivalent Extension Host harness: vitest + duck-typed vscode (no @vscode/test-electron required).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$ROOT"
export PATH="${PATH:-}"
if [[ -x /usr/local/n/versions/node/24.3.0/bin/node ]]; then
  export PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH"
fi

echo "== Phase 1 L1 message-store / index =="
./node_modules/.bin/vitest run apps/vscode-dsh/tests/message-store-index.spec.ts

echo "== Phase 1 L2/L3 protocol + activate hooks =="
./node_modules/.bin/vitest run apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts

echo "== Phase 1 close/delete e2e (VP-1-close/delete/empty) =="
./node_modules/.bin/vitest run apps/vscode-dsh/tests/panel-close-delete.e2e.spec.ts

echo "== Phase 1 rewritten close≠dispose regressions =="
./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/multi-tab-dispose.e2e.spec.ts \
  apps/vscode-dsh/tests/gap-003-004-debt-fix.spec.ts \
  apps/vscode-dsh/tests/gap-005-009-debt-fix.spec.ts

echo "ALL PHASE-1 L2/L3 STEPS OK"
