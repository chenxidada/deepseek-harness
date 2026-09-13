#!/usr/bin/env bash
# Independent verifier for phase-6-feature-regression (AC-R1…R4).
# Does NOT trust implementer claims — re-runs regression + independent checks.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$ROOT"
PHASE_DIR=".specdev/specs/vscode-dsh-chat-ready/phases/phase-6-feature-regression"
SUMMARY=".specdev/specs/vscode-dsh-chat-ready/feature-delivery-summary.md"
SUMMARY_ZH=".specdev/specs/vscode-dsh-chat-ready/feature-delivery-summary-zh.md"
REGISTRY=".specdev/specs/vscode-dsh-chat-ready/tech-debt-registry.md"
T="apps/vscode-dsh/tests"
fail=0

echo "== V0: branch must be impl-phase-6-feature-regression =="
branch="$(git branch --show-current)"
if [[ "$branch" != "impl-phase-6-feature-regression" ]]; then
  echo "FAIL: branch=$branch"
  fail=1
else
  echo "OK: $branch"
fi

echo "== V1: re-run apps one-command regression (AC-R1/R2/R3/agent-loop) =="
bash apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh
echo "OK: apps regression exit 0"

echo "== V2: re-run phase wrapper path (independent of apps path) =="
bash "$PHASE_DIR/test-scripts/run-chat-ready-regression.sh" >/tmp/phase6-wrapper-out.txt
tail -5 /tmp/phase6-wrapper-out.txt
echo "OK: wrapper exit 0"

echo "== V3: matrix AC anchors in named suites (implementer smoke does not assert these) =="
check() {
  local file="$1" pat="$2" label="$3"
  if grep -Eq "$pat" "$file"; then
    echo "OK $label"
  else
    echo "FAIL $label ($pat missing in $file)"
    fail=1
  fi
}
check "$T/phase1-auto-start.spec.ts" "AC-1a" "AC-1a reverse"
check "$T/phase2-auto-ready.spec.ts" "AC-7" "view-visible AC-7"
check "$T/phase3-chat-ui-chassis.spec.ts" "AC-16" "chassis AC-16"
check "$T/phase4-new-conversation-chrome.spec.ts" "AC-15|AC-22" "chrome AC-15/22"
check "$T/phase5-should-polish.spec.ts" "AC-28" "polish AC-28"
check "$T/phase5-should-polish.spec.ts" "AC-34" "polish AC-34"
for f in phase3-restart-continue.spec.ts phase2-multitab-history-replay.spec.ts panel-close-delete.e2e.spec.ts; do
  if [[ -f "$T/$f" ]]; then echo "OK AC-27 sample $f"; else echo "FAIL missing $f"; fail=1; fi
done

echo "== V4: no product architecture creep (src / agent-loop clean) =="
if [[ -n "$(git status -s -- apps/vscode-dsh/src packages/core/agent-loop)" ]]; then
  echo "FAIL: product src or agent-loop dirty"
  git status -s -- apps/vscode-dsh/src packages/core/agent-loop
  fail=1
else
  echo "OK: no src / agent-loop working-tree changes"
fi

echo "== V5: AC-R3 active debt empty (static re-read) =="
ACTIVE_BLOCK="$(awk '/^## 活跃债务$/,/^## 已解决$/' "$REGISTRY")"
if ! printf '%s\n' "$ACTIVE_BLOCK" | grep -q '| （无） |'; then
  echo "FAIL: missing empty sentinel"
  fail=1
fi
if printf '%s\n' "$ACTIVE_BLOCK" | grep -E '\| (STUB|DEBT|GAP)-[0-9]+ \|' >/dev/null; then
  echo "FAIL: active STUB/DEBT/GAP rows present"
  fail=1
else
  echo "OK: active table empty"
fi

echo "== V6: AC-R4 delivery summary sections =="
for needle in "已交付 Must" "Out of Scope" "AC-33" "run-chat-ready-regression.sh"; do
  if grep -q "$needle" "$SUMMARY"; then
    echo "OK summary: $needle"
  else
    echo "FAIL summary missing: $needle"
    fail=1
  fi
done
if awk '/## 已交付 Must/,/## Out of Scope/' "$SUMMARY" | grep -q "AC-33"; then
  echo "FAIL: AC-33 listed under Must"
  fail=1
else
  echo "OK: AC-33 not under Must"
fi
for needle in "AC-33" "run-chat-ready-regression.sh"; do
  if grep -q "$needle" "$SUMMARY_ZH"; then
    echo "OK summary-zh: $needle"
  else
    echo "FAIL summary-zh missing: $needle"
    fail=1
  fi
done

echo "== V7: fail-closed debt detector (poisoned copy; does not mutate registry) =="
TMP="$(mktemp)"
# shellcheck disable=SC2016
python3 - "$REGISTRY" "$TMP" <<'PY'
import sys
from pathlib import Path
src = Path(sys.argv[1]).read_text()
poisoned = src.replace(
    "| （无） | — | — | — | — | — | — | — | — | — | — | — | — |",
    "| STUB-999 | phase-6 | x | f:g:1 | stub | real | 空实现 | module:x, type:stub | — | phase-6 | 🔴阻塞 | verifier | 2026-09-09 |",
    1,
)
Path(sys.argv[2]).write_text(poisoned)
PY
ACTIVE_POISON="$(awk '/^## 活跃债务$/,/^## 已解决$/' "$TMP")"
if printf '%s\n' "$ACTIVE_POISON" | grep -E '\| (STUB|DEBT|GAP)-[0-9]+ \|' >/dev/null; then
  echo "OK: negative path detects STUB-999"
else
  echo "FAIL: negative path did not detect STUB"
  fail=1
fi
rm -f "$TMP"

if [[ "$fail" -ne 0 ]]; then
  echo "VERIFIER PHASE-6 FAILED"
  exit 1
fi
echo "ALL VERIFIER PHASE-6 CHECKS OK"
exit 0
