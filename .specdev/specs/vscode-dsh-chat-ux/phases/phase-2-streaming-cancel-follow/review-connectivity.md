# Connectivity Review — phase-2-streaming-cancel-follow

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### Path 1: I-真 Stop → Agent.cancel（AC-13 / AD-CUX-3）
```
Entry: Webview #stopBtn click
  → vscode.postMessage({ type: 'action/stop' })
  → ChatPanelHost.attach → parseWebviewToHostMessage → onWebviewMessage
  → deps.requestStop()  (extension.ts 接线)
    → ConversationController.cancelActiveTurn()
      → IdeSessionHost.cancelSession(sessionId)
        → bridge.broadcast({ kind:'session/cancel', id, sessionId })
        → ide-bridge handleCancel
          → ctx.get('sdkSessionCancel').cancelSession(sessionId)
          → HarnessSdkJsonRpcServer.cancelSession
            → rec.handle.agent.cancel({ kind:'user' }, { keepInbox: true })
        → session/cancel/response { ok } → pendingCancel resolve
        → 超时 5000ms / 失败 → reject → banner「中断失败：…」(AC-13d)
Exit: Agent abort + Host response；不前端假停
```
**判定**: ✅ 全链接通。Webview UI → Host → bridge → Cordis `sdkSessionCancel` → 既有 `Agent.cancel`；失败/超时 fail-closed，不标 incomplete。

### Path 2: assistant/chunk → MessageStore → messages/patch → DOM（AC-10/11/12/18）
```
Entry: session.event { type:'assistant/chunk', data:{ chunk:{ type:'text-delta', text } } }
  → IdeSessionHost notificationListeners
  → ConversationController.onSdkNotification
  → projectAssistantChunk
       ├─ reasoning-delta → return (T6 / AD-CUX-7) ✅
       ├─ 首 delta: MessageStore.append(streaming:true) + pushAppend
       │            + setStatus(running) + pushStatus → status/set generating
       │            → Webview applyStreamingStatus → probes.streaming=true；Stop 可见
       │            → initFollowOnStreamStart + keepBottomIfFollowing
       └─ 后续 delta: MessageStore.patch(appendText) + pushPatch
                      → Webview patchMessageDom(same data-message-id)
assistant/message → projectAssistantMessage 收敛同 messageId（text= + streaming:false）
Exit: 稳定气泡增量 + generating chrome + 收敛
```
**判定**: ✅ 数据路径完整。首 chunk 用 append 建节点、后续 patch（implementation 偏差 #2）仍保持身份；`messages/replace` 不参与后续增量。

### Path 3: turn/end aborted → incomplete 标记（AC-13b）
```
Entry: session.event { type:'turn/end', data:{ reason:{ kind:'aborted'|'interrupted' } } }
  → onSdkNotification → markTurnIncomplete
       → MessageStore.patch(incomplete:true, streaming:false)
       → panelHost.pushPatch(incomplete:true, streaming:false)
       → Webview patchMessageDom → data-incomplete
       → append notice「已停止/未完成」+ pushAppend
       → setStatus(idle) + pushStatus → streaming chrome 关
Hydrate: detectIncomplete 认 aborted | interrupted ✅
Exit: 半截文本保留 + incomplete + notice
```
**判定**: ✅ live 与 hydrate 两条 incomplete 路径均接通；cancel 失败路径不走 incomplete（AC-13d）。

### Path 4: Follow 开流 / 接管 / 恢复（AC-14–16 / P2-2）
```
Entry: 流式开始（append streaming=true | patch streaming=true | status→generating）
  → initFollowOnStreamStart()：近底 → follow=on；已离底 → off（接管）
  → applyFollowState(chassis) + probes.setFollowState + data-follow-state
Scroll: #messages scroll → syncFollowFromScroll
  → decideFollowState({ atBottom, userTookOver:!atBottom, … })
  → follow=off 时显示 #followResumeBtn「回到底部」
Patch/append 增量: keepBottomIfFollowing() → scrollIntoView / scrollTop（非像素 AC）
Resume: followResumeBtn → syncFollowFromScroll(true) → follow=on + keepBottom
Cancel/断连: streaming false；不强制重置 follow
Exit: 探针可观测 on/off/on
```
**判定**: ✅ 产品滚动/按钮已接到真实 `#messages` 与决策函数；与 phase-1 骨架同源。

