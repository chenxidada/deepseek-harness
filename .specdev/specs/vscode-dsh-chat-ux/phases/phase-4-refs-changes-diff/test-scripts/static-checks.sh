#!/usr/bin/env bash
# Static / source-level checks for phase-4-refs-changes-diff (verifier-owned).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$ROOT"
fail=0

check() {
  local name="$1"
  shift
  if "$@"; then
    echo "PASS: $name"
  else
    echo "FAIL: $name"
    fail=1
  fi
}

# O-3: packages/core/agent-loop must not be touched.
check "no agent-loop edits vs HEAD" \
  bash -c '! git diff --name-only HEAD -- packages/core/agent-loop | grep -q .'
check "no untracked agent-loop files" \
  bash -c '! git status -u --porcelain -- packages/core/agent-loop | grep -q .'

# DEBT-CUX-001 closed: extract module exists + provider calls it.
check "change-diff-dom.ts exists" \
  test -f apps/vscode-dsh/src/chat-panel/render/change-diff-dom.ts
check "ref-cards.ts exists" \
  test -f apps/vscode-dsh/src/chat-panel/render/ref-cards.ts
check "provider embeds changeDiffDomBrowserSource" \
  grep -q 'changeDiffDomBrowserSource' apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts
check "provider embeds refCardsBrowserSource" \
  grep -q 'refCardsBrowserSource' apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts
check "provider embeds atPathExtractBrowserSource" \
  grep -q 'atPathExtractBrowserSource' apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts
check "provider calls renderChangeListBubble" \
  grep -q 'renderChangeListBubble' apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts
check "provider calls fillUserBubbleWithRefCards" \
  grep -q 'fillUserBubbleWithRefCards' apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts
check "provider calls syncComposerRefCards" \
  grep -q 'syncComposerRefCards' apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts

# R5 / AD-CUX-11: no third local @ grammar in provider (legacy renderUserTextWithRefCards regex path).
check "provider has no local @ card regex helper" \
  bash -c '! grep -nE "function renderUserTextWithRefCards|/\\(\\?:\\^\\|\\[\\\\s\\]\\)\\(@\\(" apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts | grep -q .'

# T8 native path wired Host + protocol + extension.
check "protocol declares change/open-native-diff" \
  grep -q "change/open-native-diff" apps/vscode-dsh/src/chat-panel/protocol.ts
check "host routes change/open-native-diff" \
  grep -q "requestChangeOpenNativeDiff" apps/vscode-dsh/src/chat-panel/chat-panel-host.ts
check "extension wires openChangedNativeDiff" \
  grep -q "openChangedNativeDiff" apps/vscode-dsh/src/extension.ts
check "diff-entry exports openChangeSnapshotDiff" \
  grep -q "openChangeSnapshotDiff" apps/vscode-dsh/src/diff-entry.ts

# DEBT-CUX-001 in resolved table, not active.
check "DEBT-CUX-001 in resolved table" \
  bash -c 'grep -A2 "DEBT-CUX-001" .specdev/specs/vscode-dsh-chat-ux/tech-debt-registry.md | grep -q "phase-4-refs-changes-diff"'
check "DEBT-CUX-001 not in active debt body" \
  bash -c '! awk "/^## 活跃债务/,/^## 已解决/" .specdev/specs/vscode-dsh-chat-ux/tech-debt-registry.md | grep -q DEBT-CUX-001'

# Branch convention (soft).
branch="$(git branch --show-current)"
if [[ "$branch" == "impl-phase-4-refs-changes-diff" ]]; then
  echo "PASS: on impl-phase-4-refs-changes-diff"
else
  echo "WARN: expected impl-phase-4-refs-changes-diff, got $branch"
fi

if [[ "$fail" -ne 0 ]]; then
  echo "static-checks FAILED"
  exit 1
fi
echo "static-checks PASSED"
