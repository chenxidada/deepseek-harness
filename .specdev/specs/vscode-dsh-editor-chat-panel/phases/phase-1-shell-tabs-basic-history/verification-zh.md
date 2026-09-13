# Phase 1 验证报告（中文）— phase-1-shell-tabs-basic-history

## 判决：PARTIAL

本机无法打开真机 VS Code 层 V（无 CLI / 无 DISPLAY）。独立层 A 7/7、层 B 8/8、构建与静态代理均通过，但按 AC-40/42 **禁止无层 V 宣称 PASS**。

## 为何不是 PASS

1. §9 Phase 1 六项人眼核对均 `BLOCKED_NO_HOST`（残余风险 MEDIUM）
2. light/dark 双主题未抽检
3. sticky composer / chrome 高度 / hover-focus 仅有 RTL+CSS 代理，无人眼截图

P1 豁免项（四态/Stop/AC-23a 等）**不计入失败**。

## 通过的端到端场景摘要

- Host tabs 帧 → TabChrome → `ui/tab-select`
- Host history 帧（loading→rows）→ 面板内历史行（含标题/时间/预览）
- Q-7 不自动弹 Panel；Q-5 dispose×running 不 cancel
- AC-1c：`switchConversation` 成功创建 Panel；失败 `openHistory` 不 reveal
- SPA CSP + `retainContextWhenHidden` + DOM 契约（status / messages-empty / tabs / history / composer）

## 脚本

`test-scripts/run-verifier.sh`；详情见同目录 `verification.md`。
