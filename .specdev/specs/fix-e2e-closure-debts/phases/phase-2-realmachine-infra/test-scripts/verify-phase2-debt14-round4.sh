#!/usr/bin/env bash
#
# verifier 独立验证脚本（第四轮）— DEBT-14 修复「构建后交付态」真闭环确认 + 回归证据提取
#
# 只读检查 + 运行时证据提取，不改任何文件。
# 覆盖：
#   1. 构建产物新鲜度：lib/ 与 webview/dist/ mtime 是否晚于对应 src（防止旧 lib 假阳性）
#   2. lib 是否含 DEBT-14 修复分支（triggerAutoReady + newConversation(EMPTY_LIVE_TITLE)）
#   3. DEBT-14 非空 openTabSet 场景证据提取（openTabSet / mode / sessionId / marker / closedLoop）
#   4. DEBT-10 真实委托 + DEBT-12 复位回归证据提取（child session marker / readonly-live 计数）
#
# 用法：
#   bash .specdev/specs/fix-e2e-closure-debts/phases/phase-2-realmachine-infra/test-scripts/verify-phase2-debt14-round4.sh \
#       [debt14RunId] [debt10RunId]

set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../../../../.." && pwd -P)"
APP_DIR="${REPO_ROOT}/apps/vscode-dsh"
ARTIFACT_DIR="${APP_DIR}/test-artifacts/layer-v-capabilities/runs"
SRC_EXT="${APP_DIR}/src/extension.ts"
LIB="${APP_DIR}/lib/extension-C6sxRWop.js"
WEBVIEW_SRC="${APP_DIR}/webview/src/probes.ts"

say() { printf '\n==== %s ====\n' "$*"; }

mtime() { stat -c '%Y' "$1" 2>/dev/null || printf '0'; }

