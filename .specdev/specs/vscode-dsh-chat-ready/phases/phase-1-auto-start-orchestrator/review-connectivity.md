# Connectivity Review — phase-1-auto-start-orchestrator

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**SHOULD-FIX**

> **本轮焦点（Should-Fix #2 / #3 L2 补强）：** AC-13 mid-flight `connecting` 与 `deleteHistory` unbound / bound+offline 两条 L2 **均真连通到可观测面，非空壳**。产品接线未改；L2 读的是生产路径上的 `getConnectionPhase` / `showErrorMessage` / `host-not-ready` / `getConversationController`。残留 🟡 仅为既有 #1（活动栏生产信号）与 #4（Webview Continue 旁路），不回退 #2/#3。

## 端到端路径追踪

### Path 1: 触发 → Orchestrator → StartHostPort → IdeSessionHost → ConnectionUi
```
Entry: dsh.startSession | visibility | statusBarAction | ensureHostForSend(send/new/continue-cmd)
  → orchestrator.request(reason)                         ✅
    → StartHostPort.hasCredentials / start               ✅
      → IdeSessionHost.start({ cwd, credentials })       ✅ AD-CR-5
      → bindConversations + restoreOpenTabSet(/New)      ⚠️ DEBT-001
  → orchestrator.onChange → ConnectionUi → panel/statusBar ✅
```
**判定**: ✅ 主建连路径完整

### Path 2: AC-1a 反向
```
activate / dsh.test.simulateStartupOnly
  → 无 orchestrator.request / 无 IdeSessionHost.start
L2: spy IdeSessionHost.prototype.start → calls=0
  + startState=idle + hostCreateCount=0 + tabs/openTabSet=0  ✅ HG-2
```
**判定**: ✅ 反向路径连通；断言非空壳

### Path 3: 断线 → retry-once → ConnectionUi
```
Host transport death / status error
  → onUnexpectedDisconnect → disconnected → disconnect-retry(≤1)
  → ConnectionUi 投影；user Stop → idle（跳过意外断线） ✅
```
**判定**: ✅ 连通

### Path 4: 缺凭据失败 → panel + 状态栏 → showPanel / settings
```
setCredentialPresence(false) → request → failed/missing-credentials
  → panel connectionPhase=failed；不可见 → StatusBar.show
  → dsh.showPanel / dsh.openExtensionSettings / retry-connect ✅ L2
```
**判定**: ✅ AC-2/14 载体连通

### Path 5: AC-1b 活动栏 reveal + request
```
dsh.test.openActivityBar → reveal + request('activity-bar') ✅ L2
生产：Conversation onDidChangeVisibility → request ✅
生产：独立「点击活动栏图标」事件未全量挂钩                 ⚠️ 偏差 2 / SF#1
```
**判定**: ✅ L2/可见性连通；⚠️ 生产专用信号弱（非主路径断裂）

### Path 6: AC-13 connecting 投影缝（本轮 #2 焦点）
```
生产链（mid-flight）:
  dsh.test.requestStart('command-start')
    → AutoStartOrchestrator.runStart
         state='starting' → notify()                      ✅ 在 await port.start 之前
    → connectionUi.projectOrchestrator(snap)
         mapSnapshot: starting|pending-start → 'connecting' ✅
    → panelHost.applyConnectionState(state)
         this.connectionPhase = 'connecting'              ✅
         pushBanner(..., 'connecting')                    ✅ → outbound ui/banner
         pushFullState() → panel/state.connectionPhase    ✅ 同源字段
    → IdeSessionHost.start 挂起（gate）                   ✅ 保持 mid-flight

L2（phase1-auto-start.spec.ts「AC-13: Host starting projects…」）:
  → getChatPanelHost()?.getConnectionPhase()==='connecting' ✅ 读生产 Host 字段（非 mock 旁路）
  → getStartState ∈ {starting, pending-start}             ✅ FSM 同步
  → release → connectionPhase==='connected' + state=started ✅ settle 闭环

可观测面判定：
  getConnectionPhase ≡ applyConnectionState 写入的 connectionPhase
  ≡ pushFullState 序列化进 panel/state 的同源值
  → L2 断言落在设计允许的 connectionPhase 面，不是空壳钩子
```
**判定**: ✅ AC-13 L2 真连通到面板投影缝；#2 关闭

### Path 7: AC-1e deleteHistory 双分支（本轮 #3 焦点）
```
分支 A — unbound（无 Conversations）:
  dsh.deleteHistory(sessionId)
    → deleteHistorySession
         conversations === undefined
           → showErrorMessage('Host 连接后可删除')        ✅ 可观测面
           → return { outcome: 'host-not-ready' }         ✅
         无 orchestrator.request / 无 IdeSessionHost.start ✅
L2:
  getConversationController()===undefined                 ✅ 分支前置真断言
  result.outcome==='host-not-ready'                       ✅
  executed 含「Host 连接后可删除」                         ✅ fake showErrorMessage
  startSpy=0 + orch idle + tabs=[]                       ✅ 无 Start / 无假删

分支 B — bound + Host offline（controller 仍绑）:
  requestStart → start#1 connected → bindConversations    ✅
  host.status='disconnected'
    → onUnexpectedDisconnect → disconnect-retry
    → start#2 永久挂起（保持 Conversations 绑定）         ✅
  dsh.deleteHistory('sess-bound-offline')
    → deleteHistorySession
         controller 已定义 → deleteSession(sessionId)
           host.status !== 'connected'
             → { outcome: 'host-not-ready' }              ✅ 无 markDeleted
         → showErrorMessage('Host 连接后可删除')          ✅ 次级分支同文案
L2:
  getConversationController() defined（delete 前后）      ✅ 非 unbound 空壳复用
  outcome==='host-not-ready' + 提示文案                   ✅
  startSpy.calls 在 delete 前后不增                       ✅ 删除不触发完整建连
  orch ∈ {starting,pending-start,disconnected,failed}     ✅ 非 idle 假场景

dsh.deleteConversation / panel action/delete → runDeleteActive 同文案 ✅（既有）
```
**判定**: ✅ 两分支均接到提示 + outcome + 不 Start 的可观测面；#3 关闭

