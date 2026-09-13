#!/usr/bin/env bash
# Static / source-level checks for phase-5-fork-retry-branch (verifier-owned).
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

# Constraint: packages/core/agent-loop must not be touched.
check "no agent-loop edits vs HEAD" \
  bash -c '! git diff --name-only HEAD -- packages/core/agent-loop | grep -q .'
check "no untracked agent-loop files" \
  bash -c '! git status -u --porcelain -- packages/core/agent-loop | grep -q .'

# Must-Fix contract: emptySeed → seed:[] (not tip omit).
check "SDK forkSeedFromParent emptySeed returns seed:[]" \
  grep -q 'if (cut?.emptySeed === true)' packages/sdk/server/src/server.ts
check "SDK emptySeed maps to empty seed array" \
  bash -c 'awk "/function forkSeedFromParent/,/^}/" packages/sdk/server/src/server.ts | grep -q "seed: \[\]"'
check "SDK rejects emptySeed+boundarySeq" \
  grep -q 'cannot set both emptySeed and boundarySeq' packages/sdk/server/src/server.ts
check "bridge validate mutual exclusion emptySeed+boundarySeq" \
  grep -q 'frame.emptySeed === true && frame.boundarySeq !== undefined' packages/ide/ide-bridge/src/validate.ts
check "bridge handleFork passes emptySeed" \
  grep -q 'frame.emptySeed === true ? { emptySeed: true' packages/ide/ide-bridge/src/index.ts
check "Host forkSession passes emptySeed" \
  grep -q 'emptySeed === true ? { emptySeed: true' apps/vscode-dsh/src/session-host.ts
check "orchestrator exposes emptySeed on ForkResult" \
  grep -q 'emptySeed?: boolean' apps/vscode-dsh/src/fork/fork-orchestrator.ts
check "projectMessagesForForkSeed exists" \
  grep -q 'export function projectMessagesForForkSeed' apps/vscode-dsh/src/fork/fork-orchestrator.ts
check "controller uses emptySeed for no-prior cut" \
  grep -q '{ emptySeed: true as const }' apps/vscode-dsh/src/conversation-controller.ts
check "controller hydrates via projectMessagesForForkSeed" \
  grep -q 'projectMessagesForForkSeed' apps/vscode-dsh/src/conversation-controller.ts

# AC-30 observability + copy path.
check "extension lastCopiedText + dsh.test.lastCopiedText" \
  bash -c 'grep -q "lastCopiedText" apps/vscode-dsh/src/extension.ts && grep -q "dsh.test.lastCopiedText" apps/vscode-dsh/src/extension.ts'
check "protocol action/copy-message" \
  grep -q "action/copy-message" apps/vscode-dsh/src/chat-panel/protocol.ts

# No in-session truncate API for fork.
check "no session truncate API in fork path" \
  bash -c '! grep -nE "truncateSession|session/truncate|truncate\(.*session" apps/vscode-dsh/src/fork/fork-orchestrator.ts apps/vscode-dsh/src/conversation-controller.ts | grep -q .'

# GAP-CUX-002 resolved.
check "GAP-CUX-002 in resolved table" \
  bash -c 'grep -A2 "GAP-CUX-002" .specdev/specs/vscode-dsh-chat-ux/tech-debt-registry.md | grep -q "phase-5-fork-retry-branch"'
check "GAP-CUX-002 not in active debt body" \
  bash -c '! awk "/^## 活跃债务/,/^## 已解决/" .specdev/specs/vscode-dsh-chat-ux/tech-debt-registry.md | grep -q GAP-CUX-002'
check "hostProbesForActive / parentReadonly product path" \
  bash -c 'grep -q "parentReadonly" apps/vscode-dsh/src/conversation-controller.ts && grep -q "continueSealed" apps/vscode-dsh/src/conversation-controller.ts'

# Branch convention.
branch="$(git branch --show-current)"
if [[ "$branch" == "impl-phase-5-fork-retry-branch" ]]; then
  echo "PASS: on impl-phase-5-fork-retry-branch"
else
  echo "WARN: expected impl-phase-5-fork-retry-branch, got $branch"
fi

# Specs must not be committed as product (soft: working tree may have specs; ensure agent-loop clean already).
check "no packages/core/agent-loop in staged/unstaged name list vs main tip" \
  bash -c '! git diff --name-only main...HEAD -- packages/core/agent-loop 2>/dev/null | grep -q .'

if [[ "$fail" -ne 0 ]]; then
  echo "static-checks FAILED"
  exit 1
fi
echo "static-checks PASSED"
