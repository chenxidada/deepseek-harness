# Connectivity Review — phase-2-stream-capabilities-full-history

## 视角
**Integration Connectivity** — 模块间是否真正连通（webview ↔ bridge ↔ Host ↔ extension/commands）

## 判决
**MUST-FIX**

## 端到端路径追踪

### Path 1: Stop（streaming → cancel）
```
Entry: Composer btn-stop
  → setStopping(true) + bridge.emitIntent({ type: 'action/stop' })
  → MessageBridge.post → ChatPanelHost.onWebviewMessage
  → deps.requestStop → controller.cancelActiveTurn()
  → Host cancelSession / turn settle → status/set + messages/patch
  → store clears streaming/stopping when idle / streaming=false
Exit: status「正在停止…」→ settle；btn-stop[disabled] while stopping
```
**判定**: ✅ 完整连通

### Path 2: Delete AC-60（chrome ↔ history → 单后端）
```
Entry A: TabChrome menu-delete-session → openDeleteConfirm({ source: 'chrome' })
Entry B: HistoryPanel btn-history-delete → openDeleteConfirm({ source: 'history' })
  → DeleteConfirmModal（webview modal「不可恢复」）
  → ui/delete-request { sessionId }
  → Host → requestDeleteConfirmed(sessionId)
  → runDeleteConfirmed → deleteSession(sessionId, { confirmed: true })
  → historyRefresh + pushHistoryFrame + pushFullState
Exit: Registry/Index 同步；历史列表刷新（Host 强制 historyOpen=true）
```
**判定**: ✅ 顶栏与历史共用 modal + 同一 `deleteSession`；无原生二次确认。`action/delete`→`requestDelete`（原生确认）仍在 Host，但 React **不 emit** — AC-60 产品路径干净。

### Path 3: History Continue（same-id）
```
Entry: HistoryPanel btn-continue
  → setPendingContinue(sessionId) + ui/history-select
  → requestOpenHistorySession → openFromHistory (replay)
  → pushFullState (mode=replay, continue chrome, sessionId)
  → App useEffect: pending===sessionId && continueChrome.visibility==='enabled'
  → action/continue → requestContinue → continueConversation()
Exit: same-id resume + pushFullState
```
**判定**: ✅ 主路径连通。⚠️ 若 Continue chrome 始终非 `enabled`，`pendingContinueSessionId` 永不清除（见 Should-Fix）。

### Path 4: Composer Continue（replay CTA）
```
Entry: Composer btn-continue（mode=replay + chrome visible）
  → action/continue → requestContinue → continueConversation
Exit: live resume
```
**判定**: ✅ 连通；与 fork/retry 意图分离。

### Path 5: 搜索档1+2（顶栏 search-panel）
```
Entry: TabChrome btn-search → setSearchOpen + search-input
  → action/search-sessions { text | path }
  → requestSearchSessions → controller.searchSessions
  → Host post search/results { hits }
  → store: searchHits + searchOpen=true
  → search-hit → action/open-search-hit → openSearchHit (readonly) + pushFullState
Exit: 只读打开；无档3
```
**判定**: ✅ 顶栏主入口连通。

### Path 6: 历史搜索联动（AC-56 / AC-38）
```
Entry: HistoryPanel history-search onChange
  → 本地 filter(historyRows)          ← 档1 标题/预览/parentTitle
  → 同时 emit action/search-sessions  ← 意图档2
  → search/results → store 强制 searchOpen=true + 写入 searchHits
  → HistoryPanel **不消费** searchHits（仍只显示本地 filtered rows）
Exit: Host 命中出现在顶栏 search-panel，而非历史列表
```
**判定**: 🟡 SHOULD-FIX — 非死写，但是**错误消费者**：历史框触发的 Host 结果串线到顶栏搜索面板；历史列表自身无档2命中投影。AC-56 允许「内嵌或与顶栏联动」，故不升格 MUST-FIX，但联动是串线式而非列表内更新。

