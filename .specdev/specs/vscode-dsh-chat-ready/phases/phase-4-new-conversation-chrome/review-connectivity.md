# Connectivity Review — phase-4-new-conversation-chrome

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### Path 1: Webview「新建会话」→ ensureHost → New/reuse → reveal（AC-15/22/23/24）
```
Entry: #newConversationBtn / #newConversationOverflowBtn click
  → postMessage { type: 'action/new-conversation' }          ✅ provider postNewConversation
  → ChatPanelHost.onWebviewMessage
       → deps.requestNewConversation()                       ✅ createPanelHost wires
            → runNewConversationFromPanel(vscode)
                 → runNewConversationShared({ announce:false })
                      → ensureHostForSend
                           → if host.connected: return
                           → else orchestrator.request('command-send')  ✅ phase-1
                                → AutoStartOrchestrator → StartHostPort
                                → onChange → connectionUi.projectOrchestrator
                                     → applyConnectionState → panel/state + ui/banner
                      → requireConversations() / newConversationOrReuseEmpty  ✅ AD-CR-6
                      → panelHost.pushFullState()              ✅ mode live when connected
                      → revealConversationPanel(vscode,false)  ✅ conversationView.show / focus
Exit: focused Conversation panel; panel/state.mode=live (non-connecting)
```
**判定**: ✅ 数据路径完整；命令路径 `dsh.newConversation` → `runNewConversationFromCommand` 共用同一 `runNewConversationShared`（announce 仅差异）

### Path 2: 未连等待 Start — connecting → waiting-host 非可发送 live（AC-22）
```
Entry: action/new-conversation while Host disconnected
  → ensureHostForSend → orchestrator.request('command-send')
  → ConnectionUiController.mapSnapshot(starting/pending-start)
       → phase=connecting, message='正在连接到 Host…'         ✅ connection-ui.ts
  → ChatPanelHost.applyConnectionState
       → pushBanner(…, 'connecting')
       → pushFullState:
            active Tab? mode = waiting-host (NOT live)       ✅ AC-22 / R1
            connectionPhase=connecting + connectionMessage
  → Webview syncComposer:
       live = (mode==='live' && connectionPhase!=='connecting') → disabled  ✅
  → Host sendPrompt backstop: !isHostReady → ui/reject-send 'no-host'       ✅
  → Start success → phase connected → pushFullState mode=live + New/reuse + reveal
Exit: waiting period never projects sendable live; success → live
```
**判定**: ✅ Host 投影与 Webview composer 双闸门 + send 门禁连通；失败路径 missing-credentials → failed（无 conversations / 无 live Tab）连通 AC-2

### Path 3: Continue → ensureHost（DEBT-003）
```
Entry: #continueBtn → postMessage { type: 'action/continue' }
  → ChatPanelHost → deps.requestContinue
       → await ensureHostForSend(vscode)                     ✅ DEBT-003 fixed
       → conversations?.continueConversation()
       → panelHost?.pushFullState()
Contrast: dsh.continueConversation also ensureHostForSend first  ✅ 对称
```
**判定**: ✅ Webview Continue 与命令路径在 auto-start 缝上对齐；connected 时 ensureHost 短路不重复 Start

### Path 4: AC-6 复用（按钮/协议路径）
```
Entry: action/new-conversation (Host already connected)
  → runNewConversationShared → newConversationOrReuseEmpty(EMPTY_LIVE_TITLE)
       → active empty? reuse active (no Tab+1)               ✅ controller
       → else newConversation (never findEmptyLive steal)    ✅ AD-CR-6
  → pushFullState + reveal
Exit: (a) Tab count stable on active empty; (b) content+leftover empty → new Tab, not leftover
```
**判定**: ✅ 按钮路径消费既有冻结 API；L2 经 `action/new-conversation` 断言 Tab/activeTabId

