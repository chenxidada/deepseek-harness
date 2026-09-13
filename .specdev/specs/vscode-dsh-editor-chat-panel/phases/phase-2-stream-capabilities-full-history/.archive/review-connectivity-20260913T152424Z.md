# Connectivity Review — phase-2-stream-capabilities-full-history

> Re-review after MUST-FIX loop #1（prior archive: `.archive/review-connectivity-20260913T150220Z.md`）

## 视角
**Integration Connectivity** — 模块间是否真正连通（webview ↔ bridge ↔ Host ↔ controller）

## 判决
**PASS**

## MUST-FIX 回路核对

| 先前断裂 | 本回路状态 |
|---------|-----------|
| React 无 `action/edit-resend` call site | ✅ `MessageActions` 内联表单确认后 `bridge.emitIntent({ type: 'action/edit-resend', messageId, text })` |
| React 无 `action/branch` call site | ✅ `btn-branch` → `bridge.emitIntent({ type: 'action/branch', turn })` |
| 历史搜索 `search/results` 串线顶栏 search-panel | ✅ `searchOrigin==='history'` → 写入 `historySearchHits`；`HistoryPanel` 驱动列表；不强制 `searchOpen` |
| 跟滚探针恒 off（连通相关） | ✅ scroll → `decideFollowState` → `setFollowState` → 根 `data-follow-state` + `__dshProbes.getFollowState()` |

## 端到端路径追踪

### Path 1: Edit-resend → fork P-接续（AC-34 / 34a）— 先前 MUST-FIX
```
Entry: settled 用户消息 MessageActions btn-edit-resend
  → 内联 edit-resend-form → btn-edit-resend-confirm
  → bridge.emitIntent { type:'action/edit-resend', messageId, text }
  → MessageBridge.post → ChatPanelHost.onWebviewMessage
  → deps.requestEditResend(messageId, text)          ✅ extension.ts
  → resolveBoundaryFromMessage → forkFromClosedTurn({
       intent:'edit-resend', seedUserMessageId, editedText })
  → pushFullState + 子会话 live
Exit: fork 子会话 + P-接续提示路径
```
**判定**: ✅ Webview 入口→Host→controller 完整连通（层 A 断言 posts 含 `action/edit-resend`）

### Path 2: Explicit branch → fork P-标明（AC-35）— 先前 MUST-FIX
```
Entry: settled 文本消息且 typeof turn==='number' → btn-branch
  → bridge.emitIntent { type:'action/branch', turn }
  → Host requestBranch(turn)
  → forkFromClosedTurn({ boundary:{ kind:'closed-turn', turn }, intent:'branch' })
Exit: 子会话 + forkParentTitle 投影
```
**判定**: ✅ 端到端连通；用户/助手气泡只要带 `turn` 均可触发

### Path 3: Retry → fork P-接续（AC-34a）
```
Entry: settled 或 incomplete 助手 → btn-retry
  → action/retry { messageId }
  → requestRetry → resolveBoundaryFromMessage → forkFromClosedTurn(intent:'retry')
Exit: 子会话 live
```
**判定**: ✅ 连通；本回路补齐 settled 助手重试入口（先前仅 incomplete）

### Path 4: 历史搜索档1+2（AC-56 / AC-38）— 先前 SHOULD-FIX 串线
```
Entry: HistoryPanel history-search onChange
  → setHistoryQuery + setSearchOrigin('history') + setSearchLoading(true)
  → action/search-sessions { text | path }
  → Host requestSearchSessions → post search/results { hits }
  → store: searchOrigin==='history' → historySearchHits（不 open search-panel）
  → HistoryPanel displayRows = hitsToRows(historySearchHits)（有 hits 时）
  → 无 hits 时回退本地 filter(historyRows) 档1
Exit: 历史列表反映 Host 档2；顶栏 search-panel 不被迫打开
```
**判定**: ✅ 生产者→正确消费者；分流契约一致

### Path 5: 顶栏搜索档1+2（对照路径）
```
Entry: TabChrome search-input → setSearchOrigin('chrome') + setSearchLoading(true)
  → action/search-sessions → search/results
  → store: searchHits + searchOpen=true
  → search-hit → action/open-search-hit → readonly open
Exit: 顶栏面板命中；与历史分流互不抢写（取决于当前 searchOrigin）
```
**判定**: ✅ 连通；与 Path 4 按 origin 分流

### Path 6: Follow-scroll 探针（AC-24）— 连通相关
```
Entry: messages 滚动容器 onScroll
  → decideFollowState({ followState, atBottom, userTookOver, streaming })
  → setFollowState → App data-follow-state + __dshProbes.getFollowState()
流开始近底 → followState='on'；滚离底 → 'off' + btn-follow-resume
resume → scrollTop=max + explicitResume → 'on'；follow on 时内容增长贴底
```
**判定**: ✅ Webview 内闭环连通（跟滚为展示态，不经 Host；协议约定 presentation 属 Webview）