### Path 7: Retry → fork P-接续
```
Entry: MessageList btn-retry（仅 incomplete 助手消息）
  → action/retry { messageId }
  → requestRetry → resolveBoundaryFromMessage → forkFromClosedTurn(intent:'retry')
  → pushFullState + forkParentTitle / 新 sessionId
Exit: 子会话 live
```
**判定**: ✅ 在 incomplete 条件下连通。完整回合/用户侧无 retry UI（见 Observations）。

### Path 8: Edit-resend → fork P-接续（AC-34 / 34a）
```
Entry: ❌ React 无任何按钮 emit action/edit-resend
  → bridge 类型已声明；Host requestEditResend → forkFromClosedTurn(intent:'edit-resend') 已接线
Exit: ❌ UI→Host 断裂 — 用户无法从消息上下文触发
```
**判定**: 🔴 MUST-FIX — Host/controller 可达，产品面死线。

### Path 9: Explicit branch → fork P-标明（AC-35）
```
Entry: ❌ React 无任何按钮 emit action/branch
  → bridge 类型已声明；Host requestBranch → forkFromClosedTurn(intent:'branch') 已接线
Exit: ❌ UI→Host 断裂
```
**判定**: 🔴 MUST-FIX — 端到端路径在 Webview 入口断裂。

### Path 10: Open history + lineage + live sync
```
Entry: btn-history → ui/history-open → pushHistoryFrame
  → listHistoryRows ← ExtensionIndex.listHistorySessions（含 parentTitle）
  → panel/history → HistoryPanel（history-parent「分支自 …」）
Registry onChange → pushFullState → pushHistoryFrame（historyOpen 时刷新）
forkParentTitle: resolveForkParentTitle → panel/state → TabChrome fork-parent-banner
```
**判定**: ✅ parentTitle / forkParentTitle / AC-59 刷新链路连通。

### Path 11: Panel reveal / ready race
```
createWebviewPanel → attach(port) → pushFullState（可能早于 React listen）
  → App mount → ready → Host pushFullState 再推一次
re-reveal existing panel → pushFullState（retainContextWhenHidden）
```
**判定**: ✅ ready 回补缓解冷启动竞态；无断线。

### Path 12: 活动 / 引用 / 变更
```
activity-toggle → local store + action/toggle-activity（Host ack no-op）✅
ref-card → action/open-reference → requestOpenReference ✅
change-list-item → change/open；审阅 → change/open-native-diff；撤销 → change/revert
  → revertChange → messages.patchChangeStatus → pushFullState ✅
```
**判定**: ✅ 主操作连通。`change/mark-reviewed` 仅在 bridge 类型、无 UI emit（审阅走 native-diff）— Observation。

### Path 13: Timeline 弱化（AC-14b / 44）
```
overflow menu-open-timeline → ui/open-timeline → workbench.view.extension.dsh
```
**判定**: ✅ 意图连通（实现偏差：容器级命令，非专属 focus — 非本视角架构评价）。

