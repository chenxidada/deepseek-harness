# Correctness Review — phase-1-shell-tabs-basic-history

> Re-review after Must-Fix loop #1 (`loop_count=1`). Prior MUST-FIX archived at `.archive/review-correctness-20260913T135557Z.md`.

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**PASS**

上一轮 🔴 AC-1c（外部打开未聚焦 Editor Panel + 层 B 假绿）已闭合：生产路径函数体真实接线，且层 B 新增专用用例（13/13，非旧 9/9）。

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-1 | 主面 = Editor WebviewPanel | `editor-chat-panel.ts:createEditorChatPanelController` → `createWebviewPanel('dsh.editorChat')` | ✅ | 真实创建 Panel；HTML=`buildEditorChatSpaHtml`（SPA/`asWebviewUri`），非 `buildThinChatHtml` |
| AC-1b | 打开恢复未关 Tab / 空态 | `openOrFocus` + `pushFullState`；`MessageList` `messages-empty` | ✅ | reveal 时 `pushFullState` 投影 Registry tabs；无 Tab 时空态节点 |
| AC-1c | 外部打开聚焦并切会话 | `extension.ts` `revealConversationPanel` → `openOrFocus({ sessionId })`；`dsh.openHistory` / `dsh.searchSessions` / `dsh.switchConversation` | ✅ | **Must-Fix #1 闭合**：见下方「AC-1c 复审」 |
| AC-1d | waiting/error 可见；composer 有因禁用 | `chat-ui-store.deriveComposerState` + `Composer` `data-composer-state` + `status` | ✅ | waiting/readonly/error/live 真实派生；placeholder 说明原因 |
| AC-1e / Q-5 | 关 Panel×running：提示且不 cancel | `editor-chat-panel.onPanelDisposed` + `extension.onRunningPanelClosed` | ✅ | dispose 仅 InformationMessage；**不**调 `requestStop`；层 B 断言 `cancel` 未调用 |
| AC-1f / Q-7 | 不自动弹 Panel | `activate` 仅 `createEditorChatPanelController`；层 B | ✅ | activate 不调用 `openOrFocus`；失败路径不 reveal |
| AC-2 | 主入口打开/聚焦 | `dsh.showPanel` → `revealConversationPanel` | ✅ | 命令路径真实打开 Editor Panel |
| AC-3 | 决策态 Host | `ChatPanelHost`；React 只 `applyHostFrame` | ✅ | React 不自裁 send；`composer/send`→Host |
| AC-4 | 废弃侧栏主聊天 | `registerChatPanelProvider` → migration HTML；**不** `panelHost.attach` | ✅ | 侧栏仅迁移 tip + `ui/open-editor-chat` |
| AC-5 | 单一主面；TreeView 非主切换 | Editor Panel Tab chrome 为主 | ✅ | TreeView demote；主 chrome 在 React `TabChrome` |
| AC-10 | 顶栏 Tab chrome | `TabChrome.tsx` + `panel/tabs` | ✅ | DOM 契约齐全 |
| AC-10a | running 角标 | `tab-running-badge` | ✅ | `status==='running'` 时渲染 |
| AC-10b | 标题可区分 | tab `title` 投影 | ✅ | Host 推 title / sessionId 截断 |
| AC-10c | Registry 变更顶栏更新 | `registry.onChange` → `pushFullState` | ✅ | Controller/extension 均有 onChange→push |
| AC-11 | 切 Tab 不串台 | `ui/tab-select` → `switchConversation` + `messages/replace` | ✅ | Host 只推 active session messages |
| AC-11a | 回 Tab 恢复/默认 | `pushFullState` 重放 messages | ✅ | 切回触发全量投影 |
| AC-11b | 流随 activeTabId | 同上 | ✅ | 非活动 session 不 push append/replace |
| AC-12 | 新建空态可输入 | `ui/tab-new` → `requestNewConversation` | ✅ | 走既有 new + reveal |
| AC-13/13a | 关 Tab + fallback/空态 | `ui/tab-close` → `runCloseTab` | ✅ | 复用既有 close 语义 |
| AC-13b | 关 running 须确认 | `runCloseTab` + `needs-confirm-running` | ✅ | 真实 confirm 分支 |
| AC-14 | 历史入口；搜索入口可见 | `btn-history` / `btn-search` | ✅ | 历史开面板内列表；搜索→QuickPick（GAP-ECP-003） |
| AC-14c | Tab 溢出滚动 | `TabChrome` `overflowX: 'auto'` | ✅ | 真实 CSS |
| AC-15 | 活动/非活动可区分 | `data-active` + 样式 | ✅ | border/背景区分 |
| AC-16 | 禁止每会话一 editor tab | 单 Panel 内多 Tab | ✅ | 仅一个 `dsh.editorChat` Panel |
| AC-25 | streaming fail-closed | `status/set` → `streaming` false | ✅ | store 离开 generating/running 清 streaming |
| AC-40 | 层 A+B+≥1 层 V | RTL + lifecycle（含 AC-1c）；层 V 交 verifier | ⚠️ | A+B 本机 13/13 绿；层 V 仍待 verifier 真机 |
| AC-42 | 禁仅单测绿冒充 | 专用 RTL + 本轮 AC-1c 层 B | ✅ | 旧 `buildThinChatHtml` 层 A 非本 feature UI PASS |
| AC-43 | 2–3 Phase | phase-plan | ✅ | 计划为 2 Phase |
| AC-50/50a | 顶栏开历史；非空窗 | `HistoryPanel` + `panel/history` | ✅ | open/loading/empty/rows 契约 |
| AC-51 | 标题/时间/预览 | `HistoryPanel` 行渲染 | ✅ | title + updatedAt + previewOrPath |
| AC-52 | 点击激活或只读打开；不 auto-Start | `openFromHistory` | ✅ | 已有 Tab→activate；否则 `mode=replay` |
| AC-58 | 空态/loading 不白屏 | `messages-empty` / `messages-loading` / `history-*` | ✅ | 真实节点；SPA 缺资产有提示 |
| UI-AC-1 | 顶栏+消息+composer 对局 | `App.tsx` | ✅ | flex 列：TabChrome → History → Messages → Status → Composer |
| UI-AC-2 | `--vscode-*`/`--dsh-*`；无外链字体 | `tokens.css` + SPA CSP | ✅ | 无 CDN/fonts |
| UI-AC-3/10 | 薄 chrome ≤40px | `--dsh-chrome-height: 36px` | ✅ | |
| UI-AC-11/12 | 活动区分；running 角标 | TabChrome | ✅ | |
| UI-AC-13 | 新建/历史/搜索/溢出可发现 | 四个按钮 | ✅ | |
| UI-AC-14 | 溢出不挤爆消息区 | chrome `flexShrink:0` | ✅ | |
| UI-AC-24 | 消息空态/loading | `MessageList` | ✅ | |
| UI-AC-40/41 | 历史列表行 + 空/loading | `HistoryPanel` | ✅ | |
| UI-AC-50 | 基础 hover/focus | `tokens.css` | ✅ | |
| UI-AC-60/61 | UI 文档引用 / 层 V 清单 | spec 引用；层 V 待 verifier | ⚠️ | 不构成代码空壳 |
| AD-ECP-8 | 生产 HTML=React SPA | `buildEditorChatSpaHtml` | ✅ | 非 `buildThinChatHtml` 主路径 |
| AD-ECP-10 | Bridge/DOM/probes/CSP/RTL | bridge/store/probes + RTL | ✅ | |
| AD-ECP-4/11 | InformationMessage；retainContext | extension + create options | ✅ | `retainContextWhenHidden: true` |
| 先建后拆 | 新壳可聊后再弃侧栏主聊 | SPA Panel + 侧栏 demote | ✅ | |

