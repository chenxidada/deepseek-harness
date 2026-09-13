# 设计一致性审查 — phase-1-shell-tabs-basic-history

## 视角
**Design Consistency** — 实现是否遵循架构与 UI 契约

## 判决
**SHOULD-FIX**

## 摘要

- **AD-ECP-8/9/4/5/11**：React+Vite SPA 主路径、Host 决策态、关 Panel×running 提示、不自动弹、retainContext —— 均遵循。
- **AD-ECP-10**：MessageBridge + DOM 契约 + `__dshProbes` 分工正确；CSP/`asWebviewUri`/`.vscodeignore`/`files` 合格；**webview:build 未挂入扩展编译/prepublish** → Should-Fix。
- **UI P1**：薄顶栏、theme-first、历史骨架、空态/loading、基础 hover/focus、豁免项登记正确；**status 行在消息区之上**，偏离 visual-spec §3「Messages→Status→Composer」→ Should-Fix。
- **模块边界**：`webview/` 与 `editor-chat-panel.ts` 对齐 design 文件计划；Host 不 import React。
- **无 Must-Fix**（无 AD 硬决议或 Constitution §2 违反）。

## 详细报告
见同目录 [review-design.md](./review-design.md)。
