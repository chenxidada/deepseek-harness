# Connectivity Review — phase-1-panel-live-recoverable-close

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

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
**判定**: ✅ 数据路径完整；门禁与既有 prompt 缝连通

### Path 2: 关最后 Tab → empty → messages/replace([])（本轮 MUST-FIX 复审焦点）
```
Entry: dsh.closeConversation | dsh.test.closeConversation（唯一有内容 Tab）
  → ConversationController.closeConversation(tabId)
       ├─ failClosedSession(sessionId) ✅（卸 UI 前中止该 Tab 等待）
       ├─ 不调用 host.disposeSession ✅
       ├─ registry.close(tabId) → getActive() === undefined ✅
       ├─ persistOpenTabs → ExtensionIndex（空 Tab 过滤 / 立即写）✅
       └─ panelHost.pushFullState()
            ├─ panel/state { mode: 'empty' | 'waiting-host' } ✅
            ├─ messages/replace { sessionId: '', messages: [] } ✅  ← 上次断链已接通
            └─ status/set { idle | disconnected } ✅
  → 薄 Webview（chat-panel-provider HTML）
       ├─ panel/state empty|waiting-host → renderMessages([]) ✅ 兜底
       └─ messages/replace sessionId==='' → 始终接受并 renderMessages([]) ✅
  → L3 FakeWebviewPort
       └─ hasReplaceEmpty === true（closes last content Tab… 用例）✅
Exit: 已 attach 面板无残留气泡；权威 MessageStore 仍保留关 Tab 投影（供 phase-2）
```
**判定**: ✅ AC-2 / AC-24 空态清空路径完整（Host 协议帧 + 薄客户端 DOM + L3 断言）

### Path 3: 关 Tab 可恢复（仍有邻 Tab）
```
Entry: closeConversation（多 Tab 关活动）
  → registry.close → 邻 Tab 升 active
  → pushFullState → panel/state(live) + messages/replace(新 session 全量) + status/set ✅
Exit: 面板切到新活动；无 dispose
```
**判定**: ✅ 连通

### Path 4: 显式删除 dispose
```
Entry: dsh.deleteConversation | 菜单 | dsh.test.deleteConversation | W→H action/delete
  → deleteConversation
       ├─ host.status !== connected → host-not-ready（不假删索引）✅
       ├─ confirmed !== true → needs-confirm（确认前不 dispose）✅
       ├─ failClosedSession → host.disposeSession(bridge session/dispose) ✅
       ├─ messages.clearSession + timeline.clearSession ✅
       ├─ index.markDeleted（不级联子 session）✅
       ├─ registry.close + persistOpenTabs + pushFullState ✅
       └─ 若删至空态：同上 Path 2 的 replace([]) ✅
Exit: live Tab 关闭；投影清除；索引 tombstone；dispose 仅删除路径
```
**判定**: ✅ 删除状态机端到端连通（AC-26/60/72/73/61）

### Path 5: 切 Tab（不串台）
```
Entry: dsh.switchConversation / registry.switchTo
  → registry.onChange → persistOpenTabs + panelHost.pushFullState
       → panel/state{sessionId,mode}
       → messages/replace{sessionId, messages: MessageStore.get(sessionId)} ✅
       → status/set（仅活动 Tab；listPending 过滤 sessionId）✅
  pushAppend 非活动 sessionId 直接 return ✅
Exit: 活动会话消息全量替换；发送目标随 registry.getActive
```
**判定**: ✅ AC-18/21 路径连通

### Path 6: L2 Host 测试钩子 + L3 FakeWebview
```
activate → createPanelHost（eager）✅
  → dsh.test.sendPrompt / closeConversation / deleteConversation / panelSnapshot / openPanel ✅
FakeWebviewPort → panel.attach → 真实 Host 协议处理 ✅
空态清空 L3 回归：closes last content Tab with messages/replace([]) ✅
```
**判定**: ✅ L2/L3 可脚本驱动；空态清空有独立回归探针

