# 正确性审查 — phase-1-shell-tabs-basic-history

## 视角
**实现正确性** — 代码是否真正工作

## 判决
**MUST-FIX**

## 摘要

React SPA Editor Panel、侧栏降级、Q-5/Q-7、RTL 层 A、Registry 延期项登记总体到位；**AC-1c 未满足**：`dsh.openHistory` / `dsh.searchSessions` / `dsh.switchConversation` 外部入口切会话后未 `revealConversationPanel`，Panel 关闭时用户看不到主面。层 A+B 9/9 绿未覆盖该路径，存在假绿。

完整表格与证据见同目录 `review-correctness.md`。
