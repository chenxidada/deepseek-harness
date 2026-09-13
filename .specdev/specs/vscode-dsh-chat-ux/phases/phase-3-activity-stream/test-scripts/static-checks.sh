#!/usr/bin/env bash
# Static / source-level checks for phase-3-activity-stream (verifier-owned).
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

# O-3: packages/core/agent-loop must not be touched by this Phase.
check "no agent-loop edits in working tree vs HEAD for core" \
  bash -c '! git diff --name-only HEAD -- packages/core/agent-loop | grep -q .'
check "no untracked agent-loop files" \
  bash -c '! git status -u --porcelain -- packages/core/agent-loop | grep -q .'

# Product path fills probes.setActivity (GAP-CUX-001) — activity-dom must call it.
check "activity-dom product calls setActivity" \
  grep -q 'probes.setActivity' apps/vscode-dsh/src/chat-panel/render/activity-dom.ts

# Provider embeds activity-dom and routes kind=activity.
check "provider embeds activityDomBrowserSource" \
  grep -q 'activityDomBrowserSource' apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts
check "provider renderBubble activity branch" \
  grep -q 'renderActivityBubble' apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts

# Host outbound activityStatus wiring.
check "host pushPatch transmits activityStatus" \
  grep -q 'activityStatus' apps/vscode-dsh/src/chat-panel/chat-panel-host.ts
check "protocol declares messages/patch.activityStatus" \
  grep -q 'activityStatus' apps/vscode-dsh/src/chat-panel/protocol.ts

# Hydrator foldActivities present.
check "replay-hydrator foldActivities" \
  grep -q 'foldActivities' apps/vscode-dsh/src/replay-hydrator.ts

# Cancel abort path without inventing revert.
check "abortRunningActivities exists" \
  grep -q 'abortRunningActivities' apps/vscode-dsh/src/conversation-controller.ts
check "projectToolCallActivity exists" \
  grep -q 'projectToolCallActivity' apps/vscode-dsh/src/conversation-controller.ts

# GAP-CUX-001 closed in registry.
check "GAP-CUX-001 in resolved table" \
  bash -c 'grep -A2 "GAP-CUX-001" .specdev/specs/vscode-dsh-chat-ux/tech-debt-registry.md | grep -q "phase-3-activity-stream"'
check "GAP-CUX-001 not in active debt table body" \
  bash -c '! awk "/^## 活跃债务/,/^## 已解决/" .specdev/specs/vscode-dsh-chat-ux/tech-debt-registry.md | grep -q GAP-CUX-001'

# Branch name convention (informational soft check).
branch="$(git branch --show-current)"
if [[ "$branch" == "impl-phase-3-activity-stream" ]]; then
  echo "PASS: on impl-phase-3-activity-stream"
else
  echo "WARN: expected impl-phase-3-activity-stream, got $branch"
fi

if [[ "$fail" -ne 0 ]]; then
  echo "static-checks FAILED"
  exit 1
fi
echo "static-checks PASSED"
