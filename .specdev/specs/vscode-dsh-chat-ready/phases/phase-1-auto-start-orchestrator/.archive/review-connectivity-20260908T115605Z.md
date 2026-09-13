# Connectivity Review — phase-1-auto-start-orchestrator

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**SHOULD-FIX**

> **Must-Fix 回路复审结论：** 上一轮 🔴 `dsh.deleteHistory` 离线提示未接线 **已关闭**。AC-1e 下游提示现已连通；L2 对提示文案 + `IdeSessionHost.start`=0 有真实断言。残留项仅为既有 🟡（Webview Continue 旁路、活动栏生产信号弱），不阻断 AC-1e。

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
生产：独立「点击活动栏图标」事件未全量挂钩                 ⚠️ 偏差 2
```
**判定**: ✅ L2/可见性连通；⚠️ 生产专用信号弱（非主路径断裂）

### Path 6: 离线删除（AC-1e）— Must-Fix 复审焦点
```
dsh.deleteConversation / panel action/delete
  → runDeleteActive
       controller undefined | host-not-ready
       → showErrorMessage('Host 连接后可删除')            ✅
       → 不调 orchestrator.request / 不 Start             ✅ L2 spy=0
       → 不假删权威                                       ✅

dsh.deleteHistory / dsh.test.deleteHistory  （← 上轮 MUST-FIX）
  → deleteHistorySession
       conversations === undefined
         → showErrorMessage('Host 连接后可删除')          ✅ 已接线
         → return { outcome: 'host-not-ready' }           ✅
       deleteSession → host-not-ready
         → showErrorMessage('Host 连接后可删除')          ✅ 次级分支亦接线
         → return result（不假删）                        ✅
       全程无 orchestrator.request / IdeSessionHost.start ✅
L2（phase1-auto-start.spec.ts「AC-1e: offline deleteHistory…」）:
  → result.outcome === 'host-not-ready'                   ✅ 真断言
  → executed 含「Host 连接后可删除」(via showErrorMessage) ✅ 真断言（非仅 outcome）
  → IdeSessionHost.start 调用次数 = 0                     ✅ spy
  → orchestrator state === 'idle'                         ✅
  → getConversationSnapshot().tabs === []                 ✅ 无假删
README 矩阵 ↔ 实现文案                                    ✅ 一致
```
**判定**: ✅ AC-1e 下游提示已连通；上轮断裂点已修复；L2 非空壳（实测 vitest 该用例 PASS）

### Path 7: 查询类不建连 + test 钩子门闩
```
dsh.openHistory offline → 提示 / 无 Start ✅ L2
dsh.test.* 仅 VSCODE_DSH_TEST | 注入 vscode 注册 ✅ AD-CR-10
agent-loop 未改 ✅ AC-26
```
**判定**: ✅

### Path 8: Webview Continue（发送类旁路）
```
Command: dsh.continueConversation → ensureHostForSend → request('command-send') ✅
Webview: action/continue → requestContinue
  → conversations === undefined → return（静默）
  → ❌ 不经 ensureHostForSend / orchestrator.request      🟡
```
**判定**: 🟡 SHOULD-FIX — 命令路径连通，Webview Continue 离线静默 no-op，与 Auto-start 矩阵不对称

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `AutoStartOrchestrator.request` | startSession / visibility / statusBar / ensureHostForSend / retry | ✅ | `StartHostPort.start` | ✅ |
| `createStartHostPort.start` | Orchestrator | ✅ | `IdeSessionHost.start` + bind/restore | ✅ |
| `orchestrator.onChange` | FSM notify | ✅ | `ConnectionUi.projectOrchestrator` | ✅ |
| `runDeleteActive` offline | deleteConversation / panel delete | ✅ | `showErrorMessage('Host 连接后可删除')` | ✅ |
| `deleteHistorySession` offline | `dsh.deleteHistory` / `dsh.test.deleteHistory` | ✅ | `showErrorMessage` + `host-not-ready` | ✅ |
| L2 AC-1e deleteHistory | vitest → `dsh.deleteHistory` | ✅ | 断言提示 + start=0 + idle + 无 Tab | ✅ |
| `requestContinue` (panel) | Webview Continue | ✅ | controller only | 🟡 缺 auto-start |
| `AutoReadyLatchSeam` | visibility / hostReady | ✅ | stub（STUB-001） | ⚠️ 已知桩 |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| AC-1e / README → deleteHistory 离线 | 提示「Host 连接后可删除」或禁用；不 Start；不假删 | `showErrorMessage` + `host-not-ready`；无 Start；无 index-only 删 | ✅ |
| AC-1e L2 → deleteHistory | 真断言提示 + start=0 | `executed.includes` + `startSpy` + idle + tabs=[] | ✅ |
| extension → Orchestrator | `request(StartReason)` | 六态 FSM + StartHostPort | ✅ |
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
（无 — 上轮 `deleteHistory` 离线提示断裂已关闭）

### 🟡 Should-Fix
- **Webview `action/continue` 不走 `ensureHostForSend`**：命令 `dsh.continueConversation` 会 `request('command-send')`，面板 Continue 在 `conversations === undefined` 时直接 return，与 Auto-start 命令矩阵不对称（上轮已记，本轮未改）。
- **生产活动栏打开信号弱（偏差 2）**：L2 `openActivityBar` 与 Conversation 可见性已连通；真实点击活动栏图标无独立产品钩子时，主要依赖 view visibility / 状态栏（已记录，非主路径断裂）。

### 🟢 Observations
- **AC-1e Must-Fix 关闭证据：** `deleteHistorySession` 在 `conversations === undefined` 与 `deleteSession`→`host-not-ready` 两处均 `await vscode.window.showErrorMessage('Host 连接后可删除')`；与 `runDeleteActive` 对齐；未调 Orchestrator Start。
- **L2 非空壳：** `AC-1e: offline deleteHistory…` 同时断言 outcome、提示文案（经 fake `showErrorMessage` → `executed`）、`IdeSessionHost.start` spy=0、orchestrator idle、tabs 空； vitest 过滤该用例 PASS。
- L2 AC-1a 仍真实 spy `IdeSessionHost.prototype.start` + HG-2 四断言。
- STUB-001 / DEBT-001 与 registry 一致；不断裂本 Phase Start→UI 投影链。
