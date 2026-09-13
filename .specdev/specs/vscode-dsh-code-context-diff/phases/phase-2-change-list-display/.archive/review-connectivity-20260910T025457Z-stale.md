# Connectivity Review — phase-2-change-list-display

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**MUST-FIX**

## 端到端路径追踪

### Path 1: meta.diffs → ChangeAttributor → ChangeStore → change-list UI
```
Entry: session.event tool/result { meta.diffs }
  → ConversationController.onSdkNotification
    → attributor.ingestToolResult(sessionId, turn, meta)   ✅ recoverableDiffsFromMeta + Ignore
  → session.event assistant/message
    → projectAssistantMessage → attributor.noteAssistant     ✅ N-2 anchor id
    → enqueueSettle → settleChangeListProjection
      → attributor.settleTurn → SnapshotStore.write          ✅ full-file blob
      → changes.upsert ChangeRecord                          ✅
      → changes.toListPayload → MessageStore kind:change-list ✅
      → N>0: also kind:diff-summary; N=0: emptyNotice only   ✅
      → panelHost.pushFullState → messages/replace           ✅
  → Webview renderBubble(change-list)                        ✅ payload.changes / emptyNotice
Exit: message-attached list (or one-line empty notice)
```
**判定**: ✅ 主入账→投影→UI 路径完整；N=0 / N>0 分支均连通

### Path 2: SnapshotStore ↔ change/get-diff → change/diff-content
```
Entry: Webview row expand → post change/get-diff { changeId }
  → ChatPanelHost → requestChangeDiff
    → ChangeStore.getById → snapshotRef
    → SnapshotStore.read(sessionId, snapshotRef)             ✅
  → Host post change/diff-content { available, oldText?, newText?, reason? }
  → Webview pane matched by data-change-id → textContent     ✅
  prune / missing ref → available:false + reason（不伪造）    ✅
Exit: on-demand diff pane
```
**判定**: ✅ 按需 diff 读写闭环连通

### Path 3: change/open → 打开文件 + 首变更行
```
Entry: Webview dblclick / Shift+click → change/open { changeId, path }
  → ChatPanelHost → requestChangeOpen → openChangedPath
    → SnapshotStore.read → firstChangedLine → showTextDocument selection ✅
Exit: editor open (+ revealLine when snapshot present)
```
**判定**: ✅ open 链路连通（主单击走的是 Path 2 expand，非本路径——见 Observations）

### Path 4: AC-30 diff-summary → reveal change-list
```
Entry: Webview diff-summary click
  → post action/reveal-change-list   ❌ 未带 sourceMessageId / turn
  → Host requestRevealChangeList(undefined)
    → reverse().find(kind===change-list)  → 取「最近一条」列表
  → pushRevealChangeList → scroll/reveal-change-list
  → Webview scrollIntoView change-list
```
**判定**: 🔴 MUST-FIX — 单 turn 偶然正确；多 turn 时无法 reveal「对应」消息下列表（违反 AD-CCD-4 / AC-30「对应」）

### Path 5: AC-19 变更 → 来源消息（reveal-source）
```
Entry: （设计）change/reveal-source { sourceMessageId }
  → protocol + ChatPanelHost 路由存在                       ✅ 契约层
  → Webview change-list UI 从不 post change/reveal-source   🔴 无生产者
  → extension requestRevealSource
    → pushRevealChangeList(sessionId, sourceMessageId)      🔴 滚到 change-list，不是 assistant bubble
Exit: ❌ 变更→来源消息交互路径断裂 / 错连
```
**判定**: 🔴 MUST-FIX — 反向溯源未接到正确 DOM 目标；UI 亦未发出协议帧

