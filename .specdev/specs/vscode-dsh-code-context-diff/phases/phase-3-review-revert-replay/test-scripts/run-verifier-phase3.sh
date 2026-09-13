#!/usr/bin/env bash
# Verifier runner for phase-3-review-revert-replay (Node 22+ required).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$ROOT"
if command -v nvm >/dev/null 2>&1 || [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  nvm use 22.14.0 >/dev/null
fi
echo "== implementer suite (phase3) =="
./node_modules/.bin/vitest run apps/vscode-dsh/tests/phase3-review-revert-replay.spec.ts
echo "== regression (phase2 + chat-ready + restart-continue) =="
./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/phase2-change-list-display.spec.ts \
  apps/vscode-dsh/tests/chat-ready-regression.spec.ts \
  apps/vscode-dsh/tests/phase3-restart-continue.spec.ts
echo "== verifier independent =="
./node_modules/.bin/vitest run \
  --config .specdev/specs/vscode-dsh-code-context-diff/phases/phase-3-review-revert-replay/test-scripts/vitest.config.ts