### Path 8: 查询类不建连 + test 钩子门闩
```
dsh.openHistory offline → 无 Start ✅ L2
dsh.test.* 仅 VSCODE_DSH_TEST | 注入 vscode 注册 ✅ AD-CR-10
agent-loop 未改 ✅ AC-26
```
**判定**: ✅

### Path 9: Webview Continue（发送类旁路）
```
Command: dsh.continueConversation → ensureHostForSend → request('command-send') ✅
Webview: action/continue → requestContinue
  → conversations === undefined → return（静默）
  → ❌ 不经 ensureHostForSend / orchestrator.request      🟡 SF#4（本轮未改）
```
**判定**: 🟡 SHOULD-FIX — 命令路径连通，Webview Continue 离线静默 no-op

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `AutoStartOrchestrator.request` | startSession / visibility / statusBar / ensureHostForSend / retry | ✅ | `StartHostPort.start` | ✅ |
| `orchestrator.onChange` | FSM notify | ✅ | `ConnectionUi.projectOrchestrator` | ✅ |
| `ConnectionUi.mapSnapshot(starting)` | projectOrchestrator | ✅ | `phase='connecting'` → panel | ✅ |
| `ChatPanelHost.applyConnectionState` | ConnectionUi port | ✅ | `connectionPhase` + banner + panel/state | ✅ |
| `getConnectionPhase()` L2 | vitest AC-13 | ✅ | 读生产 Host 字段 | ✅ |
| `deleteHistorySession` unbound | `dsh.deleteHistory` | ✅ | `showErrorMessage` + `host-not-ready` | ✅ |
| `deleteHistorySession` bound+offline | `dsh.deleteHistory` | ✅ | `deleteSession`→`host-not-ready`→提示 | ✅ |
| L2 deleteHistory unbound | vitest | ✅ | controller=undef + 文案 + start=0 | ✅ |
| L2 deleteHistory bound+offline | vitest | ✅ | controller 在 + start 不增 + 文案 | ✅ |
| `requestContinue` (panel) | Webview Continue | ✅ | controller only | 🟡 缺 auto-start |
| `AutoReadyLatchSeam` | visibility / hostReady | ✅ | stub（STUB-001） | ⚠️ 已知桩 |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| AC-13 / design → starting | ConnectionUiPhase `connecting`；面板可观测 | `starting\|pending-start`→`connecting`→`getConnectionPhase`/`panel/state` | ✅ |
| AC-13 L2 | mid-flight connecting → settle connected | gate 挂起断言 connecting；release 后 connected+started | ✅ |
| AC-1e unbound deleteHistory | 提示「Host 连接后可删除」；不 Start；不假删 | `showErrorMessage` + `host-not-ready`；start=0；tabs=[] | ✅ |
| AC-1e bound+offline deleteHistory | 同提示；controller 仍在；不因删除再 Start | deleteSession→host-not-ready；controller defined；start 不增 | ✅ |
| README 删除类 → Orchestrator | 不触发完整建连 | deleteHistory 路径无 `orchestrator.request` | ✅ |
| README Send 矩阵 → Webview continue | Auto Start (`command-send`) | 不 request | 🟡 |
| package.json ↔ test hooks | 生产无 dsh.test.* | contributes 已移除；运行时门闩 | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| Conversation panel / Host / delete AC-73 | vscode-dsh-conversation-ui | 已在 master | ✅ |
| AutoReady restore/New 解耦 | phase-2 | STUB-001 + DEBT-001 | ⚠️ 已知非阻塞债 |
| agent-loop | — | 未修改 | ✅ |
| 冻结接口变更 | — | 无 | ✅ |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
- **Webview `action/continue` 不走 `ensureHostForSend`（SF#4，本轮未改）：** 命令 `dsh.continueConversation` 会 `request('command-send')`，面板 Continue 在 `conversations === undefined` 时直接 return，与 Auto-start 命令矩阵不对称。
- **生产活动栏打开信号弱（偏差 2 / SF#1，本轮未改）：** L2 `openActivityBar` 与 Conversation 可见性已连通；真实点击活动栏图标无独立产品钩子时，主要依赖 view visibility / 状态栏。

### 🟢 Observations
- **SF#2 关闭证据：** AC-13 L2 在 `IdeSessionHost.start` 挂起窗口内断言 `getChatPanelHost().getConnectionPhase()==='connecting'`，并与 orchestrator `starting|pending-start` 对齐；settle 后 `connected`+`started`。该钩子读取的是 `applyConnectionState` 写入、并进入 `panel/state.connectionPhase` / `ui/banner` 的同源状态 — **非空壳**。
- **SF#3 关闭证据：** `deleteHistory` 拆成两条独立 L2：(A) `getConversationController()===undefined` 前置；(B) 首启后断线 + retry 挂起以保持 controller 绑定，再删。两条均断言「Host 连接后可删除」+ `host-not-ready` + 删除不增加 `start` 调用 — **非把 unbound 用例冒充 bound**。
- 聚焦用例 vitest 证据：`phase1-auto-start.spec.ts -t "AC-13|deleteHistory"` → **3 passed**。
- STUB-001 / DEBT-001 与 registry 一致；不断裂本 Phase Start→UI 投影链。
