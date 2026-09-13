# Connectivity Review — phase-5-fork-retry-branch（MUST-FIX 复审）

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### Path 1: turn=0 retry/edit → emptySeed（MUST-FIX #1 修复验证）
```
Webview action/retry | action/edit-resend (turn=0 closed)
  → extension requestRetry / requestEditResend
    → resolveBoundaryFromMessage → closed-turn 0
    → forkFromClosedTurn({ intent:'retry'|'edit-resend' })
         ├─ findPriorClosedBoundary(turn=0) → undefined
         ├─ invokeFork(parent, { emptySeed: true })     ✅ 不再 omit= tip
         │    → IdeSessionHost.forkSession({ emptySeed:true })
         │      → bridge session/fork { emptySeed:true }  ✅ validate 互斥 boundarySeq
         │        → handleFork → sdkSessionFork.forkSession
         │          → forkSeedFromParent({ emptySeed:true }) → seed: []  ✅ 禁止 tip
         │          → agents.create({ seed: [] })
         ├─ buildForkResult({ emptySeed:true })         ✅ 无 boundarySeq 哨兵
         ├─ applyContinueSwitch
         │    · projectMessagesForForkSeed(..., undefined) → []  ✅
         │    · parent mode→replay + E2 Sets + switchTo(child)
         │    · pushFullState → messages/replace([]) then…
         └─ promptTab(child, promptText)                ✅ 只叠新 user，无父 assistant
Exit: child SDK 空 seed + UI 无 tip-fork 叠轮
```
**判定**: ✅ 契约对齐；Host `emptySeed` ↔ bridge ↔ SDK `seed:[]` 全链路连通；层 B 断言 `emptySeed:true` / 无 `boundarySeq` / 无父 assistant

### Path 2: child MessageStore 按 seed 裁剪 → UI 投影（MUST-FIX #2 / 原 Should-Fix）
```
fork 成功 → ForkResult.seedMaxTurn | emptySeed
  → applyContinueSwitch / applyBranchMark
       → projectMessagesForForkSeed(parentMsgs, childId, seedMaxTurn?)
            · emptySeed → seedMaxTurn omitted → []           ✅
            · prior-cut retry → seedMaxTurn=prior.turn       ✅
            · branch → seedMaxTurn=目标 turn                 ✅
       → messages.replace(childSessionId, trimmed)
       → registry.switchTo(child)
       → pushFullState
            → messages.get(active.sessionId)                 ✅ 读裁剪后桶
            → post messages/replace → Webview                ✅ UI 与 seed 对齐
  → (P-接续) promptTab → projectUserMessage → pushAppend     ✅ 重发文本进入投影
```
**判定**: ✅ 生产者（seedCut）→ MessageStore → panel/state 消费者完整；prior-cut 丢弃应丢 assistant；edit-resend 末条 user=`editedText`

### Path 3: Copy（AC-30）
```
Webview action/copy-message
  → ChatPanelHost → requestCopyMessage
    → MessageStore 回退（text 空）→ dsh.copyToClipboard → lastCopiedText
```
**判定**: ✅ 未回退，路径完整

### Path 4: P-接续 E2 + AC-66（turn≥1 prior-cut）
```
retry turn≥1
  → findPriorClosedBoundary → boundarySeq=prior turn/end + seedMaxTurn=prior.turn
  → invokeFork({ boundarySeq })                          ✅ 非 emptySeed
  → applyContinueSwitch：mode→replay / sealed / parentReadonly / switchTo(child)
  → 不调用 continueConversation / resume 父 id
  → 切回父 Tab → probes.parentReadonly + continueSealed   ✅
```
**判定**: ✅ 与 turn-0 emptySeed 分流正确；E2 / 切 Tab 仍通

### Path 5: P-标明 branch（AC-60/62/63）
```
action/branch → forkFromClosedTurn({ intent:'branch' })
  → invokeFork({ boundarySeq:目标 turn/end })
  → applyBranchMark：不改 parent.mode / 不写 E2 Sets
  → seedMaxTurn=目标 turn 裁剪水合 + parentSessionId/forkLabel
  → banner kind=fork-branch-mark
```
**判定**: ✅ 与 P-接续分流完整

### Path 6: 拒非法（AC-34/61 + P2-1）
```
aborted/open/无法映射 → resolveClosedTurnBoundary 拒 → invokeFork 不调用
parent.status==='running' → reason=parent-running → 不 fork
```
**判定**: ✅ 非法请求不到达 bridge/SDK

