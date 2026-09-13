#!/usr/bin/env bash
# Verifier runner for phase-5-fork-retry-branch (Node 22+ required).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$ROOT"
if command -v nvm >/dev/null 2>&1 || [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  nvm use 22.14.0 >/dev/null
fi
echo "node=$(node -v)"
echo "== static checks =="
bash .specdev/specs/vscode-dsh-chat-ux/phases/phase-5-fork-retry-branch/test-scripts/static-checks.sh
echo "== implementer layer-B fork suite (record, do not trust alone) =="
./node_modules/.bin/vitest run apps/vscode-dsh/tests/chat-ux-fork-retry-branch.spec.ts
echo "== phase-2 streaming regression =="
./node_modules/.bin/vitest run apps/vscode-dsh/tests/chat-ux-streaming-cancel-follow.spec.ts
echo "== bridge fork implementer suite =="
./node_modules/.bin/vitest run packages/ide/ide-bridge/tests/ide-bridge.spec.ts -t "session/fork"
echo "== bridge emptySeed param variation (verifier) =="
bash .specdev/specs/vscode-dsh-chat-ux/phases/phase-5-fork-retry-branch/test-scripts/bridge-emptySeed-param-variation.sh
echo "== verifier independent =="
./node_modules/.bin/vitest run \
  --config .specdev/specs/vscode-dsh-chat-ux/phases/phase-5-fork-retry-branch/test-scripts/vitest.config.ts
echo "ALL VERIFIER PHASE-5 CHECKS DONE"
