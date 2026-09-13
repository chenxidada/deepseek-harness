#!/usr/bin/env bash
# Verifier runner for phase-1-foundation-render-probe (Node 22+ required).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$ROOT"
if command -v nvm >/dev/null 2>&1 || [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  nvm use 22.14.0 >/dev/null
fi
echo "node=$(node -v)"
echo "== implementer layer-A =="
./node_modules/.bin/vitest run apps/vscode-dsh/tests/layer-a/
echo "== panel regression =="
./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/phase3-chat-ui-chassis.spec.ts \
  apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts \
  apps/vscode-dsh/tests/phase2-change-list-display.spec.ts
echo "== verifier independent =="
./node_modules/.bin/vitest run \
  --config .specdev/specs/vscode-dsh-chat-ux/phases/phase-1-foundation-render-probe/test-scripts/vitest.config.ts
