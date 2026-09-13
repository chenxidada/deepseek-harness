# 连通性审查 — Phase 3（interaction-fail-closed）

## 视角
**集成连通性** — 模块间是否真正连通

## 判决
**SHOULD-FIX**

## 端到端路径追踪

### 路径 1：approval/request → Host UI（正确 Tab）→ ApprovalOutcome
```
入口: ApprovalService / waterfall('approval/request', req)
  → ide-bridge ctx.on('approval/request')          ✅ 终端 answerer，不 next()
    → awaitHostApproval(sessionId=agent.session.id)
      → 未连接 / 发送失败 → 'unavailable'           ✅ AC-19
      → client.send({ kind:'approval/request', id, sessionId, toolName, reason? })
  → Host IdeBridgeHostServer.onFrame
    → IdeSessionHost.onBridgeFrame(approval/request)
      → InteractionCoordinator.handleApproval
        → resolveTabId(sessionId) via ConversationRegistry.getBySessionId  ✅ AC-10
        → InteractionUi.presentApproval({ …, tabId })  ✅ QuickPick 标注 Tab/session
      → connection.send({ kind:'approval/response', id, outcome })
  → runtime settleInboundResponse → pending.resolve(outcome)
出口: waterfall 解除；合法 ApprovalOutcome 回传                 ✅ AC-16 / AC-20
```
**判定**: ✅ 数据路径完整；应答按 `id` 关联，Tab 经 `sessionId` 解析，不会静默记到错误会话

### 路径 2：user-questions/request → Host UI → AskUserQuestionAnswer
```
入口: waterfall('user-questions/request', …)
  → ide-bridge awaitHostQuestions
    → send user-questions/request { id, sessionId, questions }
  → Host interactions.handleQuestions → presentQuestions
  → 与 approval 同构：合法 answer 回传；抛错 → error 帧
  → settleInboundResponse resolve/reject (NO_PROVIDER / ASK_ABORTED)
出口: AskUserQuestionAnswer 或 fail-closed                     ✅ AC-17 / AC-19
```
**判定**: ✅ 与 approval 同构连通（ide-bridge 单元往返已覆盖；Host handler 已接线）

### 路径 3：permission/select → permission-presets
```
入口: dsh.selectPermissionPreset（扩展）
  → ConversationController.list/selectPermissionPreset(active.sessionId)
  → IdeSessionHost.permissionRpc → bridge broadcast permission/list|select
  → ide-bridge handlePermissionSelect/List
    → ctx.get('permissionPresets').set(session, preset)   ✅ 唯一权威 AC-21/22
    → permission/*/response
  → Host pendingPermission.resolve
出口: preset 应用到会话（base bundle 已挂 dsh-permission-presets） ✅
```
**判定**: ✅ Host→runtime RPC 与 presets 服务连通；无第二权限权威源

### 路径 4：断连 / 超时 / 非法 / 子进程退出 fail-closed
```
未连接 / 发送失败      → unavailable / NO_PROVIDER              ✅
interactionTimeoutMs   → unavailable / NO_PROVIDER              ✅
client.onDisconnect    → failClosedApprovals/Questions          ✅
Host bridge onDisconnect / shutdownInternal / onTransportDeath
  → interactions.failClosedAll + reject pendingDispose/Permission ✅ AC-30
validateBridgeFrame    → 非法 outcome/answer/未知 kind 丢弃     ✅ AC-31（不放行）
```
**判定**: ✅ 主 fail-closed 边连通；非法入站不会变成静默 allow

