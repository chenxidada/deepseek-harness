#!/usr/bin/env bash
# verifier 独立验证脚本（fix-vscode-dsh-host-tsc / phase-1-fix）
# 不信 implementer 自报结果，独立复跑编译门禁 + 运行时回归 + 静态残留 + 语义等价抽查。
set -u
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../../.." && pwd)"
cd "$REPO_ROOT"
export PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH

echo "== Node 版本 =="
node --version

echo ""
echo "== AC-1/5/6/7/8 编译门禁（tsc -b --force 从零重编译） =="
(cd apps/vscode-dsh && ../../node_modules/.bin/tsc -b --force)
TSC_EXIT=$?
echo "TSC_EXIT_CODE=$TSC_EXIT"

echo ""
echo "== AC-3 matchTier 单数残留（应为 0 匹配） =="
if rg -n '\bmatchTier\b' apps/vscode-dsh/src apps/vscode-dsh/webview/src apps/vscode-dsh/tests; then
  echo "AC-3 FAIL: 发现 matchTier 单数残留"
else
  echo "AC-3 PASS: 无 matchTier 单数残留"
fi

echo ""
echo "== AC-6 Thenable 残留（应为 0 匹配） =="
if rg -n '\bThenable\b' apps/vscode-dsh/src; then
  echo "AC-6 FAIL: 发现 Thenable 残留"
else
  echo "AC-6 PASS: 无 Thenable 残留"
fi

echo ""
echo "== AC-2/4/7/9/10/11 运行时回归（9 文件） =="
./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/chat-ux-session-search.spec.ts \
  apps/vscode-dsh/tests/layer-a-rtl/editor-chat-phase2.spec.tsx \
  apps/vscode-dsh/tests/verifier-phase2/layer-a-rtl.spec.tsx \
  apps/vscode-dsh/tests/verifier-phase2/layer-b-host.spec.ts \
  apps/vscode-dsh/tests/phase1-code-context.spec.ts \
  apps/vscode-dsh/tests/phase3-review-revert-replay.spec.ts \
  apps/vscode-dsh/tests/chat-ux-streaming-cancel-follow.spec.ts \
  apps/vscode-dsh/tests/chat-ux-activity-stream.spec.ts \
  apps/vscode-dsh/tests/layer-a/activity-stream.spec.ts
VITEST_EXIT=$?
echo "VITEST_EXIT_CODE=$VITEST_EXIT"

echo ""
echo "== 语义等价静态抽查（条件展开消费方守卫） =="
echo "AC-9  skipWrite 默认写盘: revert.ts 应含 'if (options.skipWrite !== true)'"
rg -n 'options\.skipWrite !== true' apps/vscode-dsh/src/change/revert.ts
echo "AC-10 confirmGate 取消语义: revert.ts 应含 'options.confirmGate !== undefined' 与 cancelled 返回"
rg -n "options\.confirmGate !== undefined|reason: 'cancelled'" apps/vscode-dsh/src/change/revert.ts
echo "AC-11 turn 字段省略: conversation-controller.ts 应含条件展开"
rg -n "turn === undefined \? \{\} : \{ turn \}" apps/vscode-dsh/src/conversation-controller.ts

echo ""
echo "== 汇总 =="
echo "TSC_EXIT_CODE=$TSC_EXIT VITEST_EXIT_CODE=$VITEST_EXIT"
if [ "$TSC_EXIT" -eq 0 ] && [ "$VITEST_EXIT" -eq 0 ]; then
  echo "RESULT=PASS"
else
  echo "RESULT=FAIL"
fi
