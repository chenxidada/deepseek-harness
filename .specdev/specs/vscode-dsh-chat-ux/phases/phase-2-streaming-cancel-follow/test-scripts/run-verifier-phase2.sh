#!/usr/bin/env bash
# Verifier runner for phase-2-streaming-cancel-follow (Node 22+ required).
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
bash .specdev/specs/vscode-dsh-chat-ux/phases/phase-2-streaming-cancel-follow/test-scripts/static-checks.sh
echo "== implementer layer-A =="
./node_modules/.bin/vitest run apps/vscode-dsh/tests/layer-a/
echo "== implementer layer-B + bridge =="
./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/chat-ux-streaming-cancel-follow.spec.ts \
  packages/ide/ide-bridge/tests/ide-bridge.spec.ts
echo "== verifier independent =="
./node_modules/.bin/vitest run \
  --config .specdev/specs/vscode-dsh-chat-ux/phases/phase-2-streaming-cancel-follow/test-scripts/vitest.config.ts
echo "== bridge cancel param variation =="
bash .specdev/specs/vscode-dsh-chat-ux/phases/phase-2-streaming-cancel-follow/test-scripts/bridge-cancel-param-variation.sh
echo "ALL VERIFIER PHASE-2 CHECKS DONE"
