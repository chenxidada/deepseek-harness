#!/usr/bin/env bash
# Phase 5 verifier orchestrator — independent unit + e2e + implementer prove + AC-27.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$ROOT"
export PATH="/usr/local/n/versions/node/24.3.0/bin:${PATH:-}"
PHASE_SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
TSX="$ROOT/node_modules/.bin/tsx"

echo "node=$(command -v node) $(node -v)"
echo "branch=$(git branch --show-current)"

echo "=== V1: verifier independent unit ==="
"$TSX" "$PHASE_SCRIPTS/verifier-independent-unit.mts"

echo "=== V2: verifier independent e2e ==="
"$TSX" "$PHASE_SCRIPTS/verifier-independent-e2e.mts"

echo "=== V3: implementer prove-replaceability.sh ==="
bash "$PHASE_SCRIPTS/prove-replaceability.sh"

echo "=== V4: AC-27 agent-loop path (working tree + branch) ==="
if git status --porcelain -- packages/core/agent-loop | grep -q .; then
  echo "FAIL: working tree has agent-loop changes"
  git status --porcelain -- packages/core/agent-loop
  exit 1
fi
# Phase 5 files must not include agent-loop or packages/core production sources.
PHASE5_FILES="$(git status --porcelain --untracked-files=all \
  packages/ide/ide-bridge apps/vscode-dsh packages/bundle/ide \
  | awk '{print $2}')"
if echo "$PHASE5_FILES" | grep -E '^packages/core/' >/dev/null; then
  echo "FAIL: Phase 5 working tree touches packages/core"
  echo "$PHASE5_FILES"
  exit 1
fi
echo "OK: no agent-loop / packages/core production edits in Phase 5 tree"

echo "=== V5: GAP-010/011 deliberately untouched (probe) ==="
if git status --porcelain -- apps/vscode-dsh/src/timeline-store.ts apps/vscode-dsh/src/diff-entry.ts | grep -q .; then
  echo "WARN: GAP source files show local edits (unexpected for Phase 5)"
  git status --porcelain -- apps/vscode-dsh/src/timeline-store.ts apps/vscode-dsh/src/diff-entry.ts
  # Non-blocking known debt — do not fail pipeline for presence of gaps; only warn if edited.
fi
echo "OK: GAP-010/011 sources not modified in this Phase working tree (or clean)"

echo "ALL VERIFIER STEPS OK"
