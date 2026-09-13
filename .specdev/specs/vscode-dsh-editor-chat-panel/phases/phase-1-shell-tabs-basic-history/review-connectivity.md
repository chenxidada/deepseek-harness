# Connectivity Review — Phase 1 (`phase-1-shell-tabs-basic-history`)

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

> Must-Fix 回路 #1 复审（loop_count=1）。上一轮 Path 5（AC-1c 外部打开未聚焦）已接通：三条外部命令成功路径均经 `revealConversationPanel(..., { sessionId })` → `openOrFocus({ sessionId })`；层 B 覆盖 create/reveal。

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
  → SPA MessageBridge → chat-ui-store → React 壳
Exit: DOM 契约节点可渲染
```
**判定**: ✅ 主路径连通（相对初版无回退）

### Path 2: 最小可聊 send → Host → messages
```
Entry: Composer send
  → bridge.emitIntent(composer/send)
  → ChatPanelHost → acceptSend / 决策态
  → pushAppend / pushPatch / status/set（active session 门禁）
Exit: 活动会话消息面更新
```
**判定**: ✅ 上下行契约接通

### Path 3: Tab 切换不串台（面板内）
```
Entry: TabChrome → ui/tab-select
  → Host.requestSelectTab → switchConversation
  → pushFullState → messages/replace(active only)
Exit: 非活动流不下发
```
**判定**: ✅ 连通

### Path 4: 面板内历史打开 / 去重 / replay
```
Entry: btn-history → ui/history-open → panel/history
Entry: history-row → ui/history-select
  → requestOpenHistorySession → openFromHistory
  → pushFullState（Panel 已开，无需 reveal）
Exit: 活动 Tab + messages/replace
```
**判定**: ✅ 面板内路径完整（AC-50/52）。面板内意图不经 reveal 属正确（入口已在 Panel）

### Path 5: 外部打开聚焦并切会话（AC-1c）— **本轮焦点**
```
A) History TreeView (history-view.ts command=dsh.openHistory + sessionId)
   → dsh.openHistory(sessionId)
     → controller.openFromHistory(sessionId)     ✅ Registry / hydrate
     → panelHost?.pushFullState()                （Panel 关时 port 空，可空推）
     → outcome ∈ {opened|activated}
       → revealConversationPanel(vscode, false, { sessionId })
         → openOrFocus({ sessionId, preserveFocus: false })
           → onOpenSession(sessionId) → switchConversation if Tab exists
           → panel===undefined? createWebviewPanel + attach + pushFullState
             : panel.reveal + pushFullState
Exit: Editor Chat 创建/聚焦 + 目标会话活动

B) Conversations TreeView (conversation-tab-bar.ts → dsh.switchConversation + tabId)
   → dsh.switchConversation(tabId)
     → controller.switchConversation(tabId)
     → revealConversationPanel(..., { sessionId: tab.sessionId })
       → openOrFocus({ sessionId }) …
Exit: 同 A（QuickPick 无参路径同样 reveal）

C) Search QuickPick → dsh.searchSessions
   → openSearchHit(chosen.tabId)
   → outcome ∈ {opened|activated}
     → revealConversationPanel(..., { sessionId: chosen.tabId })
       → openOrFocus({ sessionId }) …
Exit: 同 A