### Path 7: AC-64 ChangeStore 子空桶
```
fork → 新 childSessionId；ChangeStore 按 id 分桶
  → list(child)=[]；父 list 不变；无 checkout / 无拷父 index
```
**判定**: ✅ 写后不串桶

### Path 8: Continue 对照（AC-65）
```
continueConversation → resumeSession(same id) → setMode(live)
P-接续不走 resume；层 B resumeCalls=[] after retry
```
**判定**: ✅ 两条路径契约分离

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `emptySeed` 分支 | `findPriorClosedBoundary` 空 | ✅ | `invokeFork` → Host → bridge → SDK `seed:[]` | ✅ |
| `projectMessagesForForkSeed` | `applyContinueSwitch` / `applyBranchMark` | ✅ | `messages.replace` → `pushFullState` / `messages/replace` | ✅ |
| `buildForkResult(seedCut)` | retry/edit/branch 成功后 | ✅ | `ForkResult.emptySeed` / `seedMaxTurn` 供水合 | ✅ |
| bridge `session/fork.emptySeed` | `IdeSessionHost.forkSession` | ✅ | validate 互斥 + `handleFork` 透传 | ✅ |
| `forkSeedFromParent({emptySeed})` | `createForkedSession` | ✅ | `agents.create({ seed: [] })` | ✅ |
| `action/copy-message` | Webview | ✅ | `requestCopyMessage` → clipboard | ✅ |
| `applyContinueSwitch` E2 | retry/edit | ✅ | registry / Sets / probes / `promptTab` | ✅ |
| `applyBranchMark` | branch | ✅ | registry / index（不碰 E2） | ✅ |
| Continue `session/resume` | `continueConversation` | ✅ | same-id（对照） | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Host ↔ bridge ↔ SDK | turn-0：`emptySeed:true`，无 `boundarySeq` | validate + server 双检互斥；`seed:[]` | ✅ |
| Host ↔ SDK tip | omit `boundarySeq` **且无** emptySeed = tip | 仅 branch/非空 prior 传 `boundarySeq`；turn-0 不走 tip | ✅ |
| Host prior-cut retry | `boundarySeq=prior` + UI `seedMaxTurn=prior.turn` | SDK inclusive cut；MessageStore 同切 | ✅ |
| branch | `boundarySeq=目标 turn/end` + `seedMaxTurn=目标 turn` | SDK / UI 同 | ✅ |
| `emptySeed` ⊕ `boundarySeq` | 互斥 | validate 拒帧；server 抛 `INVALID_BOUNDARY` | ✅ |
| P-接续 probes | Host 决策镜像 | `pushFullState.probes` → Webview | ✅ |
| ChangeStore | 子空桶 | 无 copy 调用 | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| Multi-Tab live\|replay + `setMode`/`switchTo` | phase-1 | 冻结复用 | ✅ |
| `session/resume` Continue same-id | phase-2 | 对照未改 | ✅ |
| `panel/state.probes` + `mirrorHostDecisions` | phase-1 | GAP-CUX-002 产品推送仍接 | ✅ |
| ChangeStore per-session Map | phase-4 底座 | 未拷贝、未改分桶 | ✅ |
| Core `_forkSeed` / OPEN_TURN | core | SDK 复刻；空 seed 为显式分支 | ✅ 未放宽 aborted |

## 关键发现

### 🔴 Must-Fix
（无）— 上轮两条连通断裂均已修复并有层 B 回归覆盖。

### 🟡 Should-Fix
（无）

### 🟢 Observations
- `projectMessagesForForkSeed` 丢弃无 `turn` 的气泡；UI 专用项（如无 turn 的 change-list）不进入 seed 水合，与 SDK 日志 seed / AC-64 空桶一致，非断路。
- P-接续后首次 `pushFullState` 在 `promptTab` 之前可能短暂投影空/裁剪列表，随后 `pushAppend` 补上重发 user——顺序可观测，链路闭合。
- 层 B：`Must-Fix: turn-0…` / `Must-Fix: retry turn=1…` / AC-32 emptySeed+editedText 共 12 tests passed。

## 产出路径
`.specdev/specs/vscode-dsh-chat-ux/phases/phase-5-fork-retry-branch/review-connectivity.md`
