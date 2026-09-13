# Connectivity Review — Phase 3 (GAP-005..009 debt fix)

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### Path 1: GAP-005 — transport death → showErrorMessage (AC-30 UI)
```
Entry: HarnessClient.subscribe() loop throws (SDK transport / child exit)
  → IdeSessionHost.watchTransport catch
    → onTransportDeath(reason)
      → status='error'; errorMessage=redactSecrets(reason)
      → interactions.failClosedAll(reason)          ✅ pending UI abort
      → reject pendingDispose / pendingPermission   ✅
      → notifyError(errorMessage)                   ✅
        → errorListeners.forEach(listener)
  → Extension dsh.startSession:
      stopErrorWatch = host.onError(message =>
        vscode.window.showErrorMessage(
          `DeepSeek Harness session error: ${message}`))  ✅
Exit: user-visible error + fail-closed pending interactions
```
**判定**: ✅ Host 诊断 → Extension UI 完整连通；`onError` 在 `start()` 前订阅，连接成功后仍保留

### Path 2: GAP-006 — failClosed → QuickPick hide
```
Entry: failClosedAll / failClosedSession(sessionId)
  → PendingHostInteraction.abort.abort()
  → AbortSignal 'abort' delivered to InteractionUi
  → pickItems(..., signal):
      prefer createQuickPick()
        → onAbort: qp.hide() + finish(undefined)   ✅
      fallback showQuickPick: Promise.race abort    ✅ settle（无 hide API）
  → coordinator Promise.race → 'unavailable' / reject
Exit: open QuickPick dismissed; Host settles fail-closed
```
**判定**: ✅ AbortSignal 从 Coordinator → UI → `createQuickPick().hide()` 链路完整；Extension 将真实 `vscode.window`（含 `createQuickPick`）注入 `setInteractionUi`

### Path 3: GAP-007 — questions Host→UI→response（对称 approval）
```
Entry: fake-sdk-runtime FAKE_EMIT_QUESTIONS_SESSION
  → bridge NDJSON user-questions/request { id, sessionId, questions }
  → IdeSessionHost.onBridgeFrame
    → interactions.handleQuestions(frame)
      → resolveTabId(sessionId) via ConversationRegistry  ✅ AC-10
      → presentQuestions({ …, tabId })                   ✅
    → isAskUserQuestionAnswer → connection.send(
         user-questions/response { id, answer })
  → fake runtime FAKE_QUESTIONS_LOG records selected:["yes"]
Exit: 合法 AskUserQuestionAnswer 回传 runtime            ✅ AC-17
```
**判定**: ✅ 与 approval 同构的端到端集成路径连通（fixture + Host handler + Tab 绑定 + response）

### Path 4: GAP-008 — empty options → InputBox custom
```
Entry: presentQuestions(question.options.length === 0)
  → promptFreeText → window.showInputBox({ prompt, title, placeHolder })
  → non-empty text → answers[{ id, selected:[], custom }]
  → cancel / blank / abort → selected:[] 无 custom
Exit: AskUserQuestionAnswer 含 custom 或空 selected      ✅
```
**判定**: ✅ 空 options 不再走 QuickPick；`showInputBox` 产出写入 `custom` 字段并回传 bridge

### Path 5: GAP-009 — closeConversation → failClosedSession → dispose (AD-5)
```
Entry: dsh.closeConversation → ConversationController.closeConversation(tabId)
  → interactions.failClosedSession(sessionId, reason)  ✅ 仅该 session
  → await host.disposeSession(sessionId)               ✅ GAP-003 保留
  → registry.close(tabId)
Exit: 该 Tab 未结算 Host UI → unavailable/error 帧；他 session pending 不受影响
```
**判定**: ✅ 先前 Path「关 Tab 未 abort Host UI」缺口已接线；顺序 failClosed → dispose → close

### Path 6: AC-30 合成 — transport death 同时打通 Path 1 + Path 2
```
onTransportDeath
  → failClosedAll → AbortSignal → QuickPick hide     ✅ GAP-006
  → notifyError → showErrorMessage                   ✅ GAP-005
```
**判定**: ✅ 传输死亡路径同时 fail-closed UI、错误态、用户可见错误

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `IdeSessionHost.onError` / `notifyError` | `onTransportDeath` | ✅ | Extension `showErrorMessage` | ✅ |
| `watchTransport` → `onTransportDeath` | `HarnessClient.subscribe` 异常 | ✅ | `failClosedAll` + `notifyError` | ✅ |
| `presentApproval/Questions(..., signal)` | `InteractionCoordinator.handle*` | ✅ | `pickItems` / `promptFreeText` | ✅ |
| `createQuickPick` + `hide()` | `pickItems` on abort | ✅ | VS Code QuickPick API | ✅ |
| `handleQuestions` → bridge response | `onBridgeFrame(user-questions/request)` | ✅ | `connection.send(user-questions/response)` | ✅ |
| `promptFreeText` / `showInputBox` | `presentQuestions` 空 options | ✅ | answer.`custom` | ✅ |
| `failClosedSession` | `closeConversation` | ✅ | per-session `abort.abort()` | ✅ |
| `disposeSession` after failClosed | `closeConversation` | ✅ | bridge `session/dispose` | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Extension ← Host `onError` | `(message: string) => void` | `notifyError` 传 `errorMessage` | ✅ |
| Coordinator → UI AbortSignal | fail-closed 取消打开面板 | `pickItems` listen + `hide()` | ✅ |
| Host → runtime questions answer | `AskUserQuestionAnswer` | `isAskUserQuestionAnswer` 校验后发送 | ✅ |
| 空 options → `custom` | free-text 写入 answer item | `selected:[]` + optional `custom` | ✅ |
| AD-5 关 Tab | 未结算交互按 session fail-closed | `failClosedSession` 再 `disposeSession` | ✅ |
| GAP-003 顺序 | dispose 成功后才 `registry.close` | 仍保持；前插 failClosed | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `ConversationRegistry.getBySessionId` | Phase-2 | 已实现，未改签名 | ✅ |
| `disposeSession` / `closeConversation` dispose-before-close | Phase-2 / GAP-003 | 保留；前插 `failClosedSession` | ✅ |
| Host bridge approval/questions frames | Phase-3 主体 | 已冻结；本轮仅 Host UI 侧补齐 | ✅ |
| `IdeSessionHost.interactions` 公开 | Phase-3 | `readonly interactions` 供 controller 调用 | ✅ |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）— 上一轮 AD-5「关 Tab 未 abort Host UI」已由 GAP-009 闭合

### 🟢 Observations
- GAP-005 Extension 测试以源码正则确认接线；运行时路径由 Host 单测 + `onError` 订阅代码共同保证连通。
- `promptFreeText` 在 abort 时仅 `Promise.race` settle，不主动关闭 InputBox（VS Code `showInputBox` 无对称 `hide`）；GAP-006 目标为 QuickPick，空 options 路径仍正确 settle。
- InteractionUi 安装仍以 `showQuickPick !== undefined` 为门闩；真实 VS Code window 同时提供 `createQuickPick` / `showInputBox`，生产路径可走 hide + InputBox。

## Registry 对照
- GAP-005..009 已在 `tech-debt-registry.md`「已解决」；活跃表为空。
- 源码 call site 与 registry「验证方式」描述一致，无未接线残留。