### 路径 5：关 Tab / session dispose 期间未结算交互（缺口）
```
入口: closeConversation(tabId)
  → host.disposeSession(sessionId) via session/dispose          ✅ Phase-2 路径仍在
  → registry.close(tabId)
  ✗ 未调用 interactions.failClosedAll / 按 sessionId abort pending
出口: Host QuickPick 可能仍挂起；应答若晚到则 runtime pending 已空而忽略
```
**判定**: 🟡 SHOULD-FIX — AD-5「关 Tab → 未结算交互 fail-closed」在 Host UI 侧未接线

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `awaitHostApproval` | `ctx.on('approval/request')` | ✅ | `IdeBridgeClient.send` + pending map | ✅ |
| `awaitHostQuestions` | `ctx.on('user-questions/request')` | ✅ | bridge + pendingQuestions | ✅ |
| `settleInboundResponse` | `client.onFrame` | ✅ | pending resolve/reject | ✅ |
| `handlePermissionSelect` | Host `permission/select` | ✅ | `permissionPresets.set` + `sessions.get` | ✅ |
| `InteractionCoordinator.handleApproval` | `IdeSessionHost.onBridgeFrame` | ✅ | `InteractionUi` + `registry.getBySessionId` | ✅ |
| `createVscodeInteractionUi` | `extension.activate` / `setInteractionUi` | ✅ | QuickPick → 合法 outcome/answer | ✅ |
| `pickPermissionPreset` | `dsh.selectPermissionPreset` | ✅ | `controller.selectPermissionPreset` | ✅ |
| `failClosedAll` | disconnect / transport death / shutdown | ✅ | abort pending UI waits | ✅ |
| Tab close → pending UI abort | `closeConversation` | 🟡 | `interactions` 未按 session 取消 | 🟡 |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| ide-bridge ↔ Host | `BridgeFrame` approval/questions/permission | `types.ts` + `validateBridgeFrame` | ✅ |
| Host → runtime response | `ApprovalOutcome` 闭集 | `APPROVAL_OUTCOMES` + 校验拒非法 | ✅ |
| Host → runtime answer | `AskUserQuestionAnswer` | `isAskUserQuestionAnswer` | ✅ |
| Permission RPC | `permissionPresets.set(session, name)` | duck-type `IdeBridgePermissionPresets` | ✅ |
| Tab 路由 | `sessionId` → `tabId` | `ConversationRegistry.getBySessionId` | ✅ |
| AD-5 关 Tab fail-closed | dispose 时取消未结算 Host UI | 仅 dispose，不 abort interactions | 🟡 |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| Host bridge UDS + hello（非 stdout） | Phase-1 | 冻结，本 Phase 未回退 | ✅ |
| `ConversationRegistry.getBySessionId` / multi-Tab | Phase-2 | 已实现；本 Phase 只消费 | ✅ |
| `session/dispose` 往返 | Phase-2 | 保留；permission 帧为加性扩展 | ✅ |
| STUB-001/002 answerers | Phase-1 债务 | registry → 已解决；真实往返 | ✅ |
| `dsh-permission-presets` in `dsh-base` | 既有 | ide profile 栈包含 | ✅ |

## 关键发现

### 🔴 Must-Fix
（无）— 验收主路径（approval / questions / permission / 断连超时非法 / 子进程退出）端到端连通，无静默放行断点。

### 🟡 Should-Fix
- **关 Tab / `disposeSession` 未 abort Host 待处理交互**：`closeConversation` 只走 bridge dispose，不触达 `InteractionCoordinator.failClosedAll`（或按 `sessionId` 过滤 abort）。与 design AD-5「未结算交互 fail-closed」不一致；运行时可因 AbortSignal 结算，但 Host UI 等待可能悬空，晚到的 `approval/response` 成为孤儿帧。

### 🟢 Observations
- 非法 `approval/response` / `user-questions/response` 在 `validateBridgeFrame` 被整帧丢弃，pending 依赖超时 fail-closed（仍不放行，仅延迟结算）。
- UI 以 QuickPick 标注 Tab/session，未强制 `switchTo` 聚焦；符合 AD-5「聚焦或明确标注」的后者；应答仍按 bridge `id` 回传，防串台依赖关联 id 而非活动 Tab。
- Extension 侧 user-questions 全链路主要靠 ide-bridge 往返 + Host handler 接线证明；fake-runtime 支持 `FAKE_EMIT_QUESTIONS_SESSION` 但当前集成/e2e 未跑该旋钮（覆盖缺口，非接线缺失）。
- `permission/select` 走公开 `presets.set`（与 Web `/permission` live `setPolicy` 旁白路径略异）属实现偏差，权威源仍为 permission-presets，连通性满足 AC-21/22。

## 摘要

审批与提问：waterfall → ide-bridge → Host bridge → `InteractionCoordinator`（`sessionId`→Tab）→ UI → 合法结局回传，阻塞至结算。权限：扩展 → `permission/*` RPC → `permissionPresets.set`。断连、超时、非法载荷、子进程/传输死亡均 fail-closed。唯一应修缺口：关 Tab 未取消 Host 侧挂起交互。
