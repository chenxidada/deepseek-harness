#!/usr/bin/env bash
# Static probes for Phase 4 Must ACs + DEBT-003 (source-level, no trust of implementer tests).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$ROOT"
fail=0

check() {
  local name="$1"
  local cmd="$2"
  if eval "$cmd"; then
    echo "PASS $name"
  else
    echo "FAIL $name"
    fail=1
  fi
}

# DEBT-003: requestContinue must call ensureHostForSend before continueConversation
check "DEBT-003 ensureHost in requestContinue" \
  "grep -n 'requestContinue' -A20 apps/vscode-dsh/src/extension.ts | grep -q 'ensureHostForSend'"

check "DEBT-003 continue after ensureHost" \
  "awk '/requestContinue: async/,/requestNewConversation/' apps/vscode-dsh/src/extension.ts | grep -q 'continueConversation'"

# Shared New path
check "runNewConversationShared uses ensureHostForSend" \
  "grep -A30 'async function runNewConversationShared' apps/vscode-dsh/src/extension.ts | grep -q 'ensureHostForSend'"

check "runNewConversationShared uses newConversationOrReuseEmpty" \
  "grep -A40 'async function runNewConversationShared' apps/vscode-dsh/src/extension.ts | grep -q 'newConversationOrReuseEmpty'"

# Protocol
check "protocol action/new-conversation" \
  "grep -q \"action/new-conversation\" apps/vscode-dsh/src/chat-panel/protocol.ts"

# Chrome HTML
check "newConversationBtn label" \
  "grep -q 'id=\"newConversationBtn\".*新建会话\\|新建会话' apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts"

check "overflow first new conversation" \
  "grep -q 'newConversationOverflowBtn' apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts"

# connecting never live
check "connecting forces waiting-host" \
  "grep -A5 'connectionPhase === .connecting' apps/vscode-dsh/src/chat-panel/chat-panel-host.ts | grep -q \"waiting-host\""

# connection-ui copy
check "正在连接到 Host copy" \
  "grep -q '正在连接到 Host' apps/vscode-dsh/src/connection-ui.ts"

# No Must keybindings
check "no contributes.keybindings" \
  "! grep -q keybindings apps/vscode-dsh/package.json"

# DEBT-003 closed in registry
check "DEBT-003 in 已解决" \
  "grep -A2 '## 已解决' -A20 .specdev/specs/vscode-dsh-chat-ready/tech-debt-registry.md | grep -q 'DEBT-003'"

check "active debt empty" \
  "awk '/## 活跃债务/,/## 已解决/' .specdev/specs/vscode-dsh-chat-ready/tech-debt-registry.md | grep -q '| （无） |'"

if [ "$fail" -ne 0 ]; then
  echo "STATIC PROBES FAILED"
  exit 1
fi
echo "STATIC PROBES OK"