### Path 7: History Continue（same-id）— 先前 sticky pending
```
Entry: history-row-menu btn-continue
  → setPendingContinue + ui/history-select → openFromHistory
  → continueChrome.visibility==='enabled' → action/continue
  → disabled|hidden → clear pendingContinueSessionId   ✅ 本回路已接
Exit: same-id resume；无粘滞意外 Continue
```
**判定**: ✅ 连通且清理路径闭合

### Path 8: Stop / Delete AC-60 / History open+lineage（回归）
```
Stop: btn-stop → action/stop → cancelActiveTurn → status/messages 回推 ✅
Delete: chrome|history → DeleteConfirmModal → ui/delete-request
  → requestDeleteConfirmed → deleteSession({confirmed:true}) ✅
History: ui/history-open → panel/history（parentTitle）+ Registry onChange 刷新 ✅
```
**判定**: ✅ 仍完整；无回归断裂

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `MessageActions` edit confirm | settled 用户气泡 | ✅ | `bridge.emitIntent(edit-resend)` → Host `requestEditResend` | ✅ |
| `MessageActions` btn-branch | settled + `turn` | ✅ | Host `requestBranch` → `forkFromClosedTurn` | ✅ |
| `MessageActions` btn-retry | settled/incomplete 助手 | ✅ | Host `requestRetry` | ✅ |
| `setSearchOrigin('history')` | HistoryPanel search | ✅ | `search/results` 分流写 `historySearchHits` | ✅ |
| `historySearchHits` | store applyHostFrame | ✅ | HistoryPanel `displayRows` | ✅ |
| `setFollowState` / `decideFollowState` | MessageList scroll/stream/resume | ✅ | 根 `data-follow-state` + probes | ✅ |
| `setPendingContinue(undefined)` | App effect on disabled/hidden | ✅ | 清除粘滞 pending | ✅ |
| `setSearchLoading(true)` | chrome + history search | ✅ | results 帧清 `searchLoading` | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Webview → Host edit-resend | `{type, messageId, text}` | protocol parse + `requestEditResend(id, text)` | ✅ |
| Webview → Host branch | `{type, turn:number}` | protocol parse + `requestBranch(turn)` | ✅ |
| Host → Webview search/results | hits[] | store 按 `searchOrigin` 分流 chrome vs history | ✅ |
| HistoryPanel ← historySearchHits | SearchHit→HistoryRow | `hitsToRows` + 合并 parentTitle/continueHint | ✅ |
| MessageList ← followState | FollowState on/off | store + decideFollowState 同源逻辑 | ✅ |
| Bridge ChromeIntent | edit-resend / branch 声明 | MessageList 实际 emit | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| Editor SPA shell / Tab / history | Phase 1 | 冻结复用 | ✅ |
| `ChatPanelHost` edit/branch/retry/search handlers | Phase 1 Host | 签名保留；本回路仅补 Webview call site | ✅ 未破坏冻结 |
| `forkFromClosedTurn` / `searchSessions` / `deleteSession` | 既有 controller | 语义未改 | ✅ |
| `decideFollowState`（Host 同源模块） | chat-panel/render | React import 同源 | ✅ |

## 关键发现

### 🔴 Must-Fix
（无）— 先前两条 UI→Host 死线已闭合。

### 🟡 Should-Fix
（无连通性级）— 历史搜索串线、pending sticky、`searchLoading` 脱节已在本回路修复。

### 🟢 Observations
1. **并发双源搜索竞态**：若顶栏与历史几乎同时发出 `search-sessions`，后到的 `search/results` 按**当时** `searchOrigin` 分流，可能偶发写错表面。产品上两入口罕并用；不升格 Should-Fix。
2. 历史命中行点击仍走 `ui/history-select`（与历史行一致），顶栏命中走 `action/open-search-hit` — 入口不同、只读打开均有下游，契约可接受。
3. Stop / Delete(AC-60) / Continue / parentTitle / fork banner / activity-ref-change 回归路径保持连通。
4. `action/delete`（原生确认）仍闲置；React 走 `ui/delete-request` — 不影响 AC-60。

## 反狡辩核对

| 借口 | 驳回 |
|------|------|
| 「Host 有 handler 就算连通」 | 本回路已验证 **实际 call site**（MessageList emit + 层 A posts） |
| 「search/results 写了就算联动」 | 已核对消费者是 `historySearchHits`→历史列表，而非顶栏 panel |
| 「follow-state 属性存在即可」 | 已追踪 scroll→decideFollowState→store→DOM/probes，非恒 `'off'` |

---

**Output**: `phases/phase-2-stream-capabilities-full-history/review-connectivity.md`
**Verdict**: **PASS**
