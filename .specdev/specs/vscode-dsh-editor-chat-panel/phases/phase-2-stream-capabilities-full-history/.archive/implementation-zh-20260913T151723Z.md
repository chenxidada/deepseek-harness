# Phase 2 实现摘要（MUST-FIX 回路 #1）— 中文

> 英文全文见同目录 `implementation.md`。

## 本回路修复

1. **AC-24 跟滚**：滚动监听 + `decideFollowState` +「回到底部」；`data-follow-state` / probes 实时反映 `on`/`off`。
2. **AC-34a 编辑**：用户消息「编辑重发」→ emit `action/edit-resend`。
3. **AC-35 分叉**：可见「分叉」→ emit `action/branch`。

另：历史搜索结果进历史列表、清理粘滞 Continue pending、历史行 ⋮ 菜单、空态新建 CTA、`@dsh/safe-markdown` alias。

## 测试

`vitest`：`editor-chat-phase2.spec.tsx` + `phase2-history-delete-host.spec.ts` → **13/13 passed**；`webview:build` 成功。

## 残留

- Tab 右键删除菜单未做（溢出删除已可用）。
- 层 V 仍依赖真机 DISPLAY（既有 checklist）。

## 产出路径

- `phases/phase-2-stream-capabilities-full-history/implementation.md`
- `phases/phase-2-stream-capabilities-full-history/implementation-zh.md`