## AC-1c 复审（Must-Fix #1 闭合证据）

### 生产路径（读函数体，非信摘要）

1. **`revealConversationPanel(vscode, false, { sessionId })`**（`extension.ts` ~2233–2242）
   → 一律 `editorChatPanel.openOrFocus({ preserveFocus: false, sessionId })`，单轨，无「命令内 switch + 另 reveal」双轨漂移。

2. **`openOrFocus({ sessionId })`**（`editor-chat-panel.ts` ~190–229）
   - 有 `sessionId` → `await deps.onOpenSession?.(sessionId)`（已有 Tab 则 `switchConversation`）
   - Panel 已存在 → `panel.reveal(..., preserveFocus=false)` + `pushFullState`
   - Panel 不存在 → `createWebviewPanel` + SPA HTML + `pushFullState`

3. **外部入口成功末尾接线**（失败不 reveal，符合 Q-7）：
   | 命令 | 成功条件 | 函数体证据 |
   |------|----------|-----------|
   | `dsh.switchConversation` | switch 无异常 | ~532–536 / ~564–568：`revealConversationPanel(..., { sessionId })` |
   | `dsh.openHistory` | `opened` \| `activated` | ~638–640：同上 |
   | `dsh.searchSessions` | 选中 hit 且 `opened` \| `activated` | ~726–728：同上 |