失败路径（host-not-ready / missing / error / 取消）→ 不 reveal（Q-7 守恒）
```
**判定**: ✅ 上一轮断裂已修复；三条外部入口 → 单轨 `openOrFocus({ sessionId })` 接通。
Panel 关闭（`panel === undefined`，含 dispose 后）走 create+attach；已开走 reveal — 与层 B 断言一致。

### Path 6: 侧栏可读写切断（AC-4/5）
```
resolveWebviewView(dsh.chat) → migration HTML only → ui/open-editor-chat → reveal
```
**判定**: ✅ 连通

### Path 7: dispose × running（AC-1e）
```
onDidDispose → InformationMessage；detach；不 cancel
再 openOrFocus → attach + pushFullState
```
**判定**: ✅ 连通

### Path 8: activate 不自动弹（AC-1f）
```
activate → createEditorChatPanelController；不调用 openOrFocus
```
**判定**: ✅ 连通

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `revealConversationPanel(..., { sessionId })` | `openHistory` / `searchSessions` / `switchConversation` 成功路径 | ✅ | `openOrFocus({ sessionId })` | ✅ |
| `openOrFocus({ sessionId })` | `revealConversationPanel` | ✅ | `onOpenSession` + create/reveal + `pushFullState` | ✅ |
| `onOpenSession` | `openOrFocus` | ✅ | `registry.getBySessionId` → `switchConversation` | ✅ |
| History TreeView `command` | 用户点击 | ✅ | `dsh.openHistory` + `sessionId` | ✅ |
| Conversations TreeView `command` | 用户点击 | ✅ | `dsh.switchConversation` + `tabId` | ✅ |
| `dsh.searchSessions` 选中命中 | QuickPick | ✅ | `openSearchHit` → reveal | ✅ |
| `requestOpenHistorySession` | 面板内 history-select | ✅ | `openFromHistory`（无需 reveal） | ✅ |
| `requestOpenSearchHit` | 面板内 search hit | ✅ | `openSearchHit`（Panel 已开） | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| 外部命令 → reveal | 成功后带 `sessionId` 聚焦 | `revealConversationPanel(vscode, false, { sessionId })` | ✅ |
| reveal → Panel | `openOrFocus({ sessionId?, preserveFocus })` | 同签名实现 | ✅ |
| Panel → Host | `onOpenSession(sessionId)` 切已有 Tab | activate 接线：`getBySessionId` → `switchConversation` | ✅ |
| openHistory 成功门禁 | 仅 `opened\|activated` reveal | 代码分支一致；失败不 reveal | ✅ |
| searchSessions 成功门禁 | 同上 | 同上 | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| ConversationRegistry / openFromHistory / openSearchHit | 基线（无前序 Phase） | 未改冻结契约语义 | ✅ |
| ChatPanelHost.pushFullState | 基线 | attach 后由 openOrFocus 再推 | ✅ |

无跨 Phase 冻结接口被破坏。

## 层 B 测试覆盖（AC-1c）

| 用例 | 覆盖点 | 状态 |
|------|--------|:--:|
| `openOrFocus({ sessionId })` | create + onOpenSession；二次 reveal 不 recreate | ✅ |
| `dsh.switchConversation` | Panel 未开 → create；再切 → reveal | ✅ |
| `dsh.openHistory` 成功 | Panel 未开 → create | ✅ |
| `dsh.searchSessions` 选中 | Panel 未开 → create | ✅ |

本机复跑：`editor-chat-panel.lifecycle.spec.ts` → **8 passed**（含上述 AC-1c 用例）。

## 关键发现

### 🔴 Must-Fix
（无）— 上一轮 AC-1c 端到端断裂已修复。

### 🟡 Should-Fix
（无连通性阻断项）

### 🟢 Observations
- `switchConversation` 先 `switch` 再 `openOrFocus({ sessionId })` → `onOpenSession` 可能二次 switch；冗余但契约一致，非断链。
- `openHistory` / `searchSessions` 层 B 断言以 `createWebviewPanel` 为主；「已开 Panel 再外部打开」的 `reveal` 计数主要由 controller 级用例 + `switchConversation` 覆盖，生产路径仍共用 `revealConversationPanel`。
- `dsh.test.openHistory` / `dsh.test.switchConversation` 仍不强制 reveal（implementation 已标偏差）；勿作生产 AC-1c 证据。
- 面板内 `requestOpenHistorySession` / `requestOpenSearchHit` 不 reveal：正确（入口已在 Panel）。
