# Connectivity Review — Phase 1 (`phase-1-shell-tabs-basic-history`)

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**MUST-FIX**

## 端到端路径追踪

### Path 1: 主入口 openOrFocus → SPA → Host 全量投影
```
Entry: dsh.showPanel / statusBar / newConversation / sidebar ui/open-editor-chat
  → revealConversationPanel()
    → editorChatPanel.openOrFocus()
      → createWebviewPanel('dsh.editorChat') + retainContextWhenHidden
      → buildEditorChatSpaHtml (asWebviewUri + CSP)
      → panelHost.attach(port)
      → panelHost.pushFullState()
        → panel/tabs + panel/state + messages/replace + status/set + panel/history
  → SPA window message → MessageBridge.applyFrame → chat-ui-store
  → React: TabChrome / MessageList / Composer / HistoryPanel
Exit: DOM 契约节点可渲染（RTL 层 A 覆盖）
```
**判定**: ✅ 主路径连通（AD-ECP-1/8/11）

### Path 2: 最小可聊 send → Host → messages
```
Entry: Composer btn-send / Enter
  → bridge.emitIntent({ type: 'composer/send', text })
  → ChatPanelHost.sendPrompt → deps.acceptSend → controller.promptActive
  → Host 决策态（reject → ui/reject-send；accept → 既有 turn）
  → pushAppend / pushPatch / status/set（仅 active session）
  → Bridge → store → MessageList [data-testid=msg]
Exit: 活动会话消息面更新
```
**判定**: ✅ 上下行契约接通；决策仍在 Host（AC-3）

### Path 3: Tab 切换不串台
```
Entry: TabChrome click → ui/tab-select { tabId }
  → Host.requestSelectTab → controller.switchConversation
  → pushFullState → messages/replace(active.sessionId only)
  → Host pushAppend/pushPatch 以 active.sessionId 门禁
Exit: SPA 消息列表被 replace，非活动流不下发
```
**判定**: ✅ Host 侧门禁 + replace 投影连通（AC-11/11b）。层 B 未用 FakeWebview 端到端断言双 Tab 串台（见 Should-Fix）

### Path 4: 面板内历史打开 / 去重 / replay
```
Entry: btn-history → ui/history-open
  → Host.historyOpen=true → panel/history (loading → rows via listHistoryRows/ExtensionIndex)
Entry: history-row click → ui/history-select { sessionId }
  → requestOpenHistorySession → controller.openFromHistory
    → 已有 Tab: switchConversation（去重 activate）
    → 否则: registry.create(replay) + hydrate + 不 auto-Start
  → pushFullState；Host 关闭 history 窗
Exit: 活动 Tab + messages/replace 为 replay/激活会话
```
**判定**: ✅ **面板已打开时**历史链路完整（AC-50/50a/51/52）。
⚠️ 见 Path 5 — 面板外历史入口未聚焦主面

### Path 5: 外部打开聚焦并切会话（AC-1c）
```
Entry: History TreeView → dsh.openHistory(sessionId)
   或 Search QuickPick → openSearchHit
   或 Conversations TreeView → dsh.switchConversation(tabId)
  → controller.openFromHistory / switchConversation ✅ Registry + messages 更新
  → panelHost.pushFullState()（若有）
  → ❌ 未调用 revealConversationPanel / openOrFocus
Exit: Panel 关闭时 port=undefined → 帧只进 outbound log；用户看不到聚焦主面
```
**判定**: 🔴 MUST-FIX — AC-1c「外部打开聚焦并切会话」端到端断裂。
`openOrFocus({ sessionId })` + `onOpenSession` 已接线，但 extension 命令路径未使用。

### Path 6: 侧栏不再可读写消息流（AC-4/5）
```
Entry: resolveWebviewView(dsh.chat)
  → buildSidebarMigrationHtml（无 panelHost.attach）
  → 仅 ui/open-editor-chat → revealConversationPanel
Exit: 侧栏无 messages 投影 / 无 composer send
```
**判定**: ✅ 可读写路径已切断；migration → Editor Panel 连通

### Path 7: dispose × running 不 cancel（AC-1e / Q-5）
```
Entry: WebviewPanel.onDidDispose
  → registry 有 status===running？
    → onRunningPanelClosed → showInformationMessage（仅提示）
  → panelHost.detach()
  → ❌ 不调用 requestStop / cancelActiveTurn
Exit: 后台会话继续；再 openOrFocus → attach + pushFullState 恢复投影
```
**判定**: ✅ 连通且 fail-closed（层 B FakeWebview 覆盖）

