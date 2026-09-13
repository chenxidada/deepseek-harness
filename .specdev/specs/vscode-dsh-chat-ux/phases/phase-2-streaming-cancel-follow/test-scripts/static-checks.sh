#!/usr/bin/env bash
# Verifier static checks for phase-2-streaming-cancel-follow (AC-17 / O-3 / AC-72 / keepInbox).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../../../.." && pwd)"
cd "$ROOT"
FAIL=0

echo "== O-3: packages/core/agent-loop untouched =="
if git status -s -- packages/core/agent-loop | grep -q .; then
  echo "FAIL: working tree changes under packages/core/agent-loop"
  git status -s -- packages/core/agent-loop
  FAIL=1
else
  echo "PASS: no working-tree changes in agent-loop"
fi
if git diff --name-only HEAD -- packages/core/agent-loop 2>/dev/null | grep -q .; then
  echo "FAIL: HEAD diff touches agent-loop"
  FAIL=1
fi
if git log --oneline main..HEAD -- packages/core/agent-loop 2>/dev/null | grep -q .; then
  echo "FAIL: branch commits touch agent-loop"
  git log --oneline main..HEAD -- packages/core/agent-loop
  FAIL=1
else
  echo "PASS: no branch commits touch agent-loop"
fi

echo "== AC-17: consume existing chunk events; no SDK stdout cancel hard-dep =="
# Product path must project assistant/chunk; must not require stdout protocol cancel.
if ! rg -n "assistant/chunk|projectAssistantChunk|text-delta" apps/vscode-dsh/src/conversation-controller.ts >/dev/null; then
  echo "FAIL: Host does not consume assistant/chunk"
  FAIL=1
else
  echo "PASS: Host consumes assistant/chunk text-delta"
fi
if rg -n "must change SDK|须改 SDK|stdout.*cancel|cancelViaStdout" apps/vscode-dsh/src packages/ide/ide-bridge/src packages/sdk/server/src 2>/dev/null | grep -v '^\s*#' | grep -q .; then
  echo "FAIL: hard-dep comments on SDK stdout cancel found"
  FAIL=1
else
  echo "PASS: no SDK-stdout-cancel hard dependency"
fi

echo "== AD-CUX-3: Agent.cancel keepInbox:true in server.cancelSession =="
if ! rg -n "agent\.cancel\(\{ kind: 'user' \}, \{ keepInbox: true \}\)" packages/sdk/server/src/server.ts >/dev/null; then
  echo "FAIL: server.cancelSession missing keepInbox:true call"
  FAIL=1
else
  echo "PASS: server.cancelSession → Agent.cancel({kind:'user'},{keepInbox:true})"
fi

echo "== AD-CUX-7 / T6: reasoning-delta ignored =="
if ! rg -n "reasoning-delta" apps/vscode-dsh/src/conversation-controller.ts | rg -q "return"; then
  echo "FAIL: reasoning-delta not early-returned"
  FAIL=1
else
  echo "PASS: reasoning-delta early return present"
fi

echo "== AC-72: Must tests are layer A/B (no layer-C-only Must files) =="
# Spec Must suites live under layer-a/ and chat-ux-streaming-cancel-follow; no *-layer-c* Must.
if ls apps/vscode-dsh/tests/*layer-c* 2>/dev/null | grep -q .; then
  echo "FAIL: unexpected layer-C Must suite present"
  FAIL=1
else
  echo "PASS: no layer-C Must suite files"
fi
if [[ -f apps/vscode-dsh/tests/layer-a/streaming-cancel-follow.spec.ts ]] \
  && [[ -f apps/vscode-dsh/tests/chat-ux-streaming-cancel-follow.spec.ts ]]; then
  echo "PASS: layer A + layer B Must suites present"
else
  echo "FAIL: missing layer A/B Must suites"
  FAIL=1
fi

echo "== P2-2 product wiring: follow init / resume / no force-reset on cancel =="
PROVIDER=apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts
CTRL=apps/vscode-dsh/src/conversation-controller.ts
for needle in "initFollowOnStreamStart" "followResumeBtn" "keepBottomIfFollowing" "action/stop" "messages/patch"; do
  if ! rg -n "$needle" "$PROVIDER" >/dev/null; then
    echo "FAIL: provider missing $needle"
    FAIL=1
  else
    echo "PASS: provider has $needle"
  fi
done
if ! rg -n "do not force follow reset|Do not force-reset follow|不强制.*follow|do not force-reset follow" "$CTRL" >/dev/null; then
  # Accept either English comment in cancelActiveTurn / markTurnIncomplete
  if ! rg -n "force follow|force-reset follow" "$CTRL" >/dev/null; then
    echo "WARN: explicit follow-reset comment not found (behavior checked in independent spec)"
  else
    echo "PASS: cancel/incomplete path documents no force follow reset"
  fi
else
  echo "PASS: cancel/incomplete path documents no force follow reset"
fi

echo "== Branch name =="
BRANCH="$(git branch --show-current)"
if [[ "$BRANCH" != "impl-phase-2-streaming-cancel-follow" ]]; then
  echo "FAIL: expected impl-phase-2-streaming-cancel-follow, got $BRANCH"
  FAIL=1
else
  echo "PASS: on $BRANCH"
fi

if [[ "$FAIL" -ne 0 ]]; then
  echo "STATIC CHECKS FAILED"
  exit 1
fi
echo "STATIC CHECKS PASSED"
exit 0
