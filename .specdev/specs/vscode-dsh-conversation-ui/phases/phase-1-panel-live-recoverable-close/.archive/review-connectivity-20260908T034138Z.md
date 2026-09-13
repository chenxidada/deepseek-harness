# Connectivity Review — phase-1-panel-live-recoverable-close

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**MUST-FIX**

## 端到端路径追踪

### Path 1: 发送 → prompt → messages/append（live）
```
Entry: Webview composer/send | L2 dsh.test.sendPrompt | dsh.promptActiveConversation
  → ChatPanelHost.sendPrompt (gate: empty / no-host / no-active / replay / disconnected)
       ├─ reject → H→W ui/reject-send ✅
       └─ accept → deps.acceptSend
            → ConversationController.promptActive / promptTab
                 → IdeSessionHost.prompt (既有 session/prompt 缝) ✅
                 → projectUserMessage → MessageStore.append + panelHost.pushAppend
                      → H→W messages/append (user 全文) ✅
            → SDK session.event assistant/message
                 → onSdkNotification → projectAssistantMessage
                      → MessageStore.append + panelHost.pushAppend
                      → H→W messages/append (完整 assistant，非 token patch) ✅
Exit: MessageStore + outbound / Webview 收到完整回合气泡
```
**判定**: ✅ 数据路径完整；门禁与既有 prompt 缝连通；无断链桩

### Path 2: 关 Tab 可恢复（≠ dispose）
```
Entry: dsh.closeConversation | dsh.test.closeConversation
  → runCloseTab / controller.closeConversation
       ├─ running 且未 confirmStopClose → needs-confirm-running
       │    → confirmStopAndClose UI → confirmStopClose:true 再关 ✅
       ├─ failClosedSession(sessionId) ✅（卸 UI 前中止该 Tab 等待）
       ├─ 不调用 host.disposeSession ✅
       ├─ registry.close(tabId)（tabId 销毁；邻 Tab 升为 active）✅
       ├─ persistOpenTabs → ExtensionIndex.setOpenTabs → writeImmediate ✅
       │    （空 Tab 经 hasContent 过滤，不入 openTabSet）✅
       └─ panelHost.pushFullState
            ├─ 仍有活动 Tab → panel/state + messages/replace + status/set ✅
            └─ 无活动 Tab → panel/state(empty|waiting-host) + status/set
                 ❌ 未下发清空消息列表的帧；薄 HTML 亦不在 empty 时清 #messages
Exit: 权威/进程内 session 保留；索引更新；面板在「关到空态」时 Webview 可能残留旧气泡
```
**判定**: 🔴 MUST-FIX — Host 关闭/卸绑定到空态时，H→W 消息列表清空路径断裂（AC-2 / AC-24「无串台残留 / 空态」）

### Path 3: 显式删除 dispose
```
Entry: dsh.deleteConversation | 菜单 | dsh.test.deleteConversation | W→H action/delete
  → runDeleteActive / ChatPanelHost.requestDelete
       → deleteConversation
            ├─ host.status !== connected → host-not-ready（不假删索引）✅
            ├─ confirmed !== true → needs-confirm（确认前不 dispose）✅
            ├─ confirmDeleteConversation UI ✅
            ├─ failClosedSession → host.disposeSession(bridge session/dispose) ✅
            ├─ messages.clearSession + timeline.clearSession ✅
            ├─ index.markDeleted（不级联子 session）✅
            ├─ registry.close + persistOpenTabs + pushFullState ✅
Exit: live Tab 关闭；投影清除；索引 tombstone；dispose 仅删除路径
```
**判定**: ✅ 删除状态机端到端连通（AC-26/60/72/73/61）

### Path 4: 切 Tab（不串台）
```
Entry: dsh.switchConversation / registry.switchTo
  → registry.onChange → persistOpenTabs + panelHost.pushFullState
       → panel/state{sessionId,mode}
       → messages/replace{sessionId, messages: MessageStore.get(sessionId)} ✅
       → status/set（仅活动 Tab；listPending 过滤 sessionId）✅
  pushAppend 非活动 sessionId 直接 return（后台 running 不污染活动面）✅
Exit: 活动会话消息全量替换；发送目标随 registry.getActive
```
**判定**: ✅ AC-18/21 路径连通

### Path 5: L2 Host 测试钩子
```
activate → createPanelHost（eager，脱离 Webview）✅
  → registerCommand:
       dsh.test.sendPrompt → panelHost.sendPrompt ✅
       dsh.test.closeConversation / deleteConversation ✅
       dsh.test.panelSnapshot / getIndex / openPanel ✅
  package.json contributes + activationEvents 已登记 ✅
  run-phase1-l2-l3.sh → vitest panel-* + close/delete e2e ✅
```
**判定**: ✅ L2 可脱离 Webview 驱动 Host；无未接线钩子

### Path 6: L3 FakeWebviewPort ↔ ChatPanelHost
```
FakeWebviewPort implements WebviewMessagePort
  → panel.attach(fake) 订阅 onDidReceiveMessage ✅
  → emitFromWebview(composer/send|ready) → parse → sendPrompt / pushFullState ✅
  → Host postMessage → fake.receivedFromHost + outbound log ✅
  切 Tab / reject / waiting-interaction 用例覆盖 call site ✅
```
**判定**: ✅ L3 模拟客户端与真实 Host 协议处理连通（空态清空见 Path 2 缺口）

