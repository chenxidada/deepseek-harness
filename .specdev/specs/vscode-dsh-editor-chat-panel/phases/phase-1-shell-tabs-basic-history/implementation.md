# Phase 1 实现摘要 — phase-1-shell-tabs-basic-history

## Must-Fix 回路 #1（loop_count=1）

针对合并审查 MUST-FIX：**AC-1c 外部打开未聚焦 Editor Panel**。

### 本轮变更清单

| 路径 | 说明 |
|------|------|
| `apps/vscode-dsh/src/extension.ts` | `revealConversationPanel` 支持 `opts.sessionId` → `openOrFocus({ sessionId })`；`dsh.switchConversation` / `dsh.openHistory`（opened\|activated）/ `dsh.searchSessions`（选中打开成功）末尾统一 reveal |
| `apps/vscode-dsh/tests/editor-chat-panel.lifecycle.spec.ts` | 层 B：`openOrFocus({ sessionId })` + activate 级三条命令断言 `createWebviewPanel`/`reveal` |
| `apps/vscode-dsh/webview/src/App.tsx` | Should-Fix：布局 Messages → Status → Composer（ui-visual-spec §3） |
| `apps/vscode-dsh/webview/src/styles/tokens.css` | Should-Fix：`--dsh-btn-*` / `--dsh-panel-bg` / `--dsh-radius-*` 别名 |
| `apps/vscode-dsh/package.json` | Should-Fix：`vscode:prepublish` + `prepublishOnly` → `webview:build` |
| `apps/vscode-dsh/tests/layer-a-rtl/editor-chat-shell.spec.tsx` | 断言 Messages/Status/Composer DOM 顺序 |
| `apps/vscode-dsh/webview/dist/**` | 重建 SPA 产物 |

### AC-1c 实现说明

成功路径一律走已有单轨 API，避免「命令内 switch + 另 reveal」双轨漂移：

1. 外部入口先完成会话切换 / `openFromHistory` / `openSearchHit`
2. 成功（`opened` \| `activated`，或 switch 无异常）后调用
   `revealConversationPanel(vscode, false, { sessionId })`
3. `revealConversationPanel` → `editorChatPanel.openOrFocus({ sessionId, preserveFocus: false })`
   → `onOpenSession`（若 Tab 已存在则 `switchConversation`）+ create/reveal Panel + `pushFullState`

失败路径（host-not-ready / missing / error / 取消）**不** reveal（保持 Q-7：不无故自动弹）。

## 对每个验收标准的实现说明（累计）

| ID | 实现 |
|----|------|
| AC-1 | `createEditorChatPanelController` → `createWebviewPanel('dsh.editorChat')` |
| AC-1b | `openOrFocus` reveal + `pushFullState`；空态 `messages-empty` |
| AC-1c | **Must-Fix #1**：外部 `openHistory` / `searchSessions` 选中 / `switchConversation` 成功后 `openOrFocus({ sessionId })` |
| AC-1d | composer 四态派生 + status |
| AC-1e | dispose × running → InformationMessage；不 cancel |
| AC-1f | activate 不自动 `openOrFocus` |
| AC-2…58 / UI-AC / AD-ECP-* | 见初版实现；本轮未回退 |

### P1 豁免（仍登记债务）

GAP-ECP-001…006、DEBT-ECP-001 不变。

## 测试结果（命令 + 输出）

```bash
pnpm exec vitest run \
  apps/vscode-dsh/tests/layer-a-rtl/editor-chat-shell.spec.tsx \
  apps/vscode-dsh/tests/editor-chat-panel.lifecycle.spec.ts
# → Test Files  2 passed (2)
# → Tests  13 passed (13)

pnpm --filter @deepseek-ai/dsh-vscode-dsh run webview:build
# → dist/assets/index.js + index.css ✓
```

### 层 B 新增（相对初版 9/9）

| 用例 | 断言 |
|------|------|
| `openOrFocus({ sessionId })` | create + onOpenSession；二次调用 reveal 不 recreate |
| `dsh.switchConversation` | 成功后 `createWebviewPanel`；再切 `reveal` |
| `dsh.openHistory` | 成功 opened/activated 后 create Panel |
| `dsh.searchSessions` 选中 | 成功后 create Panel |

> 禁止仅凭旧 9/9 宣称 AC-1c PASS；本轮以 13/13（含 AC-1c）为准。

### 层 V 冒烟（真机，verifier）

同初版 + **额外**：History TreeView / Conversations TreeView / Search 打开会话时，若 Panel 已关须自动创建并聚焦 Editor Chat。

## 偏差记录

| 偏差 | 影响 | 原因 | 下游影响 |
|------|------|------|----------|
| 侧栏仍为 migration tip | AC-4 | 先建后拆 | 可接受 |
| `btn-search` → QuickPick | GAP-ECP-003 | P1 入口可见即可 | P2 |
| `dsh.test.openHistory` / `dsh.test.switchConversation` **未**强制 reveal | 测试钩子 | 保持既有 L2 测试隔离；生产命令已接线 | 测试钩子勿当生产证据 |

## 债务

无本轮新增阻塞桩。Should-Fix 三项已落地（布局 / prepublish / token 别名）。
