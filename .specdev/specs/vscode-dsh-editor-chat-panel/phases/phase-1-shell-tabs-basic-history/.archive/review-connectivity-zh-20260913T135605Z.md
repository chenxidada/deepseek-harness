# 连通性审查 — Phase 1（`phase-1-shell-tabs-basic-history`）

## 视角
**集成连通性** — 模块间是否真正连通

## 判决
**MUST-FIX**

## 摘要
主路径 `openOrFocus → Panel SPA → Bridge → Host → tabs/messages/history` 已接通；Tab 切换由 Host `messages/replace` + active 门禁防串台；面板内历史去重/replay 接通；侧栏已切断可读写 attach；dispose×running 只提示不 cancel；activate 不自动弹 Panel。

**阻断点（AC-1c）**：`dsh.openHistory` / 搜索打开 / `dsh.switchConversation` 成功后未 `revealConversationPanel` / `openOrFocus`，Panel 关闭时外部打开无法聚焦主面。

## 详见
完整路径追踪与表格见同目录 `review-connectivity.md`。
