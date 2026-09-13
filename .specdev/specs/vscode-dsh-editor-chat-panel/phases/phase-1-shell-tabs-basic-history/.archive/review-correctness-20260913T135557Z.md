# Correctness Review — phase-1-shell-tabs-basic-history

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**MUST-FIX**

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-1 | 主面 = Editor WebviewPanel | `editor-chat-panel.ts:createEditorChatPanelController` → `createWebviewPanel('dsh.editorChat')` | ✅ | 真实创建 Panel；HTML=`buildEditorChatSpaHtml`（SPA/`asWebviewUri`），非 `buildThinChatHtml` |
| AC-1b | 打开恢复未关 Tab / 空态 | `openOrFocus` + `pushFullState`；`MessageList` `messages-empty` | ✅ | reveal 时 `pushFullState` 投影 Registry tabs；无 Tab 时空态节点 |
| AC-1c | 外部打开聚焦并切会话 | `dsh.openHistory` / `dsh.searchSessions` / `dsh.switchConversation` | ❌ | 外部入口会 `openFromHistory`/`switchConversation`，但**未**调用 `revealConversationPanel`/`openOrFocus` → Panel 关闭时仅切会话不聚焦主面（违背「创建并聚焦 Panel」） |
| AC-1d | waiting/error 可见；composer 有因禁用 | `chat-ui-store.deriveComposerState` + `Composer` `data-composer-state` + `status` | ✅ | waiting/readonly/error/live 真实派生；placeholder 说明原因 |
| AC-1e / Q-5 | 关 Panel×running：提示且不 cancel | `editor-chat-panel.onPanelDisposed` + `extension.onRunningPanelClosed` | ✅ | dispose 仅 `onRunningPanelClosed`→`showInformationMessage`；**不**调 `requestStop`；层 B 断言 `cancel` 未调用 |
| AC-1f / Q-7 | 不自动弹 Panel | `activate` 仅 `createEditorChatPanelController`；层 B | ✅ | activate 不调用 `openOrFocus`；`createWebviewPanel` 仅在 `openOrFocus`；层 B 覆盖 |
| AC-2 | 主入口打开/聚焦 | `dsh.showPanel` → `revealConversationPanel` | ✅ | 命令路径真实打开 Editor Panel |
| AC-3 | 决策态 Host | `ChatPanelHost`；React 只 `applyHostFrame` | ✅ | React 不自裁 send；`composer/send`→Host |
| AC-4 | 废弃侧栏主聊天 | `registerChatPanelProvider` → `buildSidebarMigrationHtml`；**不** `panelHost.attach` | ✅ | 侧栏仅迁移 tip + `ui/open-editor-chat`；无第二可读写消息流（先建后拆满足） |
| AC-5 | 单一主面；TreeView 非主切换 | Editor Panel Tab chrome 为主 | ✅ | TreeView 仍注册但 demote；主 chrome 在 React `TabChrome` |
| AC-10 | 顶栏 Tab chrome | `TabChrome.tsx` + `panel/tabs` | ✅ | DOM 契约齐全；真实渲染 tabs |
| AC-10a | running 角标 | `tab-running-badge` | ✅ | `status==='running'` 时渲染 |
| AC-10b | 标题可区分 | tab `title` 投影 | ✅ | Host 推 title / sessionId 截断 |
| AC-10c | Registry 变更顶栏更新 | `registry.onChange` → `pushFullState` → `pushTabsFrame` | ✅ | Controller/extension 均有 onChange→push |
| AC-11 | 切 Tab 不串台 | `ui/tab-select` → `switchConversation` + `messages/replace` | ✅ | Host 只推 active session messages |
| AC-11a | 回 Tab 恢复/默认 | `pushFullState` 重放 messages | ✅ | 切回触发全量投影 |
| AC-11b | 流随 activeTabId | 同上 | ✅ | 非活动 session 不 push append/replace |
| AC-12 | 新建空态可输入 | `ui/tab-new` → `requestNewConversation` | ✅ | 走既有 `runNewConversationFromPanel` + reveal |
| AC-13/13a | 关 Tab + fallback/空态 | `ui/tab-close` → `runCloseTab` → `closeConversation` | ✅ | 复用既有 close 语义 |
| AC-13b | 关 running 须确认 | `runCloseTab` + `needs-confirm-running` | ✅ | 真实 confirm 分支，非空壳 |
| AC-14 | 历史入口；搜索入口可见 | `btn-history` / `btn-search` | ✅ | 历史开面板内列表；搜索入口→`dsh.searchSessions`（完整档1+2 UI→P2，已登记 GAP-ECP-003） |
| AC-14c | Tab 溢出滚动 | `TabChrome` `overflowX: 'auto'` | ✅ | 真实 CSS 溢出滚动 |
| AC-15 | 活动/非活动可区分 | `data-active` + 样式 | ✅ | border/背景区分 |
| AC-16 | 禁止每会话一 editor tab | 单 Panel 内多 Tab | ✅ | 仅一个 `dsh.editorChat` Panel |
| AC-25 | streaming fail-closed | `status/set` → `streaming` false | ✅ | store 离开 generating/running 清 streaming；RTL 覆盖 |
| AC-40 | 层 A+B+≥1 层 V | RTL + lifecycle；层 V 手工步骤 | ⚠️ | A+B 实测 9/9 绿；层 V 仅 implementation 步骤、本机未跑（交 verifier） |
| AC-42 | 禁仅单测绿冒充 | `tests/layer-a-rtl/*` 为 UI PASS；旧 `buildThinChatHtml` 层 A 标注非本 feature | ✅ | 专用 RTL；旧层 A 有 NOTE；部分 `it.skip` |
| AC-43 | 2–3 Phase | phase-plan | ✅ | 计划为 2 Phase（流程项） |
| AC-50/50a | 顶栏开历史；非空窗 | `HistoryPanel` + `panel/history` | ✅ | open/loading/empty/rows 契约；RTL 覆盖 |
| AC-51 | 标题/时间/预览 | `HistoryPanel` 行渲染 | ✅ | title + updatedAt + previewOrPath |
| AC-52 | 点击激活或只读打开；不 auto-Start | `openFromHistory` | ✅ | 已有 Tab→activate；否则 `mode=replay`；注释/实现明确不 Start |
| AC-58 | 空态/loading 不白屏 | `messages-empty` / `messages-loading` / `history-*` | ✅ | 真实节点；SPA 缺资产时有 `spa-missing` 提示 |
| UI-AC-1 | 顶栏+消息+composer 对局 | `App.tsx` | ✅ | flex 列布局完整 |
| UI-AC-2 | `--vscode-*`/`--dsh-*`；无外链字体 | `tokens.css` + SPA CSP | ✅ | 无 CDN/fonts；CSP smoke 层 B |
| UI-AC-3/10 | 薄 chrome ≤40px | `--dsh-chrome-height: 36px`；`maxHeight: 40` | ✅ | |
| UI-AC-11/12 | 活动区分；running 角标不挡标题 | TabChrome | ✅ | |
| UI-AC-13 | 新建/历史/搜索/溢出可发现 | 四个按钮 | ✅ | `btn-overflow` 无业务 handler（可发现即可；P1 可接受） |
| UI-AC-14 | 溢出不挤爆消息区 | chrome `flexShrink:0` + tab scroll | ✅ | |
| UI-AC-24 | 消息空态/loading | `MessageList` | ✅ | |
| UI-AC-40/41 | 历史列表行 + 空/loading | `HistoryPanel` | ✅ | |
| UI-AC-50 | 基础 hover/focus | `tokens.css` `:hover` / `:focus-visible` | ✅ | |
| UI-AC-60/61 | UI 文档引用 / 层 V 清单 | spec 引用；层 V 待 verifier | ⚠️ | 文档锚点在；层 V 未执行证据 |
| AD-ECP-8 | 生产 HTML=React SPA | `buildEditorChatSpaHtml` | ✅ | Panel 生产路径不用 `buildThinChatHtml`（仍 @deprecated 保留，DEBT-ECP-001） |
| AD-ECP-10 | Bridge/DOM/probes/CSP/RTL | bridge/store/probes + RTL | ✅ | `__dshProbes` 真实；RTL 断言 DOM 非仅探针 |
| AD-ECP-4/11 | InformationMessage；retainContext | extension + create options | ✅ | `retainContextWhenHidden: true` |
| 先建后拆 | 新壳可聊后再弃侧栏主聊 | SPA Panel attach + 侧栏 demote | ✅ | |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）

| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| GAP-ECP-001 | Composer 四态/AC-23a | ⚠️ Known | P1 豁免；骨架非空壳 |
| GAP-ECP-002 | Stop / AC-33b | ⚠️ Known | 无 btn-stop；streaming 仅 status |
| GAP-ECP-003 | btn-search → QuickPick | ⚠️ Known | 入口可见；完整搜索 UI→P2 |
| GAP-ECP-004 | History 删除/Continue/父子 | ⚠️ Known | 基础列表已实现 |
| GAP-ECP-005 | MD settle | ⚠️ Known | 纯文本气泡最小可聊 |
| GAP-ECP-006 | UI 精修 | ⚠️ Known | 基础 hover/focus 已有 |
| DEBT-ECP-001 | `buildThinChatHtml` | ⚠️ Known | @deprecated；非 Panel 生产路径 |

### 新发现的未注册桩

| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| （无系统性未注册空壳） | — | — | AC-1c 为**缺失接线**而非 `return []` 式桩 |

## 关键发现

### 🔴 Must-Fix

1. **AC-1c 未满足（外部入口不聚焦 Editor Panel）**
   - `dsh.openHistory`（History TreeView 命令）、`dsh.searchSessions`（打开 hit）、`dsh.switchConversation`（Conversations TreeView）在成功切会话 / `openFromHistory` 后**没有**调用 `revealConversationPanel` / `editorChatPanel.openOrFocus`。
   - 结果：Panel 未打开时，外部打开会话只更新 Registry/Host 投影，用户看不到编辑器区主面——直接违背 AC-1c「创建并聚焦 Panel，并切换到目标会话」。
   - 层 A/B 当前套件**未覆盖**该路径 → 存在假绿风险（9/9 绿但 AC-1c 仍红）。
   - **修复方向**：上述外部成功路径末尾统一 `await revealConversationPanel(vscode)`（或 `openOrFocus({ sessionId })`）；并补层 B 断言：`createWebviewPanel`/`reveal` 在外部 open 后被调用。

