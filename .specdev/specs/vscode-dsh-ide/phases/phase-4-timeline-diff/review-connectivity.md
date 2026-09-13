# Connectivity Review — Phase 4 (phase-4-timeline-diff)

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### Path 1: Prompt → messageId (AC-12)
```
Entry: dsh.promptActiveConversation / ConversationController.promptActive(text)
  → registry.getActive().sessionId
  → IdeSessionHost.prompt(sessionId, contentBlocks)
    → HarnessClient.prompt → JSON-RPC session/prompt
    → fake/real runtime result { messageId }
  → return { messageId, sessionId, tabId }
Exit: UUID messageId receipt bound to active Tab session
```
**判定**: ✅ 完整连通。`promptActive` / `promptTab` 均按 Tab `sessionId` 路由；集成测试断言 UUID 回执与 `receipt.sessionId === tabA.sessionId`。

### Path 2: session.event / session.status → TimelineStore → TreeView (AC-13)
```
Entry: Runtime notify('session.event'|'session.status', { sessionId, … })
  → HarnessClient.subscribe() (IdeSessionHost.watchTransport)
    → notificationListeners fan-out (onNotification)
      → ConversationController.onSdkNotification
        → TimelineStore.apply(notification)
          → per-sessionId buffers (turn/step/tool/assistant/status)
        → session.status → registry.setStatus(tabId, idle|running)
      → timeline.onChange → timelineRefresh
        → createTimelineView.getItems = getActiveTimelineItems()
          → itemsForSessionTree(active.sessionId)
Exit: dsh.timeline TreeView rows for active Tab only
```
**判定**: ✅ 完整连通。Phase 2 缺口（watcher 丢弃 payload）已由 `onNotification` 扇出修复；`bindConversations` 订阅 `timeline.onChange` + registry 切换时 `timelineRefresh`，活动 Tab 过滤在 `getActiveTimelineItems`。

### Path 3: tool meta.diffs → 事后 Diff (AC-23/24/25)
```
Entry: session.event tool/result { data.meta.diffs: [{ path, oldText, newText }] }
  → TimelineStore.applySessionEvent → item.diffs + pendingCalls pairing
  → writeDiffsForSessionTree(active.sessionId)
  → (a) dsh.reviewWorkspaceDiffs → reviewWorkspaceDiffs / openTimelineDiff
  → (b) TreeView write row command dsh.openTimelineDiff(item.id)
       → find row.diffs[0] → openTimelineDiff
         → dsh-diff content provider (old) + vscode.diff
Exit: post-hoc vscode.diff; DEFAULT_POST_HOC_DIFF_ONLY=true; no mid-run confirm command
```
**判定**: ✅ 完整连通。`narrowDiffs(data.meta)` 与 core `tool/result.meta` / tool-fs 契约一致；`package.json` 注册 Diff 命令且无 `dsh.confirmWriteBeforeExecute`；e2e 断言 `vscode.diff` 与命令表。

### Path 4: subagent 通知 → 层级标注 (AC-14 Should)
```
Entry: notify('subagent.started'|'subagent.finished', { parentSessionId, childSessionId })
  → TimelineStore.linkChild + push subagent rows on parent buffer
  → child session.event → items under child sessionId with depthOf(child) > 0
  → itemsForSessionTree(root) unions parent + descendants
  → timelineTreeItems indent (`↳ `) via depth
Exit: parent Tab timeline shows subagent edges + nested child events
```
**判定**: ✅ 连通。真实 SDK 在 `session/created`（含 `parentSession`）时发 `subagent.started`，早于子会话活动；fake runtime 同序。单元测试断言 `depth > 0` 与 tree 聚合。