### Path 5: 断连 fail-closed（AC-19）
```
Entry: IdeSessionHost onStatusChange('error'|'disconnected')
  → failClosedAllStreaming → patch streaming:false + banner + status idle
Exit: streaming 探针关；不宣称成功中断
```
**判定**: ✅ 接通。

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| Webview `action/stop` | `#stopBtn` click | ✅ | `ChatPanelHost.onWebviewMessage` | ✅ |
| `requestStop` | Host deps（extension） | ✅ | `cancelActiveTurn` | ✅ |
| `cancelActiveTurn` | requestStop / 测试 | ✅ | `host.cancelSession` | ✅ |
| `IdeSessionHost.cancelSession` | controller | ✅ | bridge `session/cancel` + pendingCancel | ✅ |
| `handleCancel` | `handleHostFrame` | ✅ | `sdkSessionCancel.cancelSession` | ✅ |
| `server.cancelSession` | Cordis provide | ✅ | `agent.cancel(..., {keepInbox:true})` | ✅ |
| `projectAssistantChunk` | `onSdkNotification` | ✅ | MessageStore + `pushAppend`/`pushPatch` | ✅ |
| `pushPatch` | controller | ✅ | Webview `messages/patch` → `patchMessageDom` | ✅ |
| `markTurnIncomplete` | `turn/end` aborted/interrupted | ✅ | patch incomplete + notice append | ✅ |
| `detectIncomplete` | hydrate | ✅ | `aborted`/`interrupted` | ✅ |
| `initFollowOnStreamStart` / `keepBottomIfFollowing` | append/patch/status | ✅ | `#messages` scroll API | ✅ |
| `failClosedAllStreaming` | Host status error/disconnected | ✅ | patch + banner + pushStatus | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| protocol W→H | `action/stop` | `parseWebviewToHostMessage` 识别 + Host 路由 | ✅ |
| protocol H→W | `messages/patch` text XOR appendText + streaming/incomplete | `pushPatch` 拒绝双写；Webview 同校验 | ✅ |
| bridge | `session/cancel` ↔ `session/cancel/response` | types + validate + handleCancel | ✅ |
| Cordis | `sdkSessionCancel` service key | bridge types 与 sdk `session-cancel.ts` 同名 `'sdkSessionCancel'` | ✅ |
| Agent.cancel | `{ kind:'user' }, { keepInbox: true }` | server.cancelSession 原样调用；未改 agent-loop | ✅ |
| status→streaming | Tab `running` → panel `generating` | `resolveStatus` + `applyStreamingStatus` | ✅ |
| MessageStore.patch | streaming false 清除字段 | `delete next.streaming` | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `decideFollowState` / `applyFollowState` / probes | phase-1 | 已实现，产品接线本 Phase | ✅ |
| `patchMessageDom` 骨架 | phase-1 | 扩展 streaming attr；产品消费 | ✅ |
| `Agent.cancel` + keepInbox | 既有 core | 只读消费，未改签名 | ✅ |
| dispose/resume triad 模式 | 既有 | cancel 镜像同一模式 | ✅ |
| activity aborted UI（AC-13c） | → phase-3 | 本 Phase 仅 Host incomplete；未假接活动项 UI | ✅ 边界清晰 |

## 测试联通覆盖

| 路径 | 测试 | 覆盖形态 |
|------|------|---------|
| chunk→store→`messages/patch` 身份 | 层 B `chat-ux-streaming-cancel-follow` | Host+Controller+FakeWebview 联通 ✅ |
| reasoning 丢弃 | 层 B | ✅ |
| `action/stop`→`cancelSession` | 层 B（spy Host） | Host 段 ✅；bridge→Agent 在 `ide-bridge.spec` 另测 ✅ |
| cancel 失败 fail-closed | 层 B | ✅ |
| turn/end aborted→incomplete+notice | 层 B（MessageStore） | Store 段 ✅；outbound incomplete patch 未断言（代码已 push） |
| detectIncomplete aborted | 层 B | ✅ |
| disconnect fail-closed | 层 B | ✅ |
| patch DOM 身份 / incomplete attrs | 层 A | ✅ |
| follow 决策 + `data-follow-state` | 层 A | 决策段 ✅；产品 scroll/keepBottom 靠读码确认 |
| bridge cancel round-trip | `ide-bridge.spec` | ✅ |

无「仅层 C Must」冒充联通。

## 关键发现

### 🔴 Must-Fix
- （无）

### 🟡 Should-Fix
- （无阻塞性断链）层 B AC-13b 仅断言 MessageStore incomplete/notice，未断言 Host outbound `messages/patch { incomplete:true }`；产品路径代码已 `pushPatch`，属测试缝隙而非断链——不升格判决。

### 🟢 Observations
- Cancel 全链由「层 B Host spy」+「ide-bridge cancel 帧」+「server→Agent.cancel 源码」分段覆盖，无单测贯穿 IdeSessionHost.broadcast→Agent；接线完整，符合 I-真分段验证习惯。
- Follow 产品滚动（`keepBottomIfFollowing` / scroll listener /「回到底部」）已写入 Webview HTML；层 A 按 AC 契约测决策函数 + `data-follow-state`，不断言像素。
- 首 chunk `messages/append`、后续 `messages/patch` 的偏差与 design「ensure bubble + patch」兼容，身份稳定。
- `packages/core/agent-loop` 未改动（O-3）。

## 总结

五条关键路径（cancel 三件套、chunk→patch→DOM、aborted→incomplete、follow 滚动接线、断连 fail-closed）均从入口接到出口，跨模块契约一致，跨 Phase 依赖未破坏冻结接口。判决 **PASS**。
