# 连通性审查 — Phase 2（phase-2-multi-tab-session）

## 视角
**集成连通性** — 模块间是否真正连通

## 判决
**SHOULD-FIX**

主路径（新建 Tab → 切换输入目标 → prompt 到正确 `sessionId` → 关 Tab → bridge `session/dispose` → Map 清理 + `AgentHandle.dispose`）端到端连通，不串会话；服务端 dispose 顺序可防 zombie。关 Tab 时注册表先删后 dispose、以及 TreeView 未绑定切换，属可优化连接完整性问题，不构成主路径断裂。STUB-001/002 目标 Phase 3，不判 MUST-FIX。

## 端到端路径追踪

### 路径 1: 新建对话 Tab → 可区分 sessionId（AC-6 / AC-9）
```
入口: dsh.newConversation / startSession 后 bindConversations
  → ConversationController.newConversation()
    → ConversationRegistry.create()
         → tabId = randomUUID()
         → sessionId = randomUUID()   ✅ 每 Tab 独立 id
         → activeTabId = tabId
         → onChange → tabBar.refresh()
出口: ConversationTab { tabId, sessionId, … } + TreeView 投影更新
```
**判定**: ✅ 数据路径完整；≥2 Tab 时各持不同 `sessionId`（集成测试断言）

### 路径 2: 切换活动 Tab → prompt 目标切换（AC-7）
```
入口: dsh.switchConversation（QuickPick）
  → ConversationController.switchConversation(tabId)
    → ConversationRegistry.switchTo(tabId)   ✅ 仅改本地指针，不换进程
  → dsh.promptActiveConversation(text)
    → ConversationController.promptActive(text)
         → active = registry.getActive()
         → host.prompt(active.sessionId, blocks)   ✅ 只用活动 Tab 的 id
           → HarnessClient.prompt(sessionId, …)
             → stdout JSON-RPC session/prompt { sessionId, contentBlocks }
出口: { messageId, sessionId: active.sessionId, tabId }
```
**判定**: ✅ 输入目标与活动指针绑定；假运行时 `FAKE_PROMPT_LOG` 证明两条 prompt 分属不同 sessionId，不串会话

### 路径 3: 关 Tab → bridge dispose → Map + AgentHandle（AC-8 / Q-3）
```
入口: dsh.closeConversation
  → ConversationController.closeConversation(tabId)
    → registry.close(tabId)                    ✅ 返回 closed.sessionId
    → IdeSessionHost.disposeSession(sessionId)
         → bridge.broadcast({ kind:'session/dispose', id, sessionId })
           → IdeBridgeClient 收帧
             → handleHostFrame
               → ctx.get('sdkSessionDispose').disposeSession(sessionId)
                 → HarnessSdkJsonRpcServer.disposeSession
                      → sessions.delete(sessionId)   ✅ 先清 Map
                      → rec.handle.dispose()         ✅ 再 dispose（防 zombie）
               → session/dispose/response { ok:true }
         → Host pendingDispose resolve
出口: Tab 栏更新；该 session 在 server Map 中消失
```
**判定**: ✅ 设计要求的 bridge（非 stdout）dispose 全链连通；`ctx.provide` / `ctx.get('sdkSessionDispose')` 契约一致  
**注意**: 注册表在 `await disposeSession` **之前**移除 Tab（见 Should-Fix）

### 路径 4: 窗口进程生命周期（Phase 1 复用，AD-1）
```
dsh.startSession → IdeSessionHost.start → 单 ide 子进程 + bridge listen
多 Tab 共享同一 HarnessClient / 同一 bridge 连接
dsh.stopSession / deactivate → client.close() + bridge.close() + clearLocal()
```
**判定**: ✅ 无「每 Tab 一进程」；关窗口不依赖路径 3 逐 session dispose

