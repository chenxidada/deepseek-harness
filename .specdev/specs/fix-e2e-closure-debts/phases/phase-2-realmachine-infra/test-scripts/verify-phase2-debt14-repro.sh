#!/usr/bin/env bash
#
# verifier 独立验证脚本（第三轮）— DEBT-14 修复的「非空 openTabSet」复验
#
# 只读证据提取：从最新一次「cap-message-store-stream-patch + cap-selection-ask」双能力 run
# 的 status.json 提取 DEBT-14 真正闭环所需的关键证据：
#   1. cap-selection-ask 的 host-started 步 openTabSet 是否非空（有前序持久会话）
#   2. assistant-replied 的 panelSnapshot 是否 mode=live 且 sessionId 与 send-prompt 一致
#   3. cap-selection-ask 的 conclusion=PASS + closedLoop.closed=true
# 不重新启动真机 host。
#
# 用法：
#   bash .specdev/specs/fix-e2e-closure-debts/phases/phase-2-realmachine-infra/test-scripts/verify-phase2-debt14-repro.sh [runId]

set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../../../../.." && pwd -P)"
ARTIFACT_DIR="${REPO_ROOT}/apps/vscode-dsh/test-artifacts/layer-v-capabilities/runs"

say() { printf '\n==== %s ====\n' "$*"; }

# 定位目标 run：包含两个能力（stream-patch 前序 + selection-ask 被测）的最新 run。
find_repro_run() {
  local r s ids
  for r in $(ls -t "${ARTIFACT_DIR}" 2>/dev/null); do
    s="${ARTIFACT_DIR}/${r}/layer-v-capabilities-status.json"
    [ -f "${s}" ] || continue
    ids="$(jq -r '[.capabilities[].id] | join(",")' "${s}" 2>/dev/null)"
    case "${ids}" in
      *cap-message-store-stream-patch*cap-selection-ask*)
        printf '%s' "${r}"
        return 0
        ;;
    esac
  done
  printf ''
}

RUN="${1:-$(find_repro_run)}"
if [ -z "${RUN}" ]; then
  echo "未找到「stream-patch + selection-ask」双能力 run；请先带 key 跑："
  echo "  LAYER_V_CAPABILITY_ONLY=\"cap-message-store-stream-patch,cap-selection-ask\" bash apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh"
  exit 1
fi
STATUS="${ARTIFACT_DIR}/${RUN}/layer-v-capabilities-status.json"

say "DEBT-14 复验 run=${RUN} 各能力结论"
jq -r '.capabilities[] | "  \(.id)  \(.conclusion)  closed=\(.closedLoop.closed)"' "${STATUS}"

# NOTE: 失败 run（LINK_FAILURE via StageError）的 cap-selection-ask 条目 `steps` 为 null；
# 此时从 journal.jsonl 取步骤轨迹，从 status.json 的 `evidence.lastObserved` 取最终 panelSnapshot。
JOURNAL="${ARTIFACT_DIR}/${RUN}/layer-v-capabilities-journal.jsonl"

say "证据 1: cap-selection-ask 的 host-started 步 openTabSet（前序持久会话是否存在）"
jq -r '.capabilities[] | select(.id=="cap-selection-ask") | (.steps // [])[] | select(.step=="host-started") | .value | "  tabs=\(.tabs)  openTabSet=\(.openTabSet)"' "${STATUS}"

say "证据 2: cap-selection-ask 的 new-conversation / send-prompt / assistant-replied 会话一致性"
jq -r '.capabilities[] | select(.id=="cap-selection-ask") | (.steps // [])[] | select(.step=="new-conversation" or .step=="send-prompt" or .step=="assistant-replied") |
  "  [\(.step)] ok=\(.ok)  mode=\(.value.mode // "n/a")  sessionId=\(.value.sessionId // "n/a")"' "${STATUS}"

say "证据 2b: 失败 run 的最终 panelSnapshot（evidence.lastObserved）"
jq -r '.capabilities[] | select(.id=="cap-selection-ask") | .evidence.lastObserved.value |
  "  mode=\(.mode // "n/a")  sessionId=\(.sessionId // "n/a")  activeSessionId=\(.index.activeSessionId // "n/a")\n  openTabSet: \([.index.openTabSet[]? | "\(.sessionId[0:8])…/\(.mode)"] | join(", "))"' "${STATUS}" 2>/dev/null

say "证据 3: assistant-replied 的 panelSnapshot 关键字段（mode / sessionId / openTabSet 内 mode 分布）"
jq -r '.capabilities[] | select(.id=="cap-selection-ask") | (.steps // [])[] | select(.step=="assistant-replied") |
  "  mode=\(.value.mode)  sessionId=\(.value.sessionId)  tabStatus=\(.value.tabStatus)\n  openTabSet: \([.value.index.openTabSet[] | "\(.sessionId[0:8])…/\(.mode)"] | join(", "))\n  activeSessionId=\(.value.index.activeSessionId)"' "${STATUS}"

say "证据 4: cap-selection-ask 是否命中 LAYER-V-CAP-26-OK（assistant 回复含 marker）"
jq -r '.capabilities[] | select(.id=="cap-selection-ask") | (.steps // [])[] | select(.step=="assistant-replied") |
  .value.messages[] | select(.role=="assistant") | .text' "${STATUS}" | sed 's/^/  /'

say "证据 5: closedLoop 判定（actualTrigger/concreteAssertion/realScreenshot）"
jq -r '.capabilities[] | select(.id=="cap-selection-ask") | .closedLoop |
  "  closed=\(.closed)  actualTrigger=\(.actualTrigger)  concreteAssertion=\(.concreteAssertion)  realScreenshot=\(.realScreenshot)  reason=\(.reason)"' "${STATUS}"

say "证据 6: 步骤轨迹（journal，成功/失败 run 均适用）"
jq -r 'select(.capability=="cap-selection-ask") | "  \(.ts)  [\(.step)]  \(.verdict)"' "${JOURNAL}"

say "前序能力 cap-message-store-stream-patch 是否真持久化了会话（send-prompt 步 sessionId）"
jq -r '.capabilities[] | select(.id=="cap-message-store-stream-patch") | (.steps // [])[] | select(.step=="send-prompt") |
  "  sessionId=\(.value.sessionId // "n/a")  ok=\(.ok)"' "${STATUS}"

say "完成"