---

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `DeleteConfirmModal` | TabChrome / HistoryPanel `openDeleteConfirm` | ✅ | `ui/delete-request` → `runDeleteConfirmed` | ✅ |
| `Composer` stop | streaming/stopping UI | ✅ | `action/stop` → `cancelActiveTurn` | ✅ |
| `Composer` continue | replay + continueChrome | ✅ | `action/continue` | ✅ |
| History Continue + `pendingContinue` | HistoryPanel | ✅ | select → Continue effect | ✅ / ⚠️ sticky pending |
| `HistoryPanel` search | 用户输入 | ✅ | 本地 filter ✅；Host search → **search-panel** | ⚠️ |
| `TabChrome` search-panel | 用户 / search/results | ✅ | `open-search-hit` | ✅ |
| `btn-retry` | incomplete assistant | ✅ | `action/retry` → fork | ✅ |
| edit-resend UI | — | 🔴 | `action/edit-resend` Host 已备 | 🔴 无 emit |
| branch UI | — | 🔴 | `action/branch` Host 已备 | 🔴 无 emit |
| `listHistoryRows` parentTitle | ExtensionIndex | ✅ | HistoryPanel | ✅ |
| `pushFullState` / history | registry.onChange / delete | ✅ | panel/history | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Webview → Host delete | `ui/delete-request` + sessionId；无二次确认 | parser + `requestDeleteConfirmed` + `deleteSession({confirmed:true})` | ✅ |
| Webview → Host continue | `action/continue` | `requestContinue` → `continueConversation` | ✅ |
| Webview → Host stop | `action/stop` | `requestStop` → `cancelActiveTurn` | ✅ |
| Webview → Host search | `action/search-sessions` → `search/results` | Host 回推 hits | ✅ |
| History search → UI | 期望历史列表反映档2命中 | hits 写入 `searchHits` 并 `searchOpen=true` | ⚠️ 契约错位 |
| Webview → Host edit/branch | AC-34a/35 上下文入口 | Host 有 handler；React **无 call site** | 🔴 |
| Index → history row | `parentTitle?` | `listHistorySessions` 投影 + extension map | ✅ |
| Host → Webview fork chrome | `forkParentTitle` in panel/state | store + TabChrome banner | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| Editor SPA shell / Tab / history-open | Phase 1 | 冻结并复用 | ✅ |
| `ChatPanelHost` stop/continue/fork/search | Phase 1 Host | 签名保留；新增 `ui/delete-request` / `ui/open-timeline` | ✅ 扩展非破坏 |
| `deleteSession` / `forkFromClosedTurn` / `searchSessions` | 既有 controller | 未改冻结语义 | ✅ |
| `buildThinChatHtml` | Phase 1 / legacy | 生产走 SPA；thin 仅 fixture | ✅ 主路径未双绑 |

## 关键发现

### 🔴 Must-Fix
1. **`action/edit-resend` 无 Webview call site（AC-34 / 34a）** — bridge + Host `requestEditResend` → `forkFromClosedTurn` 已连通，但 `MessageList`（及全 React 树）从不 emit。编辑重发端到端在 UI 入口断裂。
2. **`action/branch` 无 Webview call site（AC-35）** — 同上；显式分叉 Host 可达、产品面死按钮（实际是无按钮）。能力「假可达」。

### 🟡 Should-Fix
1. **历史搜索 → `search/results` 串线打开顶栏 search-panel** — `applyHostFrame('search/results')` 无条件 `searchOpen: true`；历史框触发的 Host 档2结果不进入 `historyRows`。建议：按来源分流，或历史搜索只本地档1、档2统一走顶栏并明确联动，避免静默弹出第二表面。
2. **History Continue `pendingContinueSessionId` 粘滞** — chrome 非 `enabled` 时 effect 不清理 pending；后续 chrome 变 enabled 可能意外 auto-Continue。应超时/取消/在 disabled|hidden 时 clear。
3. **`searchLoading` 几乎永不 true** — 发出 `search-sessions` 时未 `setSearchLoading(true)`；加载指示与 Host 往返脱节（弱连通）。

### 🟢 Observations
- Stop / Delete(AC-60) / Continue / 顶栏搜索 / history open / parentTitle / fork banner / activity-ref-change / panel ready 回补 — 主日常路径连通良好。
- `action/delete`（原生确认）仍在 Host；React 删除走 `ui/delete-request` — 旧路径闲置，不破坏 AC-60。
- Retry 仅挂在 `incomplete` 助手消息；完整回合无 retry call site（连通性部分覆盖）。
- `change/mark-reviewed` 类型存在但无 UI；「审阅」映射 `change/open-native-diff`，下游连通。
- Timeline 使用 `workbench.view.extension.dsh` — 意图有消费者。

## 反狡辩核对
| 借口 | 驳回 |
|------|------|
| 「Host 已有 edit/branch，连接肯定没问题」 | 无 call site = 端到端断裂 |
| 「历史搜索双路径可接受」 | 档2结果写进错误 UI 表面仍是契约错位（记 Should-Fix） |
| 「删了就行」 | 已确认 chrome/history → 同一 `deleteSession({confirmed:true})` 消费者 |

---

**Output**: `phases/phase-2-stream-capabilities-full-history/review-connectivity.md`
**Verdict**: **MUST-FIX**
