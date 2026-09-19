#!/usr/bin/env bash
# vscode-dsh-chat-ready Feature regression (AC-R1 / AC-R2)
# One-command entry: phase-1…5 Must suites + AC-27 prior-behavior sample.
# Run from repo root: bash apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh
#
# OBSOLETE (vscode-dsh-e2e-closure Phase 4, decision C): this script is kept on disk but no
# longer maintained. The ten test files it runs below were consolidated into
# apps/vscode-dsh/tests/cap-*.spec.ts by the vscode-dsh-test-consolidation workflow, so the
# vitest invocations name files that no longer exist. Its regression duty is now covered by
# `pnpm exec vitest run apps/vscode-dsh/tests` (see AC-12). The registry/agent-loop checks
# below point at the unrelated vscode-dsh-chat-ready workflow and are likewise dead. It is
# retained, not deleted, because four guard references pin it (cap-test-harness.spec.ts
# CAP-TEST-HARNESS-083, scripts/check-test-scripts-syntax.sh, tests/capability-domains.json,
# apps/vscode-dsh/README.md) — see tech-debt-registry.md DEBT-11 for the cleanup follow-up.
# This comment only marks the file obsolete; no logic below is changed, so `bash -n` still
# passes and the guards that assert this file exists keep passing.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
export PATH="/usr/local/n/versions/node/24.3.0/bin:${PATH}"

REGISTRY=".specdev/specs/vscode-dsh-chat-ready/tech-debt-registry.md"

echo "== [1] vitest chat-ready Must matrix (phase-1…5 + AC-27 sample) =="
./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/chat-ready-regression.spec.ts \
  apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts \
  apps/vscode-dsh/tests/phase1-auto-start.spec.ts \
  apps/vscode-dsh/tests/phase2-auto-ready.spec.ts \
  apps/vscode-dsh/tests/phase3-chat-ui-chassis.spec.ts \
  apps/vscode-dsh/tests/phase4-new-conversation-chrome.spec.ts \
  apps/vscode-dsh/tests/phase5-should-polish.spec.ts \
  apps/vscode-dsh/tests/phase3-restart-continue.spec.ts \
  apps/vscode-dsh/tests/phase2-multitab-history-replay.spec.ts \
  apps/vscode-dsh/tests/panel-close-delete.e2e.spec.ts

echo "== [2] AC-R2 phase-1…4 suites still green (explicit re-run) =="
./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts \
  apps/vscode-dsh/tests/phase1-auto-start.spec.ts \
  apps/vscode-dsh/tests/phase2-auto-ready.spec.ts \
  apps/vscode-dsh/tests/phase3-chat-ui-chassis.spec.ts \
  apps/vscode-dsh/tests/phase4-new-conversation-chrome.spec.ts

echo "== [3] AC-R3 tech-debt-registry active table empty =="
if [[ ! -f "$REGISTRY" ]]; then
  echo "FAIL: missing $REGISTRY"
  exit 1
fi
# Active table must contain the empty sentinel row; reject any STUB-/DEBT-/GAP- in the active section.
ACTIVE_BLOCK="$(awk '/^## 活跃债务$/,/^## 已解决$/' "$REGISTRY")"
if ! printf '%s\n' "$ACTIVE_BLOCK" | grep -q '| （无） |'; then
  echo "FAIL: active debt table missing empty sentinel （无）"
  exit 1
fi
if printf '%s\n' "$ACTIVE_BLOCK" | grep -E '\| (STUB|DEBT|GAP)-[0-9]+ \|' >/dev/null; then
  echo "FAIL: active debt table still lists STUB/DEBT/GAP rows"
  exit 1
fi
echo "OK: active debt empty"

echo "== [4] agent-loop untouched in working tree =="
if git diff --name-only | grep -q 'packages/core/agent-loop'; then
  echo "FAIL: agent-loop modified"
  exit 1
fi
echo "OK: no agent-loop changes in working tree"

echo "ALL CHAT-READY REGRESSION STEPS OK"
