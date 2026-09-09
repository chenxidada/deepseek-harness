# 连通性审查 — phase-4-new-conversation-chrome

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### 路径 1：Webview「新建会话」→ ensureHost → New/reuse → reveal（AC-15/22/23/24）
```
入口: #newConversationBtn / #newConversationOverflowBtn 点击
  → postMessage { type: 'action/new-conversation' }          ✅ provider postNewConversation
  → ChatPanelHost.onWebviewMessage
       → deps.requestNewConversation()                       ✅ createPanelHost 接线
            → runNewConversationFromPanel(vscode)
                 → runNewConversationShared({ announce:false })
                      → ensureHostForSend
                           → 已连: 直接返回
                           → 未连: orchestrator.request('command-send')  ✅ phase-1
                                → AutoStartOrchestrator → StartHostPort
                                → onChange → connectionUi.projectOrchestrator
                                     → applyConnectionState → panel/state + ui/banner
                      → requireConversations() / newConversationOrReuseEmpty  ✅ AD-CR-6
                      → panelHost.pushFullState()              ✅ 已连时 mode=live
                      → revealConversationPanel(vscode,false)  ✅ show / focus
出口: Conversation 面板聚焦；panel/state.mode=live（非 connecting）
```
**判定**: ✅ 数据路径完整；命令 `dsh.newConversation` 与 Webview 共用 `runNewConversationShared`（仅 announce 差异）

### 路径 2：未连等待 Start — connecting → waiting-host 非可发送 live（AC-22）
```
入口: Host 未连时 action/new-conversation
  → ensureHostForSend → orchestrator.request('command-send')
  → ConnectionUiController.mapSnapshot(starting/pending-start)
       → phase=connecting，文案「正在连接到 Host…」           ✅ connection-ui.ts
  → ChatPanelHost.applyConnectionState
       → pushBanner(…, 'connecting')
       → pushFullState：有活动 Tab 时 mode=waiting-host（非 live） ✅ AC-22 / R1
  → Webview syncComposer：mode==='live' && phase≠connecting 才启用 ✅
  → Host sendPrompt 兜底：!isHostReady → ui/reject-send 'no-host' ✅
  → Start 成功 → connected → live + New/reuse + reveal
出口: 等待期不投影可发送 live；成功后 live；凭证缺失走 AC-2 failed
```
**判定**: ✅ Host 投影 + Webview composer 双闸门 + send 门禁连通

### 路径 3：Continue → ensureHost（DEBT-003）
```
入口: #continueBtn → action/continue
  → requestContinue → ensureHostForSend → continueConversation → pushFullState  ✅
对照: dsh.continueConversation 同样先 ensureHostForSend                              ✅
```
**判定**: ✅ Webview Continue 与命令路径在 auto-start 缝对齐

### 路径 4：AC-6 复用（按钮/协议路径）
```
入口: 已连时 action/new-conversation
  → newConversationOrReuseEmpty：活动空 Tab 复用；否则新建（不全局偷空 Tab） ✅
出口: (a) 活动空 → Tab 数不变；(b) 活动有内容 → 新建，不切遗留空 Tab
```
**判定**: ✅ 按钮路径消费既有冻结 API；L2 经协议断言

### 路径 5：chrome 协议 H→W
```
pushFullState → chrome.newConversation.visibility='enabled' → Webview 同步按钮/溢出首项 ✅
```
**判定**: ✅ 生产者→消费者连通；`parseWebviewToHostMessage` 识别 `action/new-conversation`

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `postNewConversation` | 顶栏/溢出按钮 click | ✅ | `action/new-conversation` | ✅ |
| Host `action/new-conversation` | Webview / L2 | ✅ | `requestNewConversation` | ✅ |
| `requestNewConversation` | ChatPanelHost | ✅ | `runNewConversationFromPanel` | ✅ |
| `runNewConversationShared` | 命令 + Panel | ✅ | ensureHost → reuse/New → reveal | ✅ |
| `ensureHostForSend` | New / Continue / prompt | ✅ | `orchestrator.request('command-send')` | ✅ |
| connecting 投影 | ConnectionUi | ✅ | waiting-host + banner + composer 禁用 | ✅ |
| `requestContinue`（DEBT-003） | `action/continue` | ✅ | ensureHost → continue → pushFullState | ✅ |
| `newConversationOrReuseEmpty` | Shared New + AutoReady | ✅ | registry / `newConversation` | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Webview → Host | `action/new-conversation` | parse + handler | ✅ |
| Host → extension | `requestNewConversation(): Promise<void>` | `runNewConversationFromPanel` | ✅ |
| Shared New → Controller | `newConversationOrReuseEmpty(title?)` | 仅活动空 Tab 复用 | ✅ |
| Shared New → Reveal | New 后聚焦面板 | `revealConversationPanel(..., false)` | ✅ |
| Orchestrator → UI → Host | connecting 文案/相位 | 「正在连接到 Host…」+ connectionPhase | ✅ |
| Host → composer | connecting ≠ 可发送 live | waiting-host + syncComposer | ✅ |
| Continue Webview vs 命令 | 未连先 Start | 均 ensureHostForSend | ✅ |
| H→W chrome | `chrome.newConversation` | Host 恒 enabled；Webview 消费 | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `ensureHostForSend` / Orchestrator `command-send` | phase-1 | 已实现，签名未改 | ✅ |
| ConnectionUi → applyConnectionState | phase-1 | 文案中文化；缝未断 | ✅ |
| `newConversationOrReuseEmpty`（AD-CR-6） | phase-2 | 冻结，只调用 | ✅ |
| Chat panel 底盘 + Continue chrome | phase-3 | 扩展 New；Continue 保留 | ✅ |
| DEBT-003 `requestContinue` | phase-1 登记 / phase-4 关闭 | 已对齐 ensureHost | ✅ |

## 关键发现
### 🔴 Must-Fix
- （无）

### 🟡 Should-Fix
- （无）

### 🟢 Observations
- 命令与 Webview New 汇合于 `runNewConversationShared`；panel 静默（无 toast）。
- connecting 保留 session 字段但 mode=waiting-host，双闸门仍防可发送 live。
- AC-34 keybindings 未做（Should）；命令面板路径仍连通。
- Host 单测 stub 仅验路由；生产接线与 L2 全路径覆盖 ensureHost/reuse/reveal。