### Path 5: chrome 协议 H→W（呈现）
```
pushFullState → panel/state.chrome.newConversation.visibility='enabled'  ✅ always
  → Webview syncNewConversationChrome → btn/overflow enabled             ✅
  → #chromeOverflow 首项 = 新建会话（展开+首项可达）                      ✅
```
**判定**: ✅ chrome 字段生产者→消费者连通；W→H 解析 `parseWebviewToHostMessage` 含 `action/new-conversation`

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `postNewConversation` (Webview) | `#newConversationBtn` / overflow click | ✅ | `action/new-conversation` postMessage | ✅ |
| `ChatPanelHost` `action/new-conversation` | Webview / L2 `handleWebviewMessage` | ✅ | `deps.requestNewConversation` | ✅ |
| `requestNewConversation` (extension) | ChatPanelHost | ✅ | `runNewConversationFromPanel` | ✅ |
| `runNewConversationShared` | Command + Panel wrappers | ✅ | `ensureHostForSend` → `newConversationOrReuseEmpty` → `revealConversationPanel` | ✅ |
| `ensureHostForSend` | New / Continue / prompt | ✅ | `orchestrator.request('command-send')` | ✅ |
| `applyConnectionState` / `pushFullState` connecting | ConnectionUiController | ✅ | panel/state `waiting-host` + banner + Webview syncComposer | ✅ |
| `requestContinue` (DEBT-003) | `action/continue` | ✅ | `ensureHostForSend` → `continueConversation` → `pushFullState` | ✅ |
| `newConversationOrReuseEmpty` | Shared New + AutoReady (unchanged) | ✅ | registry / `newConversation` | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Webview → Host | `{ type: 'action/new-conversation' }` | `parseWebviewToHostMessage` + handler | ✅ |
| Host → `requestNewConversation` | `() => Promise<void>` | `runNewConversationFromPanel` | ✅ |
| Shared New → Controller | `newConversationOrReuseEmpty(title?)` | 同签名，仅活动空 Tab 复用 | ✅ |
| Shared New → Reveal | focus Conversation after New | `revealConversationPanel(vscode, false)` | ✅ |
| Orchestrator → ConnectionUi → Host | connecting message / phase | `'正在连接到 Host…'` + `connectionPhase` | ✅ |
| Host → Webview composer | connecting ≠ sendable live | `mode=waiting-host` + `syncComposer` gate | ✅ |
| Continue Webview vs Command | 未连先 Start | 两者均 `ensureHostForSend` | ✅ |
| H→W chrome | `chrome.newConversation.visibility` | Host 恒 `enabled`；Webview 消费 | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `ensureHostForSend` / `AutoStartOrchestrator.request('command-send')` | phase-1 | 已实现，未改签名 | ✅ |
| `ConnectionUiController` → `applyConnectionState` | phase-1 | 文案改为中文；缝未断 | ✅ |
| `newConversationOrReuseEmpty` (AD-CR-6) | phase-2 | 冻结，本 Phase 只调用 | ✅ |
| Chat panel Host/Webview chassis + Continue chrome | phase-3 | 扩展 chrome/New；Continue 入口保留 | ✅ |
| DEBT-003 `requestContinue` | phase-1 登记 / phase-4 关闭 | 现对齐 ensureHost | ✅ |

## 关键发现
### 🔴 Must-Fix
- （无）

### 🟡 Should-Fix
- （无）

### 🟢 Observations
- Command New 与 Webview New 经 `runNewConversationShared` 汇合；panel 路径 `announce:false` 避免 toast 噪声，不影响数据路径。
- connecting 期间保留 sessionId/tabId 但 `mode=waiting-host`（implementation 偏差 2）仍满足「非可发送 live」且 Webview/Host 闸门均接线。
- AC-34 keybindings 未实现（Should）；`dsh.newConversation` 命令面板仍走共享路径，不构成连通断裂。
- Host 单元测用 stub `requestNewConversation` 只验 Host→dep 路由；生产接线由 extension `createPanelHost` 覆盖，L2 全路径测覆盖 ensureHost/reuse/reveal。