### 路径 5: STUB-001 / STUB-002（审批 / 提问）
```
approval/request → unavailable
user-questions/request → NO_PROVIDER
```
**判定**: ⏭ 目标 Phase 3；本审查不判 MUST-FIX（与 tech-debt-registry 一致）

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `ConversationRegistry.create` | `ConversationController.newConversation` / `extension` start | ✅ | —（纯本地状态） | ✅ |
| `ConversationRegistry.switchTo` | `ConversationController.switchConversation` / `dsh.switchConversation` | ✅ | — | ✅ |
| `ConversationController.promptActive` | `dsh.promptActiveConversation` | ✅ | `IdeSessionHost.prompt(sessionId)` | ✅ |
| `IdeSessionHost.prompt` | Controller | ✅ | `HarnessClient.prompt` → `session/prompt` | ✅ |
| `ConversationController.closeConversation` | `dsh.closeConversation` | ✅ | `registry.close` + `host.disposeSession` | ✅ |
| `IdeSessionHost.disposeSession` | Controller | ✅ | `IdeBridgeHostServer.broadcast(session/dispose)` | ✅ |
| `handleHostFrame`（ide-bridge） | Host→runtime NDJSON | ✅ | `sdkSessionDispose.disposeSession` | ✅ |
| `HarnessSdkJsonRpcServer.disposeSession` | Cordis `sdkSessionDispose` provide | ✅ | Map.delete + `AgentHandle.dispose` | ✅ |
| `createConversationTabBar` | `activate` | ✅ | TreeView 投影 `getSnapshot` | ✅ |
| TreeView 点击/选中 → switch | （无 command / onDidChangeSelection） | 🟡 | `switchConversation` | ❌ 未接线 |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Controller → Host.prompt | `prompt(sessionId, blocks): Promise<string>` | `IdeSessionHost.prompt` → `client.prompt` | ✅ |
| Host → bridge | `session/dispose` + await `session/dispose/response` | `BridgeFrame` 含 request/response；`onBridgeFrame` 配对 `id` | ✅ |
| ide-bridge → sdk-server | `ctx.get('sdkSessionDispose').disposeSession(id)` | `ctx.provide('sdkSessionDispose', { disposeSession })`；键字符串双方均为 `sdkSessionDispose` | ✅ |
| sdk-server dispose 语义 | 先清 Map 再 `handle.dispose()`，避免 zombie | `sessions.delete` 后 `rec.handle.dispose()` | ✅ |
| Extension → SDK 协议 | 不新增 stdout `session/close` | dispose 仅走 bridge；protocol 方法集未扩 | ✅ |
| ide profile 组合 | 同进程可 get dispose 服务 | `sdk-app` 挂 `sdk-jsonrpc-server`；`ide` patch 插 `ide-bridge`；dispose 时 lazy `ctx.get` | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `IdeSessionHost` 单进程 + bridge listen / hello | Phase 1 | 已实现；本 Phase 扩展 `prompt` / `disposeSession` | ✅ |
| `IdeBridgeHostServer` / NDJSON / hello | Phase 1 | 已实现；本 Phase 增 `broadcast` + dispose 帧 | ✅ |
| `HarnessClient.prompt(sessionId)` | Phase 1 / SDK | 既有 API，未改协议 | ✅ |
| STUB-001 / STUB-002 answerer | Phase 1 → Phase 3 | 仍 fail-closed；本 Phase 未填实 | ⏭ 非阻塞 |
| Phase 1 冻结 stdout 方法集 | Phase 1 | 未新增 `session/close` | ✅ |

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix

1. **关 Tab：注册表先删、再 await dispose**（`conversation-controller.ts` 的 `closeConversation`）  
   若 `disposeSession` 超时/失败，UI 已无 Tab，但 runtime Map 可能仍有该 `sessionId`（Host 侧 orphan）。建议先成功 dispose 再 `registry.close`，或失败时恢复 Tab / 标 `error`。

2. **TreeView 仅为投影，未接到切换**（`conversation-tab-bar.ts`）  
   `getTreeItem` 未设置 `command`，亦无 selection → `switchConversation`。活动切换仅靠 `dsh.switchConversation` QuickPick。命令路径连通，但「点 Tab 栏切换」未接上；若产品期望侧栏即切换入口，应补接线。

### 🟢 Observations

- Fake SDK runtime e2e 验证 Host↔bridge dispose 往返与 Tab 清理；真实 Map+`AgentHandle.dispose` 由 `packages/sdk/server` + `ide-bridge` 单测覆盖。同进程 Cordis provide/get 使真实 `ide` profile 可拼上。
- 从未 prompt 过的 Tab 关闭时，server `disposeSession` 对缺失 id 为 no-op，仍返回 ok — 与「清映射」语义一致，无 zombie。
- AC-11 标题：首条 prompt 经 `titleFromFirstMessage` 写回 registry，再经 `onChange` 刷新 TreeView — 投影链路连通。
- 关窗口走整进程 `shutdown`，不依赖逐 Tab dispose；`clearLocal` 只清 Extension 映射。

## 摘要

| 检查项 | 结果 |
|--------|:----:|
| 新建 Tab → 新 sessionId | ✅ |
| 切换 → prompt 不串会话 | ✅ |
| 关 Tab → bridge dispose | ✅ |
| Map 清理 + AgentHandle.dispose（防 zombie） | ✅ |
| 不扩展 SDK stdout close | ✅ |
| STUB-001/002 | ⏭ Phase 3 |
| 关 Tab 失败时序 / TreeView 切换接线 | 🟡 SHOULD-FIX |