### Path 5: 多 Tab 时间线隔离 (AC-7 / Phase 4 约束)
```
Entry: Tab A prompt emits events for sessionA; Tab B idle
  → TimelineStore buffers keyed by sessionId (no shared cursor leak)
  → TreeView / Diff commands always read active Tab session tree
  → switchConversation → timelineRefresh rebinds getActiveTimelineItems
Exit: Tab B itemsForSessionTree length 0 until its own prompt; no cross-session rows
```
**判定**: ✅ 连通。集成测试显式断言 Tab B 在 A 提示后仍为空，且 B 提示后每行属于 B 或其 descendant。

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `IdeSessionHost.onNotification` | `ConversationController` ctor | ✅ | `watchTransport` fan-out | ✅ |
| `TimelineStore.apply` | `onSdkNotification` | ✅ | per-session buffers / linkChild | ✅ |
| `itemsForSessionTree` | `getActiveTimelineItems` / Diff cmds / tests | ✅ | collectTree + items maps | ✅ |
| `writeDiffsForSessionTree` | `dsh.reviewWorkspaceDiffs` / `getWriteDiffEntries` | ✅ | collectDiffs(item.diffs) | ✅ |
| `createTimelineView` | `activate` when TreeView APIs present | ✅ | `dsh.timeline` + `dsh.openTimelineDiff` | ✅ |
| `openTimelineDiff` | review/open Diff commands | ✅ | `vscode.diff` + `dsh-diff` provider | ✅ |
| `registry.setStatus` | `onSdkNotification` (session.status) | ✅ | Tab bar snapshot / status chrome | ✅ |
| `timeline.clearSession` | `closeConversation` | ✅ | drop parent+child buffers | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Controller → Host.prompt | `prompt(sessionId, blocks): Promise<string>` (messageId) | `IdeSessionHost.prompt` → `HarnessClient.prompt` | ✅ |
| Host → HarnessNotification | `session.event` / `session.status` / `subagent.*` | SDK protocol + fake runtime emit same methods | ✅ |
| Store ← session.event tool/result | `data.meta.diffs[{path,oldText,newText}]` | SessionEventMap `tool/result.meta` + tool-fs / fake | ✅ |
| TreeView → openTimelineDiff | `arguments: [element.id]` | command looks up `items.find(id)` then `row.diffs[0]` | ✅ |
| Diff → vscode | `executeCommand('vscode.diff', left, right, title)` | `buildDiffOpenArgs` / `openTimelineDiff` | ✅ |
| Active filter | TreeView shows only active Tab tree | `getActiveTimelineItems` uses `getActive().sessionId` | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `IdeSessionHost.prompt(sessionId)` → messageId | Phase 2 | 未改签名；仅加 `onNotification` 扇出 | ✅ |
| `ConversationRegistry` Tab ↔ sessionId | Phase 2 | `getActive` / `switchTo` / `getBySessionId` 仍用 | ✅ |
| Bridge dispose / interaction fail-closed | Phase 2/3 | 时间线路径不经过 bridge；互不阻塞 | ✅ |
| SDK `session.event` / `session.status` / subagent | 既有 SDK | Extension 只投影，未改 server/client 协议 | ✅ |
| tool-fs `meta.diffs` | 既有 tool-fs | Extension 窄化消费，未改 tool-fs | ✅ |

无冻结接口破坏；无跨 Phase 环依赖。

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无连通性断裂或契约不一致项）

### 🟢 Observations
- **Git/SCM 无 meta 回退未接线**：AC-23 允许 “tool events and/or git”；本 Phase 走 `meta.diffs`，无 hunk 时信息提示。实现偏差已记录，不构成路径断裂。
- **`pendingCalls` 按 `callId` 全局键**：多 Tab 并发若 callId 碰撞理论上会串配对；真实/fake runtime 使用唯一人造 id，实际风险低。
- **子事件早于 `subagent.started`**：`depth` 在 `push` 时固化；乱序时早期子行可能 `depth===0`，但 `linkChild` 后仍会被 `itemsForSessionTree` 收入。真实 SDK 在 `session/created` 发 started，通常早于子活动。
- **e2e 未整链走 activate→bindConversations→TreeView 点击**：命令注册与 `openTimelineDiff` 已测；Host→Controller→Store 由集成覆盖；组合接线在 `extension.ts` 可见。

## Verdict rationale
五条目标路径（prompt→messageId；通知→Store→TreeView；meta.diffs→事后 Diff；subagent 层级；多 Tab 隔离）均有实际 call site 贯通，跨模块契约与 Phase 2/3 冻结面兼容，无端到端断裂 → **PASS**。
