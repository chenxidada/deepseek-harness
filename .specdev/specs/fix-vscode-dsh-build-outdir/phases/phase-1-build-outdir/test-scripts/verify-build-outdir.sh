#!/usr/bin/env bash
# verifier 独立验证脚本 — fix-vscode-dsh-build-outdir Phase 1
# 用途：干净重建 + 符号可达性 + 幂等 + .d.ts 存在性（端到端证据）
# 环境：Node 24.3.0（export PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH）
set -uo pipefail

cd "$(dirname "$0")/../../../../../../" || exit 1   # 回到仓库根
export PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH

APP="apps/vscode-dsh"
PASS=0
FAIL=0

ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

echo "== [1/6] 干净重建：rm -rf lib + tsc -b --force =="
rm -rf "$APP/lib"
./node_modules/.bin/tsc -b "$APP" --force
[ $? -eq 0 ] && ok "tsc -b apps/vscode-dsh --force 退出码 0" || bad "tsc 退出码非 0"

echo "== [2/6] 中间态 .js/.d.ts 落在 lib/types/ =="
for f in extension.js extension.d.ts index.js index.d.ts; do
  [ -f "$APP/lib/types/$f" ] && ok "lib/types/$f 存在" || bad "lib/types/$f 缺失"
done

echo "== [3/6] tsdown 打包 runtime 到 lib/ =="
./node_modules/.bin/tsdown --config "$APP/tsdown.config.ts" >/dev/null 2>&1
[ $? -eq 0 ] && ok "tsdown 退出码 0" || bad "tsdown 退出码非 0"
for f in extension.js index.js; do
  [ -f "$APP/lib/$f" ] && ok "lib/$f 存在" || bad "lib/$f 缺失"
done
CHUNK=$(ls "$APP/lib"/extension-*.js 2>/dev/null | head -1)
[ -n "$CHUNK" ] && ok "共享 chunk 存在: $(basename "$CHUNK")" || bad "共享 chunk 缺失"

echo "== [4/6] editor-chat-panel 符号可达（Node import 双入口）=="
node --input-type=module -e "const m = await import('./$APP/lib/index.js'); if (typeof m.createEditorChatPanelController==='function' && typeof m.EDITOR_CHAT_PANEL_VIEW_TYPE==='string' && typeof m.activate==='function') process.exit(0); process.exit(1)"
[ $? -eq 0 ] && ok "lib/index.js 符号可达（controller/VIEW_TYPE/activate）" || bad "lib/index.js 符号不可达"
node --input-type=module -e "const m = await import('./$APP/lib/extension.js'); if (typeof m.activate==='function' && typeof m.deactivate==='function') process.exit(0); process.exit(1)"
[ $? -eq 0 ] && ok "lib/extension.js（main）符号可达（activate/deactivate）" || bad "lib/extension.js 符号不可达"

echo "== [5/6] grep editor-chat-panel 命中（AC-2/AC-3）=="
HITS=$(rg -l "EDITOR_CHAT_PANEL_VIEW_TYPE|createEditorChatPanelController|createWebviewPanel" "$APP/lib"/*.js | wc -l)
[ "$HITS" -ge 1 ] && ok "rg 命中 $HITS 个 runtime 文件" || bad "rg 命中 0（疑似旧产物）"

echo "== [6/6] 幂等：连续两次 tsdown 产物 md5 一致（AC-10）=="
M1=$(md5sum "$APP/lib/extension.js" "$APP/lib/index.js" "$CHUNK" | md5sum)
./node_modules/.bin/tsdown --config "$APP/tsdown.config.ts" >/dev/null 2>&1
M2=$(md5sum "$APP/lib/extension.js" "$APP/lib/index.js" "$CHUNK" | md5sum)
[ "$M1" = "$M2" ] && ok "两次打包产物一致" || bad "两次打包产物不一致"

echo ""
echo "===== 结果：PASS=$PASS FAIL=$FAIL ====="
[ "$FAIL" -eq 0 ] && echo "VERDICT=PASS" || echo "VERDICT=FAIL"
exit 0