### 🟡 Should-Fix

1. **`ui/history-open` loading 同 tick 连推两帧**（`chat-panel-host.ts`）：`historyLoading=true` 立即再 `false`，真实 SPA 可能看不见 `history-loading`（RTL 因分步 `applyHostFrame` 仍绿）。建议 `queueMicrotask`/`setTimeout(0)` 或异步读 index，使 loading 可观测。
2. **层 B Q-5 用例**只断言 `onRunningPanelClosed` 回调、未断言 `showInformationMessage` 文案；extension 接线正确，但测试与 AD-ECP-4 文案通道可更贴合。

### 🟢 Observations

1. **生产主路径正确**：Panel → `buildEditorChatSpaHtml` + `webview/dist`；侧栏 → migration HTML；`buildThinChatHtml` 仅 legacy fixture（已登记 DEBT-ECP-001）。先建后拆成立。
2. **层 A 真绿边界清晰**：`tests/layer-a-rtl/editor-chat-shell.spec.tsx` 为 Phase 1 UI PASS；旧 `tests/layer-a/*` 文件头注明非本 feature UI PASS。本机复跑：2 files / 9 tests passed。
3. **Q-5 / Q-7 实现体真实**：dispose×running 不 cancel + InformationMessage；activate 不 auto-open。
4. **Registry 延期项**（AC-23a/Stop/搜索完整 UI/历史完整/MD/UI 精修/内联退役）均已写入 `tech-debt-registry.md`，无漏登阻塞项。
5. **层 V**：implementer 提供手工冒烟清单，无自动化层 V 产物——交 verifier 真机执行；不单独构成代码空壳，但整 Phase PASS 仍受 AC-40/42 约束。

## 测试复跑（correctness 独立）

```text
pnpm exec vitest run \
  apps/vscode-dsh/tests/layer-a-rtl/editor-chat-shell.spec.tsx \
  apps/vscode-dsh/tests/editor-chat-panel.lifecycle.spec.ts
→ Test Files  2 passed (2)
→ Tests  9 passed (9)
```

> 注意：上述绿**不能**覆盖 AC-1c；不得据此宣称本 Phase 功能正确性 PASS。
