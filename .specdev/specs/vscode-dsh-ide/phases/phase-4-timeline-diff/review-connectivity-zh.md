# 连通性审查 — Phase 4（phase-4-timeline-diff）

## 视角
**集成连通性** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### 路径 1：Prompt → messageId（AC-12）
```
入口: dsh.promptActiveConversation / ConversationController.promptActive(text)
  → registry.getActive().sessionId
  → IdeSessionHost.prompt(sessionId, contentBlocks)
    → HarnessClient.prompt → JSON-RPC session/prompt
    → fake/真实 runtime 返回 { messageId }
  → return { messageId, sessionId, tabId }
出口: 绑定活动 Tab session 的 UUID messageId 回执
```
**判定**: ✅ 完整连通。`promptActive` / `promptTab` 均按 Tab `sessionId` 路由；集成测试断言 UUID 回执且 `receipt.sessionId === tabA.sessionId`。

### 路径 2：session.event / session.status → TimelineStore → TreeView（AC-13）
```
入口: Runtime notify('session.event'|'session.status', { sessionId, … })
  → HarnessClient.subscribe()（IdeSessionHost.watchTransport）
    → notificationListeners 扇出（onNotification）
      → ConversationController.onSdkNotification
        → TimelineStore.apply(notification)
          → 按 sessionId 缓冲（turn/step/tool/assistant/status）
        → session.status → registry.setStatus(tabId, idle|running)
      → timeline.onChange → timelineRefresh
        → createTimelineView.getItems = getActiveTimelineItems()
          → itemsForSessionTree(active.sessionId)
出口: 仅活动 Tab 的 dsh.timeline TreeView 行
```
**判定**: ✅ 完整连通。Phase 2 缺口（watcher 丢弃 payload）已由 `onNotification` 扇出修复；`bindConversations` 订阅 `timeline.onChange`，切换 Tab 时 `timelineRefresh`；活动 Tab 过滤在 `getActiveTimelineItems`。

### 路径 3：tool meta.diffs → 事后 Diff（AC-23/24/25）
```
入口: session.event tool/result { data.meta.diffs: [{ path, oldText, newText }] }
  → TimelineStore.applySessionEvent → item.diffs + pendingCalls 配对
  → writeDiffsForSessionTree(active.sessionId)
  → (a) dsh.reviewWorkspaceDiffs → reviewWorkspaceDiffs / openTimelineDiff
  → (b) TreeView 写文件行 command dsh.openTimelineDiff(item.id)
       → 查找 row.diffs[0] → openTimelineDiff
         → dsh-diff content provider（旧侧）+ vscode.diff
出口: 事后 vscode.diff；DEFAULT_POST_HOC_DIFF_ONLY=true；无执行中确认命令
```
**判定**: ✅ 完整连通。`narrowDiffs(data.meta)` 与 core `tool/result.meta` / tool-fs 契约一致；`package.json` 注册 Diff 命令且无 `dsh.confirmWriteBeforeExecute`；e2e 断言 `vscode.diff` 与命令表。

### 路径 4：subagent 通知 → 层级标注（AC-14 Should）
```
入口: notify('subagent.started'|'subagent.finished', { parentSessionId, childSessionId })
  → TimelineStore.linkChild + 在父缓冲写入 subagent 行
  → 子 session.event → 落在 child sessionId，depthOf(child) > 0
  → itemsForSessionTree(root) 合并父 + 后代
  → timelineTreeItems 用 depth 缩进（`↳ `）
出口: 父 Tab 时间线展示 subagent 边 + 嵌套子事件
```
**判定**: ✅ 连通。真实 SDK 在含 `parentSession` 的 `session/created` 时发 `subagent.started`，早于子会话活动；fake runtime 同序。单元测试断言 `depth > 0` 与 tree 聚合。

### 路径 5：多 Tab 时间线隔离（AC-7 / Phase 4 约束）
```
入口: Tab A prompt 产生 sessionA 事件；Tab B 空闲
  → TimelineStore 按 sessionId 分缓冲（无共享游标泄漏）
  → TreeView / Diff 命令始终读活动 Tab session 树
  → switchConversation → timelineRefresh 重绑 getActiveTimelineItems
出口: Tab B 在自身 prompt 前 itemsForSessionTree 长度为 0；无跨 session 行
```
**判定**: ✅ 连通。集成测试显式断言 A 提示后 B 仍为空，且 B 提示后每行属于 B 或其后代。

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `IdeSessionHost.onNotification` | `ConversationController` 构造 | ✅ | `watchTransport` 扇出 | ✅ |
| `TimelineStore.apply` | `onSdkNotification` | ✅ | 分 session 缓冲 / linkChild | ✅ |
| `itemsForSessionTree` | `getActiveTimelineItems` / Diff 命令 / 测试 | ✅ | collectTree + items maps | ✅ |
| `writeDiffsForSessionTree` | `dsh.reviewWorkspaceDiffs` / `getWriteDiffEntries` | ✅ | collectDiffs(item.diffs) | ✅ |
| `createTimelineView` | `activate`（TreeView API 可用时） | ✅ | `dsh.timeline` + `dsh.openTimelineDiff` | ✅ |
| `openTimelineDiff` | review/open Diff 命令 | ✅ | `vscode.diff` + `dsh-diff` provider | ✅ |
| `registry.setStatus` | `onSdkNotification`（session.status） | ✅ | Tab 栏快照 / 状态展示 | ✅ |
| `timeline.clearSession` | `closeConversation` | ✅ | 清理父+子缓冲 | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Controller → Host.prompt | `prompt(sessionId, blocks): Promise<string>`（messageId） | `IdeSessionHost.prompt` → `HarnessClient.prompt` | ✅ |
| Host → HarnessNotification | `session.event` / `session.status` / `subagent.*` | SDK 协议 + fake runtime 同方法名 | ✅ |
| Store ← session.event tool/result | `data.meta.diffs[{path,oldText,newText}]` | SessionEventMap `tool/result.meta` + tool-fs / fake | ✅ |
| TreeView → openTimelineDiff | `arguments: [element.id]` | 命令按 `items.find(id)` 取 `row.diffs[0]` | ✅ |
| Diff → vscode | `executeCommand('vscode.diff', left, right, title)` | `buildDiffOpenArgs` / `openTimelineDiff` | ✅ |
| 活动过滤 | TreeView 仅显示活动 Tab 树 | `getActiveTimelineItems` 用 `getActive().sessionId` | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `IdeSessionHost.prompt(sessionId)` → messageId | Phase 2 | 签名未改；仅新增 `onNotification` 扇出 | ✅ |
| `ConversationRegistry` Tab ↔ sessionId | Phase 2 | 仍使用 `getActive` / `switchTo` / `getBySessionId` | ✅ |
| Bridge dispose / interaction fail-closed | Phase 2/3 | 时间线不经 bridge；互不阻塞 | ✅ |
| SDK `session.event` / `session.status` / subagent | 既有 SDK | Extension 只投影，未改协议 | ✅ |
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

## 判决理由
五条目标路径（prompt→messageId；通知→Store→TreeView；meta.diffs→事后 Diff；subagent 层级；多 Tab 隔离）均有实际 call site 贯通，跨模块契约与 Phase 2/3 冻结面兼容，无端到端断裂 → **PASS**。
