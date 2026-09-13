# Phase 1 实现摘要（中文）— Must-Fix 回路 #1

## 修了什么

- **AC-1c**：`dsh.openHistory` / `dsh.searchSessions`（选中）/ `dsh.switchConversation` 成功后经 `revealConversationPanel` → `openOrFocus({ sessionId })` 创建并聚焦 Editor Chat Panel。
- **Should-Fix**：Messages→Status→Composer；`vscode:prepublish`/`prepublishOnly` 挂 `webview:build`；token 别名对齐。

## 测试

`vitest` 层 A+B：**13/13** 通过（含 AC-1c 层 B）。

## 路径

`.specdev/specs/vscode-dsh-editor-chat-panel/phases/phase-1-shell-tabs-basic-history/implementation.md`
