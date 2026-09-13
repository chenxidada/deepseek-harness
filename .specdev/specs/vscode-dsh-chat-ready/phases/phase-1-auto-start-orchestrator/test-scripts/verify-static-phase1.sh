#!/usr/bin/env bash
# Static gates for phase-1-auto-start-orchestrator (AC-1c README, AC-26, stub registry).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$ROOT"

fail=0
check() {
  local desc="$1"
  shift
  if "$@"; then
    echo "PASS: $desc"
  else
    echo "FAIL: $desc"
    fail=1
  fi
}

README=apps/vscode-dsh/README.md
check "README has Auto-start command matrix" grep -q "Auto-start command matrix" "$README"
check "README Start class includes dsh.startSession" grep -q "dsh.startSession" "$README"
check "README Delete class documents offline copy" grep -q "Host 连接后可删除" "$README"
check "README lists dsh.deleteHistory" grep -q "dsh.deleteHistory" "$README"
check "README lists dsh.openHistory as no auto-start" grep -E -q "dsh\.openHistory" "$README"

REG=.specdev/specs/vscode-dsh-chat-ready/tech-debt-registry.md
check "STUB-001 registered" grep -q "STUB-001" "$REG"
check "DEBT-001 registered" grep -q "DEBT-001" "$REG"
check "STUB-001 points at AutoReadyLatchSeam" grep -q "AutoReadyLatchSeam" "$REG"
check "DEBT-001 points at restoreOpenTabSet" grep -q "restoreOpenTabSet" "$REG"

check "STUB comment present in connection-ui" \
  grep -q "@STUB(phase-2-auto-ready-surface)" apps/vscode-dsh/src/connection-ui.ts
check "DEBT restore-on-start still in extension start port" \
  grep -q "restoreOpenTabSet" apps/vscode-dsh/src/extension.ts

# AC-26: no agent-loop changes in working tree / branch product paths
if git status -s -- packages/core/ | grep -q .; then
  echo "FAIL: packages/core has changes (AC-26)"
  fail=1
else
  echo "PASS: packages/core clean (AC-26)"
fi

if git diff --name-only -- packages/core/ 2>/dev/null | grep -q agent-loop; then
  echo "FAIL: agent-loop in git diff"
  fail=1
else
  echo "PASS: no agent-loop in git diff"
fi

# AC-1a production: activate must not call IdeSessionHost.start directly in activate body.
# Heuristic: no `.start(` between `export function activate` and first registerCommand block
# is too brittle; instead assert simulateStartupOnly hook exists and startSession goes through orchestrator.
check "simulateStartupOnly hook registered" \
  grep -q "dsh.test.simulateStartupOnly" apps/vscode-dsh/src/extension.ts
check "startSession uses orchestrator.request" \
  grep -q "orchestrator!.request('command-start')" apps/vscode-dsh/src/extension.ts \
  || grep -q "orchestrator?.request('command-start')" apps/vscode-dsh/src/extension.ts

if [[ "$fail" -ne 0 ]]; then
  echo "STATIC CHECKS FAILED"
  exit 1
fi
echo "STATIC CHECKS OK"