### Path 7: waiting-interaction / Timeline 弱化
```
InteractionCoordinator.onChange → panelHost.pushStatus → status/set waiting-interaction ✅
TimelineStore.assistant/message → description 短 label；面板走 MessageStore ✅
```
**判定**: ✅ 连通

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `ChatPanelHost.sendPrompt` | Webview / `dsh.test.sendPrompt` | ✅ | `acceptSend`→`promptActive` | ✅ |
| `ChatPanelHost.pushAppend` | `projectUser/AssistantMessage` | ✅ | `port.postMessage` / outbound | ✅ |
| `ChatPanelHost.pushFullState`（有活动 Tab） | registry/close/delete/switch/attach | ✅ | panel/state+replace+status | ✅ |
| `ChatPanelHost.pushFullState`（空态） | close last / unbind / stop | ✅ | state + **replace([])** + status | ✅ |
| Webview `panel/state` empty 分支 | Host post | ✅ | `renderMessages([])` | ✅ |
| Webview `messages/replace` `sessionId:''` | Host 清空帧 | ✅ | `renderMessages([])`（不因旧 sessionId 拒收） | ✅ |
| `ConversationController.closeConversation` | close 命令 / L2 钩子 | ✅ | failClosed；**不** dispose；index；panel | ✅ |
| `ConversationController.deleteConversation` | delete 命令 / L2 / action/delete | ✅ | `disposeSession`+clear+tombstone | ✅ |
| `ExtensionIndex.writeImmediate` | setOpenTabs / upsert / markDeleted | ✅ | `workspaceState.update` | ✅ |
| `MessageStore.append/get` | controller 投影 / panel replace | ✅ | panel Host 消费 | ✅ |
| `FakeWebviewPort` | L3 测试 | ✅ | `ChatPanelHost.attach` | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| ChatPanelHost → acceptSend | `(text)=> {messageId,sessionId,tabId}` | `promptActive` 返回同结构 | ✅ |
| Webview → Host | `composer/send {text}` | `parseWebviewToHostMessage` + `sendPrompt` | ✅ |
| Host → Webview | `messages/append` 完整回合 | controller 仅完整 user/assistant append | ✅ |
| Host → Webview 空态 | 消息列表空（AC-2） | `messages/replace({sessionId:'',messages:[]})` + HTML empty 清 DOM | ✅ |
| Webview replace 过滤 | 清空帧不被旧 live sessionId 拒收 | `sessionId===''` 短路接受 | ✅ |
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
| MessageStore 关 Tab 后保留投影 | 为 phase-2 历史再开预留 | 有意保留；面板清空与投影保留解耦 | ✅ |
| DEBT-001 / GAP-001 | → phase-2/3 | 非本 Phase 阻塞 | ✅ |

## 关键发现
### 🔴 Must-Fix
- （无）上次 🔴「空态消息清空断链」已在 Host `pushFullState` 空态分支 + 薄 Webview 双端接通，并由 L3 `hasReplaceEmpty` 回归锁定。

### 🟡 Should-Fix
- （无）本视角未见可优化但仍连通的缺口。

### 🟢 Observations
- 空态清空约定：`sessionId: ''` + `messages: []`；客户端对 `''` 跳过「异 session 拒收」逻辑，避免关最后 Tab 时仍持旧 live sessionId 而拒收清空帧。
- `panel/state` empty 时同步 `renderMessages([])` 与 Host replace 双保险；任一端单独即可清 DOM，两端同时存在降低回退风险。
- 关 Tab 后 MessageStore/Timeline 内存投影保留、删除才 `clearSession` — 符合 AD-CU-3，面板清空 ≠ 权威抹盘，非数据黑洞。
- 发送 / 关≠删 / 删=dispose / 切 Tab replace / L2 `dsh.test.*` / L3 FakeWebview 主路径仍全部接线；未见 `@STUB` 断链。
