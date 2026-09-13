#!/usr/bin/env bash
# Verifier runner for phase-4-refs-changes-diff (Node 22+ required).
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
bash .specdev/specs/vscode-dsh-chat-ux/phases/phase-4-refs-changes-diff/test-scripts/static-checks.sh
echo "== implementer layer-A =="
./node_modules/.bin/vitest run apps/vscode-dsh/tests/layer-a/
echo "== implementer layer-B phase-4 + chat-ux regression =="
./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/chat-ux-refs-changes-diff.spec.ts \
  apps/vscode-dsh/tests/chat-ux-activity-stream.spec.ts \
  apps/vscode-dsh/tests/chat-ux-streaming-cancel-follow.spec.ts
echo "== change-list product regression =="
./node_modules/.bin/vitest run apps/vscode-dsh/tests/phase2-change-list-display.spec.ts
echo "== verifier independent =="
./node_modules/.bin/vitest run \
  --config .specdev/specs/vscode-dsh-chat-ux/phases/phase-4-refs-changes-diff/test-scripts/vitest.config.ts
echo "ALL VERIFIER PHASE-4 CHECKS DONE"
