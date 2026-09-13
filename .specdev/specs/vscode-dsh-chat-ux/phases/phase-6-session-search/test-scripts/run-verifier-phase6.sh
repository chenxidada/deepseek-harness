#!/usr/bin/env bash
# Verifier runner for phase-6-session-search (Node 22+ required).
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
bash .specdev/specs/vscode-dsh-chat-ux/phases/phase-6-session-search/test-scripts/static-checks.sh
echo "== implementer layer-B session-search suite (record, do not trust alone) =="
./node_modules/.bin/vitest run apps/vscode-dsh/tests/chat-ux-session-search.spec.ts
echo "== phase-5 fork regression =="
./node_modules/.bin/vitest run apps/vscode-dsh/tests/chat-ux-fork-retry-branch.spec.ts
echo "== phase-1 auto-start / openHistory regression (Query/browse ≠ Start) =="
./node_modules/.bin/vitest run apps/vscode-dsh/tests/phase1-auto-start.spec.ts -t "AC-1c|openHistory"
echo "== verifier independent =="
./node_modules/.bin/vitest run \
  --config .specdev/specs/vscode-dsh-chat-ux/phases/phase-6-session-search/test-scripts/vitest.config.ts
echo "ALL VERIFIER PHASE-6 CHECKS DONE"
