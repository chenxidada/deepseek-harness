#!/usr/bin/env bash
# Verifier runner for phase-1-code-context (Node 22+ required).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$ROOT"
if command -v nvm >/dev/null 2>&1 || [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  nvm use 22.14.0 >/dev/null
fi
echo "== implementer-cited suite =="
./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/phase1-code-context.spec.ts \
  packages/bundle/ide/tests/ide.spec.ts
echo "== FILE_REFERENCE_PROMPT assembly =="
./node_modules/.bin/vitest run \
  packages/context/file-reference-local/tests/service.spec.ts \
  -t "installs read-tool guidance"
echo "== panel regression =="
./node_modules/.bin/vitest run apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts
echo "== verifier independent =="
./node_modules/.bin/vitest run \
  --config .specdev/specs/vscode-dsh-code-context-diff/phases/phase-1-code-context/test-scripts/vitest.config.ts
