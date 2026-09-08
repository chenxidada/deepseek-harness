# Connectivity Review — phase-1-auto-start-orchestrator

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**MUST-FIX**

## 端到端路径追踪

### Path 1: 触发 → Orchestrator → StartHostPort → IdeSessionHost → ConnectionUi
```
Entry: dsh.startSession | visibility | statusBarAction | ensureHostForSend(send/new/continue)
  → orchestrator.request(reason)                         ✅ extension.ts 接线
    → StartHostPort.hasCredentials / start               ✅ createStartHostPort
      → new IdeSessionHost() + hostCreateCount++         ✅
      → IdeSessionHost.start({ cwd, credentials })       ✅ AD-CR-5 cwd 降级
      → bindConversations + restoreOpenTabSet(/New)      ⚠️ DEBT-001 暂留绑 Start
  → orchestrator.onChange(snap)
    → connectionUi.projectOrchestrator(snap)             ✅
      → panelHost.applyConnectionState                   ✅ connectionPhase / banner
      → StatusBarItem show/hide (panel 不可见时)         ✅ command=dsh.statusBarAction
Exit: Host connected 或 failed 投影到 panel/状态栏
```
**判定**: ✅ 主建连路径完整；restore/New 绑 Start 为登记债（DEBT-001），不断裂 Start 链路

### Path 2: AC-1a 反向（仅 activate / simulateStartupOnly）
```
Entry: activate(...) — 无 visibility / 无 command / 无 status-bar
  → 注册 views / commands / orchestrator / ConnectionUi   ✅
  → 不调用 orchestrator.request                           ✅
  → 不构造 IdeSessionHost                                 ✅ hostCreateCount=0
L2: vi.spyOn(IdeSessionHost.prototype, 'start')
  → dsh.test.simulateStartupOnly
  → start 调用次数=0 + startState=idle + tabs/openTabSet=0 ✅ HG-2 四断言齐全（非仅 idle）
```
**判定**: ✅ L2 反向路径真实连通，且 spy 的是 `IdeSessionHost.start`（非空断言）

### Path 3: 断线 → onUnexpectedDisconnect → retry-once → ConnectionUi
```
IdeSessionHost.onTransportDeath
  → this.status = 'error'（setter 通知 statusListeners） ✅
  → createStartHostPort stopStatusWatch
       if !userStopping && state==='started'
         → orchestrator.onUnexpectedDisconnect()         ✅
           → state=disconnected + notify → ConnectionUi  ✅
           → autoRetryUsed → request('disconnect-retry') ✅ 至多一次
  L2: dsh.test.injectDisconnect → 同 FSM 入口            ✅
  User Stop: userStopping + onUserStop → 跳过意外断线    ✅
```
**判定**: ✅ 产品断线与测试注入均接到 Orchestrator；UI 经 onChange 投影

### Path 4: 失败 / 缺凭据 → panel + 状态栏 → showPanel / settings / retry
```
hasCredentials=false → orchestrator failed (missing-credentials)
  → ConnectionUi phase=failed
  → panel applyConnectionState → getConnectionPhase='failed' ✅ L2
  → Conversation 不可见 → StatusBar.show                  ✅ L2
  → dsh.showPanel → revealConversationPanel               ✅ 不强制 Start
  → dsh.openExtensionSettings → openSettings 深链         ✅
  → Webview action/retry-connect → requestRetryConnect
       → orchestrator.request('manual-retry')             ✅
  → action/open-settings → requestOpenSettings            ✅
```
**判定**: ✅ AC-2 / AC-14 反向与正向载体连通

### Path 5: AC-1b 活动栏 reveal + request
```
dsh.test.openActivityBar
  → onActivityBarOpened
       → revealConversationPanel (show / focus)           ✅ L2 resolvedShow
       → orchestrator.request('activity-bar')             ✅ startSpy ≥1
生产：Conversation onDidChangeVisibility → request(
       'conversation-view-visible')                       ✅
生产：独立「点击活动栏图标」事件未全量挂钩                 ⚠️ 偏差 2
```
**判定**: ✅ L2/可见性路径连通；⚠️ 生产活动栏专用信号弱（已知偏差，非主路径断裂）

### Path 6: 离线删除（AC-1e）
```
dsh.deleteConversation / panel action/delete
  → runDeleteActive
       requireConversations() undefined
       → showErrorMessage('Host 连接后可删除')            ✅
       → 不调 orchestrator.request / 不 Start             ✅ L2 spy=0
       → 不假删权威                                       ✅

dsh.deleteHistory / dsh.test.deleteHistory
  → deleteHistorySession
       controller undefined 或 sessionId 非 string
       → return { outcome: 'host-not-ready' }             ✅ 不 Start / 不假删
       → ❌ 无 showErrorMessage / 无 when-禁用            🔴
       README 声称 offline shows「Host 连接后可删除」     🔴 契约与接线不一致
```
**判定**: 🔴 MUST-FIX — `deleteConversation` 完整；`deleteHistory` 权威保护连通但**用户提示下游断裂**（静默返回，违反 AC-1e「禁用或提示 / 不静默失败」）