4. **`onOpenSession` 生产接线**（`extension.ts` ~410–417）：按 `sessionId` 查 Registry，存在则 `switchConversation`——真实逻辑，非空壳。

### 层 B 覆盖（禁止旧 9/9 假绿）

| 用例 | 断言 | 文件 |
|------|------|------|
| `openOrFocus({ sessionId })` | create + onOpenSession；二次 reveal 不 recreate | `editor-chat-panel.lifecycle.spec.ts` |
| `dsh.switchConversation` | 成功后 `createWebviewPanel`；再切 `reveal` | 同文件 describe `layer-B AC-1c…` |
| `dsh.openHistory` | 成功 opened/activated 后 create Panel | 同 |
| `dsh.searchSessions` 选中 | 成功后 create Panel | 同 |

本机独立复跑：

```text
pnpm exec vitest run \
  apps/vscode-dsh/tests/layer-a-rtl/editor-chat-shell.spec.tsx \
  apps/vscode-dsh/tests/editor-chat-panel.lifecycle.spec.ts
→ Test Files  2 passed (2)
→ Tests  13 passed (13)
```

> 以 **13/13（含 AC-1c）** 为准；旧 9/9 **不得** 再作为 AC-1c PASS 证据。

### 偏差说明（非 Must）

- `dsh.test.openHistory` / `dsh.test.switchConversation` **未**强制 reveal（implementation 已记）：测试钩子隔离，不以之为生产证据——可接受。

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）

| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| GAP-ECP-001 | Composer 四态/AC-23a | ⚠️ Known | P1 豁免 |
| GAP-ECP-002 | Stop / AC-33b | ⚠️ Known | P1 豁免 |
| GAP-ECP-003 | btn-search → QuickPick | ⚠️ Known | 入口可见；完整搜索→P2 |
| GAP-ECP-004 | History 删除/Continue/父子 | ⚠️ Known | 基础列表已实现 |
| GAP-ECP-005 | MD settle | ⚠️ Known | 纯文本最小可聊 |
| GAP-ECP-006 | UI 精修 | ⚠️ Known | 基础 hover/focus 已有 |
| DEBT-ECP-001 | `buildThinChatHtml` | ⚠️ Known | @deprecated；非 Panel 生产路径 |

### 新发现的未注册桩

| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| （无） | — | — | — |

## 关键发现

### 🔴 Must-Fix

（无）— 上一轮 AC-1c Must-Fix 已闭合。

### 🟡 Should-Fix

1. **`ui/history-open` loading 同 tick 连推两帧**（`chat-panel-host.ts` ~659–664）：`historyLoading=true` 立即再 `false`，真实 SPA 可能看不见 `history-loading`（RTL 因分步 `applyHostFrame` 仍绿）。不破坏 AC-50a「非空窗」（仍有 rows/empty），故不挡 PASS；建议异步间隙使 loading 可观测。
2. **层 B Q-5 用例**仍主要断言 dispose 回调 / 不 cancel，未直接断言 `showInformationMessage` 文案通道（extension 接线正确）。可选加强，不挡 PASS。

### 🟢 Observations

1. 上一轮 design Should-Fix（Messages→Status→Composer、`vscode:prepublish`/`prepublishOnly`→`webview:build`、token 别名）已在代码中落地；本视角仅作观察，不改判。
2. 生产主路径仍正确：Panel → SPA；侧栏 → migration；先建后拆成立。
3. 层 V 仍交 verifier 真机（含 AC-1c 外部入口关 Panel 后应自动创建并聚焦）。
4. Registry 延期项无漏登；本轮无新增未注册桩。

## 测试复跑（correctness 独立）

```text
pnpm exec vitest run \
  apps/vscode-dsh/tests/layer-a-rtl/editor-chat-shell.spec.tsx \
  apps/vscode-dsh/tests/editor-chat-panel.lifecycle.spec.ts
→ Test Files  2 passed (2)
→ Tests  13 passed (13)   # includes 4 AC-1c-focused cases
```
