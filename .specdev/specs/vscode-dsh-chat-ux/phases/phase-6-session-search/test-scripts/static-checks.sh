#!/usr/bin/env bash
# Static / source-level checks for phase-6-session-search (verifier-owned).
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
check "no agent-loop in branch tip vs main" \
  bash -c '! git diff --name-only main...HEAD -- packages/core/agent-loop 2>/dev/null | grep -q .'

# Search module exists (AD-CUX-9).
check "path-session-index module present" \
  test -f apps/vscode-dsh/src/search/path-session-index.ts
check "session-search module present" \
  test -f apps/vscode-dsh/src/search/session-search.ts
check "PATH_SESSION_INDEX_STATE_KEY = dsh.pathSessionIndex" \
  grep -q "dsh.pathSessionIndex" apps/vscode-dsh/src/search/path-session-index.ts
check "TIER3_FULL_TEXT_SEARCH_API = null" \
  grep -q 'TIER3_FULL_TEXT_SEARCH_API = null' apps/vscode-dsh/src/search/session-search.ts

# AC-50: tier-1 fields only.
check "matchTier1Field uses title" \
  grep -q 'row.title.toLowerCase().includes' apps/vscode-dsh/src/search/session-search.ts
check "matchTier1Field uses firstUserPreview" \
  grep -q 'firstUserPreview' apps/vscode-dsh/src/search/session-search.ts
check "searchSessions uses listHistorySessions (index metadata)" \
  grep -q 'listHistorySessions' apps/vscode-dsh/src/search/session-search.ts

# AC-51: persist + delete sync (proximity checks — method sigs are multi-line).
check "persistChangeIndex body calls replaceSessionPaths" \
  bash -c 'grep -n "persistChangeIndex\|replaceSessionPaths" apps/vscode-dsh/src/conversation-controller.ts | grep -q replaceSessionPaths && grep -A12 "private async persistChangeIndex" apps/vscode-dsh/src/conversation-controller.ts | grep -q replaceSessionPaths'
check "deleteConversation removes path index session" \
  bash -c 'grep -A35 "async deleteConversation(" apps/vscode-dsh/src/conversation-controller.ts | grep -q "pathSessionIndex.removeSession"'
check "deleteSession removes path index session" \
  bash -c 'grep -A40 "async deleteSession(" apps/vscode-dsh/src/conversation-controller.ts | grep -q "pathSessionIndex.removeSession"'

# AC-52: openSearchHit → openFromHistory; Query/browse matrix.
check "openSearchHit delegates to openFromHistory" \
  bash -c 'grep -A12 "async openSearchHit(" apps/vscode-dsh/src/conversation-controller.ts | grep -q "return this.openFromHistory"'
check "command dsh.searchSessions registered in package.json" \
  grep -q '"command": "dsh.searchSessions"' apps/vscode-dsh/package.json
check "README Query/browse includes dsh.searchSessions" \
  grep -q 'dsh.searchSessions' apps/vscode-dsh/README.md
check "extension registers dsh.searchSessions" \
  grep -q "dsh.searchSessions" apps/vscode-dsh/src/extension.ts

# Protocol wiring.
check "protocol action/search-sessions" \
  grep -q "action/search-sessions" apps/vscode-dsh/src/chat-panel/protocol.ts
check "protocol action/open-search-hit" \
  grep -q "action/open-search-hit" apps/vscode-dsh/src/chat-panel/protocol.ts
check "protocol search/results" \
  grep -q "search/results" apps/vscode-dsh/src/chat-panel/protocol.ts
check "host handles search-sessions" \
  grep -q "action/search-sessions" apps/vscode-dsh/src/chat-panel/chat-panel-host.ts
check "host handles open-search-hit" \
  grep -q "action/open-search-hit" apps/vscode-dsh/src/chat-panel/chat-panel-host.ts

# AC-53: no tier-3 / body scan surfaces in search package.
check "no searchFullText export in search/" \
  bash -c '! grep -REn "export (async )?function searchFullText|export const searchFullText" apps/vscode-dsh/src/search/ | grep -q .'
check "no scanJsonlBodies in search/" \
  bash -c '! grep -REn "scanJsonlBodies|searchMessageBodies|readSessionLog" apps/vscode-dsh/src/search/ | grep -q .'
check "search package does not import message-store" \
  bash -c '! grep -REn "message-store|MessageStore" apps/vscode-dsh/src/search/ | grep -vq "Never reads MessageStore"'
check "search package does not fs-read JSONL" \
  bash -c '! grep -REn "readFileSync|createReadStream|\\.jsonl" apps/vscode-dsh/src/search/ | grep -q .'

# Active debt empty (placeholder only).
check "tech-debt active table has no real DEBT/GAP/STUB rows" \
  bash -c '! awk "/^## 活跃债务/,/^## 已解决/" .specdev/specs/vscode-dsh-chat-ux/tech-debt-registry.md | grep -E "^\| (DEBT|GAP|STUB)-" | grep -q .'

# Branch convention.
branch="$(git branch --show-current)"
if [[ "$branch" == "impl-phase-6-session-search" ]]; then
  echo "PASS: on impl-phase-6-session-search"
else
  echo "WARN: expected impl-phase-6-session-search, got $branch"
fi

if [[ "$fail" -ne 0 ]]; then
  echo "static-checks FAILED"
  exit 1
fi
echo "static-checks PASSED"