### Path 6: N=0 空说明 + 隐藏 diff-summary
```
Entry: assistant settle with zero attributed paths
  → toListPayload emptyNotice:true
  → MessageStore change-list text=CHANGE_LIST_EMPTY_NOTICE   ✅
  → 不注入 diff-summary                                      ✅
  → Webview change-list-empty / data-empty                   ✅
Exit: 一句说明，无空骨架，无 AC-30 入口
```
**判定**: ✅ N=0 路径完整

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `ChangeAttributor.ingestToolResult` | `ConversationController.onSdkNotification` (tool/result) | ✅ | `recoverableDiffsFromMeta` / pending merge | ✅ |
| `ChangeAttributor.noteToolCall` | tool/call notify | ✅ | `readWorkspaceText` before-cache | ✅ |
| `ChangeAttributor.settleTurn` | `settleChangeListProjection` | ✅ | `SnapshotStore.write` + `ChangeStore.upsert` | ✅ |
| `ChangeStore.toListPayload` | settle projection | ✅ | `MessageStore.append(change-list)` | ✅ |
| `SnapshotStore.read` | `requestChangeDiff` / `openChangedPath` | ✅ | blob file under `changes/<sessionId>/` | ✅ |
| `action/reveal-change-list` | Webview diff-summary click | ⚠️ 缺 identity | `pushRevealChangeList` | ⚠️ 可能错目标 |
| `change/get-diff` | Webview expand | ✅ | `change/diff-content` → pane | ✅ |
| `change/open` | Webview dblclick / Shift+click | ✅ | `openChangedPath` | ✅ |
| `change/reveal-source` | （无 Webview 调用方） | 🔴 | `requestRevealSource` → 错滚到 list | 🔴 |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Controller → Attributor | tool/result meta → pending hunks | `ingestToolResult` + AD-CCD-8 ignore | ✅ |
| Attributor → SnapshotStore | full-file old/new write | `write` → `changes/<sessionId>/<ref>.json` | ✅ |
| ChangeStore → MessageStore | lightweight list, no full blob | `changeList` without old/new plaintext | ✅ |
| MessageStore → Webview | `kind:change-list` + `changeList` | renderBubble reads `msg.changeList` | ✅ |
| Webview → Host get-diff | `{ changeId }` → diff body | Host reads SnapshotStore → `change/diff-content` | ✅ |
| Webview → Host AC-30 | reveal **对应** turn 的 change-list | 无 sourceMessageId；Host 取最新 list | 🔴 |
| Webview → Host reveal-source | scroll to assistant `data-message-id` | 无 post；Host 滚 change-list | 🔴 |
| Host → SnapshotStore root | activate `storageUri` / global fallback | Controller ctor 注入 `SnapshotStore({ storageRoot })` | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| Spike recoverable `meta.diffs` 契约 | phase-0 | 冻结；复用 `recoverableDiffsFromMeta` | ✅ |
| Timeline `narrowDiffs` 同形信号 | chat-ready / phase-0 | 未改 agent-loop；仅 vscode-dsh 消费 | ✅ |
| GAP-010/011 宁可漏记 | phase-0 registry | 文档化永久漏记；无 watcher 旁路 | ✅（故意断点） |
| phase-1 代码引用 | phase-1 | DAG 不依赖；本 Phase 未改动引用面 | ✅ 无关 |
| phase-3 revert / mark-reviewed | — | 未暴露写盘按钮；无假连通 | ✅ |

## 关键发现

### 🔴 Must-Fix
1. **AC-30 多 turn reveal 缺 identity**：`diff-summary` 点击只发 `{ type: 'action/reveal-change-list' }`，未附带 `sourceMessageId`（或 turn）。Host 在 `sourceMessageId === undefined` 时 `reverse().find(change-list)`，恒指向最近一条列表，无法保证「对应消息下」reveal（AD-CCD-4 / AC-30）。
2. **AC-19 变更→来源消息路径断裂**：协议与 Host 路由已有 `change/reveal-source`，但 Webview 变更条目从不发出该帧；`extension.requestRevealSource` 错误调用 `pushRevealChangeList`（滚到 change-list），而不是 `data-message-id === sourceMessageId` 的助手气泡。反向溯源端到端不通。

### 🟡 Should-Fix
1. **多 assistant 同 turn 再定稿时 `ChangeRecord.sourceMessageId` 可能滞留**：首次 `settleTurn` 写入 records 后 pending 清空；后续助手再 settle 若 pending 为空则不再 upsert，MessageStore payload 的 `sourceMessageId` 已换锚，但 `ChangeStore` 记录仍指向首个助手 id。`getById` / 未来 phase-3 按 record 溯源会与列表锚点不一致。
2. **AC-12a 主单击语义分流**：单击连通的是 `change/get-diff`（展开），打开定位走 dblclick/Shift+click。open 链路本身连通，但与「单击打开」产品文案的入口不一致（连通面可选统一）。

### 🟢 Observations
- 主路径 Path 1/2/6 接线清晰：Controller 持有同一 `ChangeStore` + `SnapshotStore`；activate 经 ctor 注入 storageRoot；`wireChangePipeline` 补齐 workspace reader / ignore。
- N=0：`emptyNotice` + `CHANGE_LIST_EMPTY_NOTICE` + 不注入 `diff-summary`，与 N-1 一致。
- `change/get-diff` prune/`available:false` 有明确回应，无伪造正文。
- Timeline / `action/open-workspace-diffs` 仍为次路径保留，不阻断 AC-30 主路径（在 Must-Fix #1 修好 identity 后）。
- 冷回放 ChangeStore 再归属未作为本 Phase Must 路径交付；live 路径不依赖它。
