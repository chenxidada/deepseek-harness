# Connectivity Review — phase-3-activity-stream

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### Path 1: Live tool/call|result → MessageStore activity → DOM + probes
```
Entry: SDK session.event { type: 'tool/call', data: { turn, callId, name, … } }
  → ConversationController.onSdkNotification
    → attributor.noteToolCall(...)                         ✅（既有）
    → projectToolCallActivity(...)                         ✅
         → MessageStore.append(kind:'activity', activity.status='running', turn)
         → ChatPanelHost.pushAppend(message)               ✅ 整包含 activity 字段
  → Webview messages/append
    → appendMessage → renderBubble
      → msg.kind==='activity' → renderActivityBubble(...)  ✅（provider 内嵌 activityDomBrowserSource）
         → applyMessageIdentity → data-kind=activity, data-turn, data-message-id
         → data-status=running, data-expanded=false
         → probes.setActivity(id, { status, expanded })    ✅ GAP-CUX-001 产品路径填实

tool/result
  → projectToolResultActivity
    → activityStatusFromToolResult (ABORTED*|isError|done) ✅
    → MessageStore.patch({ activityStatus })
    → Host.pushPatch({ activityStatus })                   ✅
  → Webview messages/patch.activityStatus
    → query [data-message-id][data-kind=activity]
    → applyActivityStatus → probes.setActivity             ✅
Exit: 对话流内 `[data-kind=activity]` + probes.activity[id]
```
**判定**: ✅ 数据路径完整；层 B 断言 `messages/append` kind=activity；层 A 断言 DOM/probes

### Path 2: cancel / turn-end aborted → running → aborted
```
Entry: Webview action/stop
  → ChatPanelHost → cancelActiveTurn → cancelSession       ✅（phase-2）
  → live turn/end { reason.kind: aborted|interrupted }
  → markTurnIncomplete
    → abortRunningActivities                               ✅
         扫描 kind==='activity' && status==='running'（同 turn）
         → MessageStore.patch({ activityStatus:'aborted' })
         → Host.pushPatch({ activityStatus:'aborted' })
    → assistant incomplete + notice「已停止/未完成」       ✅
    → 不调用 revert / change/revert-result                 ✅（AC-13c 无自动 revert）
  → Webview applyActivityStatus(..., 'aborted', probes)    ✅ 接线存在
Exit: 同回合 running 活动项收敛为 aborted；无永久 running
```
**判定**: ✅ Store→Host→Webview patch 全链连通；层 B 覆盖 Store 终态 + 无 revert；Host patch 帧未在层 B 断言（见 Should-Fix）

### Path 3: setActivity 探针产品路径（GAP-CUX-001）
```
产品调用点（非仅 API 骨架）:
  1. renderActivityBubble 初次 mount / append / replace    ✅
  2. applyActivityStatus（messages/patch.activityStatus）  ✅
  3. toggleActivityExpanded / applyActivityExpanded        ✅
Host action/toggle-activity → ack no-op（呈现态本地）      ✅ 契约：展开不依赖 Host 权威
```
**判定**: ✅ 产品路径调用 `probes.setActivity`；Registry GAP-CUX-001 已关闭

### Path 4: 回放 foldActivities → DOM + reject-send（AC-28）
```
Entry: openFromHistory / restoreOpenTabSet
  → hydrateFromAuthoritativeLog(sessionId, events)
       ├─ foldMessages → text
       ├─ foldActivities(tool/call|result + turn/end abort) ✅
       │     → ChatMessage{ kind:'activity', turn, activity }
       └─ foldTimeline（弱化，非主路径）
  → MessageStore.replace(hydrated.messages)
  → hydrateChangeListsFromIndex（同 turn change-list）
  → registry mode='replay'
  → ChatPanelHost.pushFullState
       → messages/replace(含 activity 消息)                ✅
  → Webview renderMessages → renderBubble activity 分支    ✅
  → composer/send → Host reject('replay') → ui/reject-send ✅
```
**判定**: ✅ 产品 hydrate→replace→fullstate→DOM 与 reject-send 均连通；层 B 将 fold 与 reject-send 分测（见 Should-Fix）

### Path 5: 同 turn 活动 ↔ change-list 同组（AC-23/25）
```
Live activity: projectToolCallActivity 写 turn → data-turn=N   ✅
Live change-list: settleChangeListProjection 写 turn
  → pushFullState → change-list bubble data-turn=N             ✅
Replay: foldActivities.turn + hydrateChangeListsFromIndex.turn ✅
归组契约: applyMessageIdentity 属性相等（非必须新容器）        ✅
```
**判定**: ✅ 共 `data-turn` 契约完整；层 A 断言 activity×2 + change-list 同 turn

