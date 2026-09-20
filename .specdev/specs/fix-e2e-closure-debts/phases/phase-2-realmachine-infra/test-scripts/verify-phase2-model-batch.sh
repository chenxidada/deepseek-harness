#!/usr/bin/env bash
#
# verifier 独立验证脚本（第二轮）— phase-2-realmachine-infra model 批真机证据提取
#
# 只读证据提取 + 真机复跑命令文档。真机 run 已由 verifier 执行，本脚本从
# `apps/vscode-dsh/test-artifacts/layer-v-capabilities/runs/<runId>/` 提取结论与证据，
# 不重新启动真机 host（真机复跑命令见文件尾部注释，供复现）。
#
# 用法：
#   bash .specdev/specs/fix-e2e-closure-debts/phases/phase-2-realmachine-infra/test-scripts/verify-phase2-model-batch.sh

set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../../../../.." && pwd -P)"
ARTIFACT_DIR="${REPO_ROOT}/apps/vscode-dsh/test-artifacts/layer-v-capabilities/runs"

say() { printf '\n==== %s ====\n' "$*"; }

# 找到「恰好 24 项 model 能力」的最新一次 run（即全链 model 批）。
find_model_batch_run() {
  local r s
  for r in $(ls -t "${ARTIFACT_DIR}" 2>/dev/null); do
    s="${ARTIFACT_DIR}/${r}/layer-v-capabilities-status.json"
    [ -f "${s}" ] || continue
    if [ "$(jq '[.capabilities[] | select(.requiresModel==true)] | length' "${s}" 2>/dev/null)" = "24" ]; then
      printf '%s' "${r}"
      return 0
    fi
  done
  printf ''
}

MODEL_RUN="$(find_model_batch_run)"
if [ -z "${MODEL_RUN}" ]; then
  echo "未找到 24 项 model 批 run；请先带 key 跑全链："
  echo "  DEEPSEEK_API_KEY=<key> bash apps/vscode-dsh/test-scripts/run-vscode-dsh-e2e-closure.sh"
  exit 1
fi
STATUS="${ARTIFACT_DIR}/${MODEL_RUN}/layer-v-capabilities-status.json"

say "model 批 run=${MODEL_RUN} per-capability 结论"
jq -r '.capabilities[] | "  \(.id)  \(.conclusion)  closed=\(.closedLoop.closed)"' "${STATUS}"

say "model 批失败项（reason 是否为 readonly-live）"
jq -r '.capabilities[] | select(.conclusion != "PASS") | "  \(.id): \(.reason // "n/a")"' "${STATUS}"

say "AC-8 污染② 判定：subagent 后 13 项是否存在 readonly-live 失败"
readonly_cnt="$(jq -r '[.capabilities[] | select(.conclusion != "PASS") | .reason // ""] | map(select(test("readonly-live"))) | length' "${STATUS}")"
if [ "${readonly_cnt}" = "0" ]; then
  echo "  ✅ 0 项 readonly-live 失败（污染② 复位生效；其余失败为真实缺陷）"
else
  echo "  ❌ ${readonly_cnt} 项 readonly-live 失败"
fi

say "AC-7 delegate 子会话证据（从单跑 run 提取）"
# 找「恰好 1 项且 id=cap-delegate-subagent-model」的最新 run
for r in $(ls -t "${ARTIFACT_DIR}" 2>/dev/null); do
  s="${ARTIFACT_DIR}/${r}/layer-v-capabilities-status.json"
  [ -f "${s}" ] || continue
  id="$(jq -r '.capabilities[0].id // ""' "${s}" 2>/dev/null)"
  if [ "${id}" = "cap-delegate-subagent-model" ]; then
    echo "  run=${r}"
    jq -r '.capabilities[0].steps[] | select(.step=="child-replied") | .value.children[0] | "  childSessionId=\(.sessionId)  title=\(.title)  status=\(.status)  assistantReplies=\([.messages[] | select(.role=="assistant") | .text] | join(" | "))"' "${s}"
    break
  fi
done

say "AC-4 fork 残留证据（从单跑 run 提取）"
for r in $(ls -t "${ARTIFACT_DIR}" 2>/dev/null); do
  s="${ARTIFACT_DIR}/${r}/layer-v-capabilities-status.json"
  [ -f "${s}" ] || continue
  id="$(jq -r '.capabilities[0].id // ""' "${s}" 2>/dev/null)"
  if [ "${id}" = "cap-fork-from-closed-turn" ]; then
    echo "  run=${r}"
    jq -r '.capabilities[0] | "  conclusion=\(.conclusion)  reason=\(.reason // "n/a")  closed=\(.closedLoop.closed)"' "${s}"
    break
  fi
done

say "AC-5 stream 隔离证据（两次 run 的 sawStreaming/sawGrowth）"
for r in $(ls -t "${ARTIFACT_DIR}" 2>/dev/null); do
  s="${ARTIFACT_DIR}/${r}/layer-v-capabilities-status.json"
  [ -f "${s}" ] || continue
  id="$(jq -r '.capabilities[0].id // ""' "${s}" 2>/dev/null)"
  if [ "${id}" = "cap-message-store-stream-patch" ]; then
    printf '  run=%s  ' "${r}"
    jq -r '.capabilities[0].steps[] | select(.kind=="stream") | "sawStreaming=\(.streaming.sawStreaming) sawGrowth=\(.streaming.sawGrowth)"' "${s}" | tr '\n' ' '
    echo ""
  fi
done

say "完成（真机复跑命令见脚本尾部注释）"

# 真机复跑命令（供复现，勿在报告回显 key 明文）：
#   export DEEPSEEK_API_KEY="$(grep '^DEEPSEEK_API_KEY=' .env | cut -d= -f2-)"
#   LAYER_V_CAPABILITY_ONLY="cap-message-store-stream-patch" bash apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh
#   LAYER_V_CAPABILITY_ONLY="cap-delegate-subagent-model" bash apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh
#   LAYER_V_CAPABILITY_ONLY="cap-fork-from-closed-turn"   bash apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh
#   bash apps/vscode-dsh/test-scripts/run-vscode-dsh-e2e-closure.sh