say "构建产物新鲜度（lib / webview dist 必须晚于 src）"
printf '  src/extension.ts mtime        = %s\n' "$(mtime "${SRC_EXT}")"
printf '  lib/extension-C6sxRWop.js    = %s\n' "$(mtime "${LIB}")"
printf '  webview/src/probes.ts mtime  = %s\n' "$(mtime "${WEBVIEW_SRC}")"
for d in "${APP_DIR}"/webview/dist/assets/*.js "${APP_DIR}"/webview/dist/assets/*.css; do
  printf '  %s = %s\n' "$(basename "${d}")" "$(mtime "${d}")"
done
if [ "$(mtime "${LIB}")" -gt "$(mtime "${SRC_EXT}")" ]; then
  echo "  ✅ lib 晚于 src"
else
  echo "  ❌ lib 早于或等于 src —— 构建产物未就绪（旧 lib 假阳性风险）"
fi

say "lib 是否含 DEBT-14 修复分支"
if grep -q "await autoReady?.triggerAutoReady()" "${LIB}" && grep -q "newConversation(EMPTY_LIVE_TITLE)" "${LIB}"; then
  echo "  ✅ lib 含 triggerAutoReady 结算 + newConversation(EMPTY_LIVE_TITLE) 重建分支"
else
  echo "  ❌ lib 缺修复分支"
fi

DEBT14_RUN="${1:-}"
DEBT10_RUN="${2:-}"
if [ -z "${DEBT14_RUN}" ]; then
  # 自动定位「stream-patch + selection-ask」双能力最新 run
  for r in $(ls -t "${ARTIFACT_DIR}" 2>/dev/null); do
    s="${ARTIFACT_DIR}/${r}/layer-v-capabilities-status.json"
    [ -f "${s}" ] || continue
    ids="$(jq -r '[.capabilities[].id] | join(",")' "${s}" 2>/dev/null)"
    case "${ids}" in
      *cap-message-store-stream-patch*cap-selection-ask*) DEBT14_RUN="${r}"; break ;;
    esac
  done
fi
if [ -z "${DEBT10_RUN}" ]; then
  for r in $(ls -t "${ARTIFACT_DIR}" 2>/dev/null); do
    s="${ARTIFACT_DIR}/${r}/layer-v-capabilities-status.json"
    [ -f "${s}" ] || continue
    ids="$(jq -r '[.capabilities[].id] | join(",")' "${s}" 2>/dev/null)"
    case "${ids}" in
      *cap-delegate-subagent-model*) DEBT10_RUN="${r}"; break ;;
    esac
  done
fi

if [ -n "${DEBT14_RUN}" ]; then
  say "DEBT-14 非空 openTabSet 复验 run=${DEBT14_RUN}"
  jq -r '.capabilities[] | "  \(.id)  \(.conclusion)  closed=\(.closedLoop.closed)"' \
    "${ARTIFACT_DIR}/${DEBT14_RUN}/layer-v-capabilities-status.json"
  echo "  -- host-started openTabSet --"
  jq -r '.capabilities[] | select(.id=="cap-selection-ask") | (.steps // [])[] | select(.step=="host-started") | .value | "  tabs=\(.tabs)  openTabSet=\(.openTabSet)"' \
    "${ARTIFACT_DIR}/${DEBT14_RUN}/layer-v-capabilities-status.json"
  echo "  -- new-conversation / send-prompt / assistant-replied 会话一致性 --"
  jq -r '.capabilities[] | select(.id=="cap-selection-ask") | (.steps // [])[] | select(.step=="new-conversation" or .step=="send-prompt" or .step=="assistant-replied") | "  [\(.step)] ok=\(.ok)  mode=\(.value.mode // "n/a")  sessionId=\(.value.sessionId // "n/a")"' \
    "${ARTIFACT_DIR}/${DEBT14_RUN}/layer-v-capabilities-status.json"
  echo "  -- assistant 回复 marker --"
  jq -r '.capabilities[] | select(.id=="cap-selection-ask") | (.steps // [])[] | select(.step=="assistant-replied") | .value.messages[] | select(.role=="assistant") | .text' \
    "${ARTIFACT_DIR}/${DEBT14_RUN}/layer-v-capabilities-status.json" | sed 's/^/    /'
  echo "  -- closedLoop --"
  jq -r '.capabilities[] | select(.id=="cap-selection-ask") | .closedLoop | "  closed=\(.closed)  actualTrigger=\(.actualTrigger)  concreteAssertion=\(.concreteAssertion)  realScreenshot=\(.realScreenshot)"' \
    "${ARTIFACT_DIR}/${DEBT14_RUN}/layer-v-capabilities-status.json"
else
  echo "  未找到 DEBT-14 双能力 run"
fi

if [ -n "${DEBT10_RUN}" ]; then
  say "DEBT-10 真实委托 + DEBT-12 复位回归 run=${DEBT10_RUN}"
  jq -r '.capabilities[] | "  \(.id)  \(.conclusion)  closed=\(.closedLoop.closed)"' \
    "${ARTIFACT_DIR}/${DEBT10_RUN}/layer-v-capabilities-status.json"
  echo "  -- delegate 子会话 --"
  jq -r '.capabilities[] | select(.id=="cap-delegate-subagent-model") | (.steps // [])[] | select(.step=="child-replied") | .value.children[0] | "  childSessionId=\(.sessionId)  title=\(.title)  status=\(.status)  parentSessionId=\(.parentSessionId)"' \
    "${ARTIFACT_DIR}/${DEBT10_RUN}/layer-v-capabilities-status.json"
  jq -r '.capabilities[] | select(.id=="cap-delegate-subagent-model") | (.steps // [])[] | select(.step=="child-replied") | .value.children[0].messages[] | select(.role=="assistant") | .text' \
    "${ARTIFACT_DIR}/${DEBT10_RUN}/layer-v-capabilities-status.json" | sed 's/^/    /'
  echo "  -- readonly-live 失败计数（DEBT-12 复位，应为 0）--"
  readonly_cnt="$(jq -r '[.capabilities[] | select(.conclusion != "PASS") | .reason // ""] | map(select(test("readonly-live"))) | length' \
    "${ARTIFACT_DIR}/${DEBT10_RUN}/layer-v-capabilities-status.json")"
  echo "  readonly-live 失败 = ${readonly_cnt}"
  [ "${readonly_cnt}" = "0" ] && echo "  ✅ DEBT-12 复位生效（subagent 后无 readonly-live 污染）"
else
  echo "  未找到 delegate run"
fi

say "完成"
