#!/usr/bin/env bash
# Phase 3 L2/L3: restart restore, Diff before, Continue same-id (GAP-001).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$ROOT"
export PATH="/usr/local/n/versions/node/24.3.0/bin:${PATH:-}"
./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/phase3-restart-continue.spec.ts \
  packages/ide/ide-bridge/tests/ide-bridge.spec.ts \
  apps/vscode-dsh/tests/timeline-diff.integration.spec.ts
