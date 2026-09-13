#!/usr/bin/env bash
# Phase 4 L2/L3: Subagent enter / pin / deleted nav (VP-4-sub).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$ROOT"
export PATH="/usr/local/n/versions/node/24.3.0/bin:${PATH:-}"
./node_modules/.bin/vitest run apps/vscode-dsh/tests/phase4-subagent-enter-pin.spec.ts
./node_modules/.bin/tsc -p apps/vscode-dsh/tsconfig.json --noEmit