### Path 7: L2 钩子 — waiting-interaction / Timeline 弱化
```
InteractionCoordinator.onChange → controller → panelHost.pushStatus
  → resolveStatus 读 listPending(sessionId) → status/set waiting-interaction ✅
TimelineStore.assistant/message → description:'assistant turn'（面板走 MessageStore）✅
```
**判定**: ✅ 连通；非本 Phase 阻塞桩

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `ChatPanelHost.sendPrompt` | Webview / `dsh.test.sendPrompt` | ✅ | `acceptSend`→`promptActive` | ✅ |
| `ChatPanelHost.pushAppend` | `projectUser/AssistantMessage` | ✅ | `port.postMessage` / outbound | ✅ |
| `ChatPanelHost.pushFullState`（有活动 Tab） | registry/close/delete/switch/attach | ✅ | panel/state+replace+status | ✅ |
| `ChatPanelHost.pushFullState`（空态） | close last / unbind / stop | 🔴 | 仅 state+status，无消息清空 | 🔴 |
| `ConversationController.closeConversation` | close 命令 / L2 钩子 | ✅ | failClosed；**不** dispose；index；panel | ✅ |
| `ConversationController.deleteConversation` | delete 命令 / L2 / action/delete | ✅ | `disposeSession`+clear+tombstone | ✅ |
| `ExtensionIndex.writeImmediate` | setOpenTabs / upsert / markDeleted | ✅ | `workspaceState.update` | ✅ |
| `MessageStore.append/get` | controller 投影 / panel replace | ✅ | panel Host 消费 | ✅ |
| `FakeWebviewPort` | L3 测试 | ✅ | `ChatPanelHost.attach` | ✅ |
| `registerChatPanelProvider` | `activate` | ✅ | `panelHost.attach(webview)` | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| ChatPanelHost → acceptSend | `(text)=> {messageId,sessionId,tabId}` | `promptActive` 返回同结构 | ✅ |
| Webview → Host | `composer/send {text}` | `parseWebviewToHostMessage` + `sendPrompt` | ✅ |
| Host → Webview | `messages/append` 完整回合 | controller 仅完整 user/assistant append | ✅ |
| Host → Webview 空态 | 消息列表空（AC-2） | 无 replace/clear；HTML 不清 DOM | 🔴 |
| close → IdeSessionHost | 不调用 dispose | close 路径无 `disposeSession` | ✅ |
| delete → IdeSessionHost | `disposeSession(sessionId)` | bridge dispose 调用存在 | ✅ |
| Index ↔ controller | 空 Tab 不入 openTabSet；立即写 | `hasContent` 过滤 + `writeImmediate` | ✅ |
| Registry AC-59 | 同 sessionId 单开 | `create` 已开则 throw | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `IdeSessionHost.prompt` / `disposeSession` | vscode-dsh-ide（前序） | 复用未改签名 | ✅ |
| agent-loop / ide-bridge 双通道 | 前序 | 本 Phase 未改 | ✅ |
| T-0a / T-0b Spike | 0a/0b | 本 Phase 明确不依赖 | ✅ |
| MessageStore 关 Tab 后保留投影 | 为 phase-2 历史再开预留 | 有意保留，非死写 | ✅（观测） |
| DEBT-001 / GAP-001 | → phase-2/3 | 非本 Phase 阻塞 | ✅ |

## 关键发现
### 🔴 Must-Fix
- **空态消息清空断链（AC-2 / AC-24）**：`ChatPanelHost.pushFullState` 在 `registry.getActive()===undefined` 时只推 `panel/state` + `status/set`，不下发清空消息列表的协议帧；薄 Webview HTML 在 `mode==='empty'|'waiting-host'` 时也不清空 `#messages`。因此「关掉最后一个有内容 Tab」或 `stopSession`/`unbindConversations` 后，已 attach 的 Webview / 按 last-replace 推导的 L3 客户端状态机会残留上一会话气泡（串台残留）。修复任选其一或组合：空态分支推送 `messages/replace`（可用空 `sessionId` 或约定 clear 语义）+ 薄客户端在 empty/waiting-host 时 `renderMessages([])`。

### 🟡 Should-Fix
- （无独立 SHOULD-FIX；空态缺口已升为 Must-Fix。）

### 🟢 Observations
- 发送 / 关≠删 / 删=dispose / 切 Tab replace / L2 `dsh.test.*` / L3 `FakeWebviewPort` 主路径 call site 均已接线；未见 `@STUB` 或未注册断链桩。
- `dsh.promptActiveConversation` 绕过 `ChatPanelHost` 门禁直接 `promptActive`，与设计「可编程 prompt 保留」一致；L2 发送门禁走 `dsh.test.sendPrompt`。
- 关 Tab 后 MessageStore/Timeline 内存投影保留，供后续 Phase 再开；删除才 `clearSession` — 符合 AD-CU-3，非数据黑洞。
- `extension` 与 `controller` 双重 `registry.onChange`→`pushFullState` 冗余，不构成断链。
- 实现偏差（vitest 等价 L2、删除不清物理 JSONL）属产品语义/验证分层，不构成本视角契约断裂。