### Path 6: 活动流独立于文本 chunk（AC-24）
```
tool/call 投影不经过 projectAssistantChunk
层 B: 无 assistant text 时仍有 kind:activity                   ✅
```
**判定**: ✅ 与文本路径解耦，无断链

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `projectToolCallActivity` | `onSdkNotification` tool/call | ✅ | `MessageStore.append` + `pushAppend` | ✅ |
| `projectToolResultActivity` | `onSdkNotification` tool/result | ✅ | `MessageStore.patch` + `pushPatch` | ✅ |
| `abortRunningActivities` | `markTurnIncomplete` (turn/end aborted) | ✅ | patch + `pushPatch(activityStatus)` | ✅ |
| `foldActivities` | `hydrateFromAuthoritativeLog` | ✅ | messages[] → `replace` → `pushFullState` | ✅ |
| `renderActivityBubble` | provider `renderBubble` / layer-A | ✅ | DOM attrs + `probes.setActivity` | ✅ |
| `applyActivityStatus` | Webview `messages/patch` | ✅ | DOM `data-status` + probes | ✅ |
| `action/toggle-activity` | Webview toggle postMessage | ✅ | Host ack no-op（呈现态） | ✅ |
| `activityStatusFromToolResult` | live result + hydrator | ✅ | ActivityStatus 枚举 | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Controller → MessageStore | `kind:'activity'` + `activity?` + `activityStatus` patch | 已扩展 ChatMessage / MessagePatch | ✅ |
| Controller → Host | `pushAppend` 整包 / `pushPatch.activityStatus` | Host 透传 activityStatus | ✅ |
| Host → Webview protocol | `messages/patch.activityStatus`；`action/toggle-activity` | protocol.ts 已声明 | ✅ |
| Webview → activity-dom | 内嵌 `activityDomBrowserSource` + CSS | provider 嵌入 + render 分支 | ✅ |
| activity-dom → probes | `setActivity(id,{status,expanded})` | probes API 可变 map | ✅ |
| Hydrator → Store → Host | activity 消息进入 replace 列表 | openFromHistory.replace + pushFullState | ✅ |
| Replay send gate | mode=replay → reject-send | Host 既有 gate（phase-2） | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| I-真 cancel / turn/end aborted→incomplete | phase-2 | 已冻结；本 Phase 仅叠加 abortRunningActivities | ✅ 未改 agent-loop |
| probes.setActivity 座位 | phase-1 | 产品填实（关闭 GAP-CUX-001） | ✅ |
| applyMessageIdentity / data-turn | phase-1 | 未改语义；activity 复用 | ✅ |
| change-list turn 投影 | code-context-diff / 既有 settle | 仅共组，未改 change-list 产品化 | ✅ |
| Timeline tool 行 | 既有 | 仍弱化；非活动主路径 | ✅ 无错误耦合 |

## 测试联通覆盖（检查重点 6）

| 链路 | 覆盖方式 | 是否仅隔离 |
|------|---------|:--:|
| tool→Store→Host append | 层 B `chat-ux-activity-stream` | ❌ 真 Controller+Host+FakePort |
| Store/DOM status + probes | 层 A `activity-dom` + 层 B Store 映射 | 层 A 抽离模块（constitution 要求） |
| cancel→abort Store + 无 revert | 层 B AC-13c（含 action/stop） | ❌ 集成 |
| Host `messages/patch.activityStatus` 出站 | **未断言** | ⚠️ |
| hydrate→openFromHistory→messages/replace 含 activity | **未一体断言**（fold 与 reject-send 分测） | ⚠️ |
| activity↔change-list data-turn | 层 A 合成挂载 | 属性契约覆盖；无 live settle 联测 |

## 关键发现

### 🔴 Must-Fix
- （无）端到端路径均连通，无跨模块契约断裂，无冻结接口被破坏。

### 🟡 Should-Fix
- **层 B 未断言 status 的 Host→Webview 半段**：AC-13c / AC-27 只验 MessageStore 终态，未 `expect` FakeWebview 收到 `messages/patch` 且 `activityStatus` 为 `aborted|done|failed`。代码接线存在，但联通回归可被静默回归。
- **AC-28 未打通「hydrate → replace → pushFullState」一体路径**：当前分别测 `foldActivities` 产出与独立 `mode=replay` reject-send；建议补一条 `openFromHistory({ events })`（或等价 replace+pushFullState）断言 outbound `messages/replace` 含 `kind:'activity'`。

### 🟢 Observations
- `action/toggle-activity` Host ack no-op 与 design「呈现态可本地，同步探针」一致；展开态权威在 Webview probes/DOM。
- Hydrator 将 activity 追加在 text fold 之后；同组判定依赖 `data-turn` 而非 DOM 邻接，与 AC-25 契约兼容。
- Timeline 仍接收 tool 事件但非对话活动主阅读面，无双写冲突。

## 详细报告路径
- 本文件：`.specdev/specs/vscode-dsh-chat-ux/phases/phase-3-activity-stream/review-connectivity.md`
