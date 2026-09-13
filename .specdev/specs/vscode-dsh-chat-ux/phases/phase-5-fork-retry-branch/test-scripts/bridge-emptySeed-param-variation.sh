#!/usr/bin/env bash
# Bridge emptySeed parameter-variation (independent of implementer boundarySeq-only case).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$ROOT"
if command -v nvm >/dev/null 2>&1 || [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  nvm use 22.14.0 >/dev/null
fi
# Resolve cordis from ide-bridge package node_modules
export NODE_PATH="${ROOT}/packages/ide/ide-bridge/node_modules:${NODE_PATH:-}"
exec node --import tsx --experimental-import-meta-resolve "$(dirname "$0")/bridge-emptySeed-param-variation.mts"