### Path 7: 查询类不建连 + test 钩子门闩
```
dsh.openHistory offline → ErrorMessage / host-not-ready；无 request ✅ L2
package.json contributes：无 dsh.test.*                    ✅ AD-CR-10
shouldRegisterTestHooks(VSCODE_DSH_TEST | injected vscode) ✅
activate 仅注册；agent-loop 未改                           ✅ AC-26
```
**判定**: ✅ 边界与门闩连通

### Path 8: Webview Continue（发送类旁路）
```
Command: dsh.continueConversation → ensureHostForSend
  → request('command-send')                               ✅
Webview: action/continue → requestContinue
  → conversations?.continueConversation() only
  → ❌ 不经 ensureHostForSend / orchestrator.request      🟡
```
**判定**: 🟡 SHOULD-FIX — 命令路径连通，Webview Continue 离线时静默 no-op，与 README「Send/New 含 continue → Auto Start」矩阵不对称

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `AutoStartOrchestrator.request` | startSession / visibility / statusBar / ensureHostForSend / retry | ✅ | `StartHostPort.start` | ✅ |
| `createStartHostPort.start` | Orchestrator | ✅ | `IdeSessionHost.start` + bind/restore | ✅ |
| `orchestrator.onChange` | FSM notify | ✅ | `ConnectionUi.projectOrchestrator` | ✅ |
| `ConnectionUiController.apply` | project / setVisible | ✅ | panel + StatusBarItem | ✅ |
| `onUnexpectedDisconnect` | Host `onStatusChange` / test inject | ✅ | FSM + `disconnect-retry` | ✅ |
| `runDeleteActive` offline | deleteConversation / panel delete | ✅ | showErrorMessage | ✅ |
| `deleteHistorySession` offline | deleteHistory 命令 | ✅ | 仅 return outcome | 🔴 无 UI 提示 |
| `requestRetryConnect` | Webview retry 按钮 | ✅ | `request('manual-retry')` | ✅ |
| `requestContinue` (panel) | Webview Continue | ✅ | controller only | 🟡 缺 auto-start |
| `AutoReadyLatchSeam` | visibility / hostReady | ✅ | stub only（STUB-001） | ⚠️ 已知桩 |
| `dsh.test.simulateStartupOnly` | L2 | ✅ | spy `IdeSessionHost.start`=0 | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| extension → Orchestrator | `request(StartReason)` | 六态 FSM + StartHostPort | ✅ |
| Orchestrator → StartHostPort | `hasCredentials` / `start` / `isConnected` | createStartHostPort 实现 | ✅ |
| Orchestrator → ConnectionUi | snapshot → phase | mapSnapshot 覆盖六态 | ✅ |
| ConnectionUi → ChatPanelHost | `applyConnectionState` | connectionPhase + banner + panel/state | ✅ |
| StatusBar → commands | `dsh.statusBarAction` | reveal + `request('status-bar')` | ✅ |
| README / AC-1e → deleteHistory | 离线提示「Host 连接后可删除」 | 仅 `{ outcome:'host-not-ready' }` | 🔴 |
| README Send 矩阵 → Webview continue | Auto Start (`command-send`) | 不 request | 🟡 |
| package.json ↔ test hooks | 生产无 dsh.test.* | contributes 已移除；运行时门闩 | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| Conversation panel / Host / delete AC-73 | vscode-dsh-conversation-ui | 已在 master | ✅ |
| AutoReady restore/New 解耦 | phase-2 | STUB-001 + DEBT-001 | ⚠️ 已知非阻塞债 |
| agent-loop | — | 未修改 | ✅ |

## 关键发现

### 🔴 Must-Fix
- **`dsh.deleteHistory` 离线用户提示未接线**：`deleteHistorySession` 在 Host/controller 不可用时只 `return { outcome: 'host-not-ready' }`，既不 `showErrorMessage('Host 连接后可删除')`，也无 `when` 禁用。权威不假删、不 Start 已满足，但 AC-1e / README 矩阵要求的「禁用或提示 / 不静默失败」下游断裂。应对齐 `runDeleteActive` 的提示路径（或禁用入口并在命令路径补同等提示）。

### 🟡 Should-Fix
- **Webview `action/continue` 不走 `ensureHostForSend`**：命令 `dsh.continueConversation` 会 `request('command-send')`，面板 Continue 在 `conversations === undefined` 时直接 return，与 Auto-start 命令矩阵不对称。
- **生产活动栏打开信号弱（偏差 2）**：L2 `openActivityBar` 与 Conversation 可见性已连通；真实点击活动栏图标无独立产品钩子时，主要依赖 view visibility / 状态栏（已记录，非主路径断裂）。

### 🟢 Observations
- L2 AC-1a **真实 spy** `IdeSessionHost.prototype.start`，并同时断言 idle / hostCreateCount / tabs / openTabSet — 符合 HG-2，不是「仅 idle」。
- `dsh.test.*` 已从 `package.json` contributes 移除，仅 `VSCODE_DSH_TEST` 或注入 vscode 时注册 — AD-CR-10 门闩连通。
- STUB-001 / DEBT-001 与 registry 一致；latch 不 New、Start 仍 restore/New 属 phase-2 债，不断裂本 Phase Start→UI 投影链。
- 断线：`IdeSessionHost.status` setter 会通知 listeners，故 transport death → Orchestrator 路径真实接通（非仅 test inject）。
