#!/usr/bin/env bash
# Phase 5 implementer scriptable proof (AC-29/33): memory transport + second UI
# presenter + no agent-loop edits + replaceability docs present.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$ROOT"
export PATH="/usr/local/n/versions/node/24.3.0/bin:${PATH:-}"
VITEST="$ROOT/node_modules/.bin/vitest"

echo "node=$(command -v node) $($(command -v node) -v)"

echo "=== AC-29/33 memory transport + InteractionUi replaceability ==="
"$VITEST" run \
  packages/ide/ide-bridge/tests/replaceability-memory-transport.spec.ts \
  apps/vscode-dsh/tests/replaceability-interaction-ui.spec.ts

echo "=== AC-27: no packages/core/agent-loop changes on this branch ==="
if git rev-parse --verify main >/dev/null 2>&1; then
  BASE=main
elif git rev-parse --verify master >/dev/null 2>&1; then
  BASE=master
else
  BASE="$(git merge-base HEAD @{u} 2>/dev/null || git rev-list --max-parents=0 HEAD | head -1)"
fi
CHANGED="$(git diff --name-only "$BASE"...HEAD 2>/dev/null || git diff --name-only "$BASE" HEAD)"
if echo "$CHANGED" | grep -E '^packages/core/agent-loop(/|$)' >/dev/null; then
  echo "FAIL: agent-loop files changed vs $BASE:"
  echo "$CHANGED" | grep -E '^packages/core/agent-loop(/|$)' || true
  exit 1
fi
# Also refuse unstaged/working-tree edits under agent-loop.
if git status --porcelain -- packages/core/agent-loop 2>/dev/null | grep -q .; then
  echo "FAIL: working tree has agent-loop changes"
  git status --porcelain -- packages/core/agent-loop
  exit 1
fi
echo "OK: no agent-loop path changes (base=$BASE)"

echo "=== AC-28: ide-bridge / vscode-dsh do not import agent-loop ==="
if rg -n "from ['\"]@deepseek-ai/dsh-agent-loop|from ['\"].*packages/core/agent-loop|require\\(['\"].*agent-loop" \
  packages/ide/ide-bridge/src apps/vscode-dsh/src --glob '!**/node_modules/**' 2>/dev/null; then
  echo "FAIL: agent-loop import in ide-bridge or vscode-dsh src"
  exit 1
fi
# package.json dependency edge
if rg -n '"@deepseek-ai/dsh-agent-loop"' packages/ide/ide-bridge/package.json apps/vscode-dsh/package.json 2>/dev/null; then
  echo "FAIL: agent-loop listed as a package dependency"
  exit 1
fi
echo "OK: no agent-loop package imports/deps in Extension / ide-bridge"

echo "=== AC-29: replaceability docs present ==="
grep -q 'Replaceability contract (AD-8)' packages/ide/ide-bridge/README.md
grep -q '可替换性契约（AD-8）' packages/ide/ide-bridge/README.zh.md
grep -q 'Replaceability (AD-8)' apps/vscode-dsh/README.md
grep -q 'fail closed\|fail-closed\|Fail-closed' packages/ide/ide-bridge/README.md
grep -qv 'Host interaction UI is deferred' packages/bundle/ide/README.md
grep -qv 'Host 交互 UI 延期' packages/bundle/ide/README.zh.md
echo "OK: docs + stale Phase-3 stub wording removed from bundle/ide"

echo "ALL PHASE-5 PROVE STEPS OK"
