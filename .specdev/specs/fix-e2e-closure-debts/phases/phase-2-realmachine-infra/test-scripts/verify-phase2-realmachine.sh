#!/usr/bin/env bash
#
# verifier 独立验证脚本 — phase-2-realmachine-infra（DEBT-2/3/7/10/12）
# 只读检查 + 运行时证据提取，不改任何文件。
#
# 用法：
#   bash .specdev/specs/fix-e2e-closure-debts/phases/phase-2-realmachine-infra/test-scripts/verify-phase2-realmachine.sh
#
# 覆盖：AC-1（dsh.test.* 门控）、AC-6/7 静态（concreteAssertion / requiresModel / 新增 delegate）、
#       AC-8 运行时证据（nonmodel idle 断言 + reset）、AC-9 负向（model 批 SKIPPED_NO_CREDENTIALS）、
#       AC-13 登记诚实（DEBT-2 SDK fork preset 继承 / DEBT-13 modal 条件渲染）。

set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../../../../.." && pwd -P)"
APP_DIR="${REPO_ROOT}/apps/vscode-dsh"
MANIFEST="${APP_DIR}/test-scripts/layer-v-capabilities.json"
ARTIFACT_DIR="${APP_DIR}/test-artifacts/layer-v-capabilities"
EXT="${APP_DIR}/src/extension.ts"
SDK_SERVER="${REPO_ROOT}/packages/sdk/server/src/server.ts"
APP_TSX="${APP_DIR}/webview/src/App.tsx"

say() { printf '\n==== %s ====\n' "$*"; }

say "AC-1: 三个新 dsh.test.* 命令是否都在 shouldRegisterTestHooks 分支内（VSCODE_DSH_TEST 门控）"
grep -nE "dsh\.test\.(listChildren|resetToIdle|queryWebviewRenderState)" "${EXT}" || exit 1
echo "--- shouldRegisterTestHooks 分支起始 ---"
grep -nE "if \(shouldRegisterTestHooks" "${EXT}"

say "AC-1: 是否有 agent-loop 变更（应为空）"
git -C "${REPO_ROOT}" diff --name-only HEAD -- packages/core/agent-loop | sed 's/^/  /'
echo "(空 = 无 agent-loop 变更)"

say "AC-6 静态: 9 项 webview 能力 concreteAssertion vs 弱证据"
for id in cap-react-spa-root cap-tab-chrome cap-composer cap-delete-confirm-modal \
          cap-chat-ui-store cap-message-bridge cap-editor-panel-viewtype \
          cap-react-spa-html-builder cap-webview-html-injection; do
  qw=$(jq -r --arg id "$id" '[.capabilities[] | select(.id==$id) | .steps[] | select(.command=="dsh.test.queryWebviewRenderState")] | length' "${MANIFEST}")
  po=$(jq -r --arg id "$id" '[.capabilities[] | select(.id==$id) | .steps[] | select((.expect|tostring)|test("panelOpen"))] | length' "${MANIFEST}")
  printf '  %-28s queryWebviewRenderState=%s panelOpen=%s\n' "$id" "$qw" "$po"
done

say "AC-7 静态: subagent 组 requiresModel"
jq -r '.capabilities[] | select(.group=="subagent") | "  \(.id)  requiresModel=\(.requiresModel)"' "${MANIFEST}"

say "AC-7 静态: cap-delegate-subagent-model 步骤（sendPrompt → listChildren → \$assistantContains）"
jq -r '.capabilities[] | select(.id=="cap-delegate-subagent-model") | .steps[] | "  [\(.kind)] \(.step) -> \(.command)  expect=\(.expect|tostring)"' "${MANIFEST}"

say "AC-8 运行时证据: 最新 nonmodel 批 per-capability conclusion + closedLoop"
RD="$(ls -t "${ARTIFACT_DIR}/runs/" | head -1)"
echo "  run=${RD}"
jq -r '.capabilities[] | "  \(.id)  \(.conclusion)  closed=\(.closedLoop.closed)"' "${ARTIFACT_DIR}/runs/${RD}/layer-v-capabilities-status.json" 2>/dev/null \
  || echo "  (无状态文件，需先跑 nonmodel 批)"

say "AC-8 运行时证据: closureSummary"
jq '.closureSummary' "${ARTIFACT_DIR}/runs/${RD}/layer-v-capabilities-summary.json" 2>/dev/null

say "AC-9 负向: model 批应全部 SKIPPED_NO_CREDENTIALS（无 key）"
# 找到最新一次 model 批 run（其 status 里全部 SKIPPED_NO_CREDENTIALS）
for r in $(ls -t "${ARTIFACT_DIR}/runs/"); do
  if jq -e '.capabilities | all(.conclusion=="SKIPPED_NO_CREDENTIALS")' "${ARTIFACT_DIR}/runs/${r}/layer-v-capabilities-status.json" >/dev/null 2>&1; then
    cnt=$(jq '.capabilities | length' "${ARTIFACT_DIR}/runs/${r}/layer-v-capabilities-status.json")
    echo "  model 批 run=${r}  全部 ${cnt} 项 SKIPPED_NO_CREDENTIALS"
    break
  fi
done

say "AC-13 登记诚实: DEBT-2 SDK fork preset 继承（无 agentPreset 覆盖 seam）"
grep -nE "createForkedSession|emptySeed|agentPreset|parentPreset" "${SDK_SERVER}" | head -12

say "AC-13 登记诚实: DEBT-13 DeleteConfirmModal 条件渲染（无 host 触发）"
grep -nE "deleteConfirm" "${APP_TSX}" | head -5

say "完成"