### Path 8: activate 不自动弹（AC-1f / Q-7）
```
Entry: activate()
  → createEditorChatPanelController（单例就绪）
  → ❌ 不调用 openOrFocus / createWebviewPanel
Exit: 仅显式命令 / 新建 / migration / selection-ask 等打开
```
**判定**: ✅ 不自动弹。层 B 测 controller 级「未 openOrFocus 不 create」；未直接测 `activate()`（见 Observations）

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `createEditorChatPanelController` | `extension.activate` | ✅ | `createWebviewPanel` / `panelHost.attach` | ✅ |
| `openOrFocus` | `revealConversationPanel` | ✅ | SPA HTML + `pushFullState` | ✅ |
| `openOrFocus({ sessionId })` | （几乎无调用方） | 🔴 | `onOpenSession` → `switchConversation` | ✅ 已接线未用 |
| `MessageBridge` | `main.tsx` / RTL | ✅ | `applyHostFrame` / `postMessage` | ✅ |
| `ChatPanelHost.pushTabsFrame` | `pushFullState` / Registry onChange | ✅ | SPA `panel/tabs` | ✅ |
| `ChatPanelHost.pushHistoryFrame` | history intents / pushFullState | ✅ | SPA `panel/history` | ✅ |
| `requestSelectTab` | `ui/tab-select` | ✅ | `switchConversation` | ✅ |
| `requestOpenHistorySession` | `ui/history-select` | ✅ | `openFromHistory` | ✅ |
| `listHistoryRows` | `pushHistoryFrame` | ✅ | `ExtensionIndex.listHistorySessions` | ✅ |
| `registerChatPanelProvider` | activate | ✅ | migration HTML only（无 attach） | ✅ |
| `dsh.openHistory` | History TreeView | ✅ | `openFromHistory` | ⚠️ 缺 reveal |
| `dsh.switchConversation` | Tab TreeView | ✅ | `switchConversation` | ⚠️ 缺 reveal |
| `onRunningPanelClosed` | Panel dispose | ✅ | `showInformationMessage` only | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| SPA → Host chrome | `ui/tab-*` / `ui/history-*` / `ready` / `composer/send` | `protocol.parseWebviewToHostMessage` + Host handlers | ✅ |
| Host → SPA tabs | `panel/tabs` { activeTabId, tabs[] } | store `applyHostFrame` + TabChrome | ✅ |
| Host → SPA history | `panel/history` { open, loading, rows } | HistoryPanel | ✅ |
| Host → SPA messages | `messages/replace\|append\|patch` + active 门禁 | store 应用；Host 拒非活动 session | ✅ |
| Panel → Host port | `attach` / `detach` on open/dispose | ChatPanelHost | ✅ |
| Editor HTML | React SPA via `asWebviewUri` | `buildEditorChatSpaHtml`；非 `buildThinChatHtml` | ✅ |
| 外部命令 → Panel 聚焦 | AC-1c 打开/切会话后聚焦主面 | 仅 Registry/Host 更新，无 `openOrFocus` | 🔴 |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `ConversationRegistry` / `ChatPanelHost` / send-stream 协议 | 前序基线 | 复用未改冻结语义 | ✅ |
| `ExtensionIndex.listHistorySessions` / `openFromHistory` | 前序基线 | 去重+replay 保留 | ✅ |
| 无依赖其他 DAG Phase | — | Phase 1 无上游 Phase | ✅ |

## FakeWebview / 生命周期测试覆盖

| 关键接线 | 层 B 覆盖？ | 说明 |
|---------|:--:|------|
| 未 openOrFocus 不 create Panel（Q-7） | ✅ | `editor-chat-panel.lifecycle.spec.ts` |
| dispose×running → hint、不 cancel（Q-5） | ✅ | Fake panel + `requestStop` 间谍 |
| `panel/tabs` / `ui/history-open` → `panel/history` | ✅ | FakeWebviewPort + Host |
| CSP / `asWebviewUri` HTML | ✅ | `buildEditorChatSpaHtml` 冒烟 |
| `ui/tab-select` → `messages/replace` 不串台 | ❌ | 代码连通，缺 FakeWebview 断言 |
| `ui/history-select` → `openFromHistory` 去重 | ❌ | Host deps 接线存在，缺层 B |
| `activate()` 不自动 `openOrFocus` | ❌ | 仅 controller 级；extension 路径未测 |
| 外部 `dsh.openHistory` → reveal Panel | ❌ | 实现缺口 + 测试缺口 |

## 关键发现

### 🔴 Must-Fix
- **AC-1c 外部打开未聚焦 Editor Panel**：`dsh.openHistory`、`dsh.searchSessions` 选中打开、`dsh.switchConversation` 成功后均未调用 `revealConversationPanel` / `editorChatPanel.openOrFocus({ sessionId })`。History TreeView / Conversations TreeView 仍是真实入口，Panel 关闭时用户切换会话后主面不出现，帧落入 `port === undefined` 的 outbound-only 黑洞直至手动打开。应在上述成功路径末尾 reveal（优先复用已有 `openOrFocus({ sessionId })`）。

### 🟡 Should-Fix
- 层 B 补 FakeWebview：`ui/tab-select` 后断言 `messages/replace.sessionId` 与活动 Tab 一致；`ui/history-select` 经 stub `requestOpenHistorySession` 断言去重/replay 后 `pushFullState`。
- `openOrFocus({ sessionId })` API 已实现却无生产调用方 — 与 AC-1c 修复一并接上，避免双轨（命令内 switch + 另 reveal）漂移。

### 🟢 Observations
- 面板内主路径（Tab / 历史 / send / SPA / 侧栏降级 / Q-5 / Q-7）接线完整，契约与 design 帧一致。
- Host `ui/history-open` 注释称「yield one tick」但同步连发 loading→rows；不阻断行数据连通，仅 loading 可观测性弱（非本视角主责）。
- Registry `onChange` → `pushFullState` 已接通，AC-10c 顶栏实时更新在 Panel 已 attach 时成立。

## 详细依据（call site）
- `apps/vscode-dsh/src/chat-panel/editor-chat-panel.ts` — open/attach/dispose
- `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` — tabs/history/select/send
- `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` — 侧栏无 attach
- `apps/vscode-dsh/src/extension.ts` — reveal / Host deps / onRunningPanelClosed / activate
- `apps/vscode-dsh/webview/src/bridge/message-bridge.ts` + `store/chat-ui-store.ts` + `App.tsx`
- `apps/vscode-dsh/tests/editor-chat-panel.lifecycle.spec.ts`
