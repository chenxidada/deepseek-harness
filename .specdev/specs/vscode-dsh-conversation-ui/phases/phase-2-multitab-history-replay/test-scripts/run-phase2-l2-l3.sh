#!/usr/bin/env bash
# Phase 2 L2/L3: unread/approval queue, history replay, DEBT-001/002.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$ROOT"
export PATH="/usr/local/n/versions/node/24.3.0/bin:${PATH:-}"
./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/phase2-multitab-history-replay.spec.ts \
  packages/ide/ide-bridge/tests/ide-bridge.spec.ts \
  apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts
