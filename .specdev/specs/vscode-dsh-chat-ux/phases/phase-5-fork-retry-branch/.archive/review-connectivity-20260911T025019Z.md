# Connectivity Review — phase-5-fork-retry-branch

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**MUST-FIX**

## 端到端路径追踪

### Path 1: Copy（AC-30）
```
Webview 复制按钮
  → postMessage { type:'action/copy-message', messageId, text }
    → ChatPanelHost.handleWebviewMessage
      → deps.requestCopyMessage(messageId, text)          ✅ extension 接线
        → MessageStore 回退（text 空时）                  ✅
        → dsh.copyToClipboard(text)
          → vscode.env.clipboard.writeText
          → lastCopiedText = text                         ✅
          → dsh.test.lastCopiedText / getLastCopiedText() ✅ 层 B 可观测
Exit: 剪贴板 + lastCopiedText
```
**判定**: ✅ 数据路径完整

### Path 2: P-接续 retry/edit-resend（AC-31/31b/32/66）
```
Webview action/retry | action/edit-resend
  → extension requestRetry / requestEditResend
    → resolveBoundaryFromMessage (incomplete→拒)         ✅
    → forkFromClosedTurn({ intent:'retry'|'edit-resend' })
         ├─ parent.status==='running'? → reject P2-1     ✅
         ├─ resolveClosedTurnBoundary (拒 aborted/open)  ✅ 产品先验
         ├─ findPriorClosedBoundary(turn)
         │    · turn≥1 → boundarySeq=prior turn/end      ✅
         │    · turn=0 → prior 缺失 → omit boundarySeq   🔴 见 Must-Fix #1
         ├─ invokeFork → IdeSessionHost.forkSession
         │    → bridge broadcast session/fork
         │      → handleFork → sdkSessionFork.forkSession
         │        → agents.create(seed≈_forkSeed) + parentSession  ✅ 子会话可 prompt
         │        （未直调 SessionStore.fork；语义见 Observation）
         ├─ applyContinueSwitch
         │    · parent mode→replay                       ✅
         │    · continueSealedSessions + parentReadonlySessions ✅
         │    · registry.create(child,'live') + switchTo ✅ AC-66 切 child
         │    · index parentSessionId + forkLabel        ✅ AC-63
         │    · pushFullState → resolveHostProbes        ✅ GAP-CUX-002
         │    · 不调用 continueConversation/resume 父 id ✅ AC-66
         └─ promptTab(child, promptText)                 ✅ 自动重发接线
切回父 Tab → panel/state.probes.parentReadonly/continueSealed
           → Continue chrome reason=continue-sealed      ✅ AC-31b
```
**判定**: 🔴 MUST-FIX — turn=0（无 prior）时 Host/SDK 对省略 `boundarySeq` 契约断裂；其余 P-接续/E2/Tab 链路连通

### Path 3: P-标明 branch（AC-60/62/63）
```
Webview action/branch { turn }
  → forkFromClosedTurn({ intent:'branch' })
       → resolveClosedTurnBoundary → boundarySeq=目标 turn/end ✅
       → invokeFork({ boundarySeq })                         ✅
       → applyBranchMark
            · 不改 parent.mode / 不写 E2 Sets                 ✅
            · create child Tab + parentSessionId/forkLabel   ✅
            · banner kind=fork-branch-mark ≠ continue-switch ✅ AC-62
            · pushFullState；probes 不强制 parentReadonly    ✅
```
**判定**: ✅ 数据路径完整，与 P-接续分流正确

### Path 4: 非法 boundary 拒绝（AC-34/61）
```
Entry: aborted / open / 无法映射 turn|seq
  → resolveClosedTurnBoundary → ForkReject + banner      ✅
  → invokeFork 不被调用（层 B: host.forkCalls.length===0） ✅
Core SessionStore.fork 仍接受 aborted — 产品层拦截在前   ✅ 预期
UI: incomplete / parentReadonly / streaming 禁用入口     ✅ 与 Host 双闸
```
**判定**: ✅ 产品路径连通；非法请求不到达 bridge/SDK

### Path 5: ChangeStore 子空桶（AC-64）
```
fork 成功 → 新 childSessionId
  → ChangeStore 按 sessionId 分桶；无拷贝父 index 调用   ✅
  → changes.list(child)=[]；父 list 不变                 ✅
  → 无 checkout 接线                                     ✅
```
**判定**: ✅ 写后不串桶；空桶起步连通

### Path 6: Continue vs fork 对照（AC-65/66）
```
Continue:
  continueConversation → resumeSession(same id)
    → bridge session/resume → setMode(live)              ✅ same-id
P-接续:
  不走 resume；fork 新 id + switchTo(child)              ✅ 分流
层 B: host.resumeCalls=[] after retry                    ✅
```
**判定**: ✅ 两条路径契约分离、可对照

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `action/copy-message` | Webview 复制按钮 | ✅ | `requestCopyMessage` → `dsh.copyToClipboard` → `lastCopiedText` | ✅ |
| `action/retry\|edit-resend\|branch` | Webview 操作按钮 | ✅ | `extension` → `forkFromClosedTurn` | ✅ |
| `resolveClosedTurnBoundary` | `forkFromClosedTurn` | ✅ | reject banner / 合法 seq | ✅ |
| `invokeFork` | `forkFromClosedTurn` | ✅ | `IdeSessionHost.forkSession` → bridge | ✅ |
| `handleFork` | ide-bridge dispatch | ✅ | `sdkSessionFork.forkSession` | ✅ |
| `HarnessSdkJsonRpcServer.forkSession` | Cordis `sdkSessionFork` | ✅ | `agents.create` + `forkSeedFromParent` | ✅ |
| `applyContinueSwitch` | retry/edit 成功后 | ✅ | registry / Sets / index / `pushFullState` / `promptTab` | ✅ |
| `applyBranchMark` | branch 成功后 | ✅ | registry / index / banner（不碰 E2） | ✅ |
| `hostProbesForActive` | `resolveHostProbes` ← `pushFullState` | ✅ | Webview `mirrorHostDecisions` | ✅ |
| `continueChromeFor(..., continueSealed)` | `continueChromeForTab` | ✅ | panel/state.continue disabled | ✅ |
| turn=0 retry `omit boundarySeq` | `findPriorClosedBoundary` 空 | 🔴 | SDK「omit = last event」≠ 空 seed | 🔴 |
| child `messages.replace(全量父投影)` | apply* | ⚠️ | 与 SDK seed 切分不对齐 | ⚠️ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| Host `forkSession` ↔ bridge `session/fork` | `{ parentSessionId, boundarySeq?, childSessionId? }` | 同名字段 + validate | ✅ |
| bridge ↔ `sdkSessionFork` | `forkSession(parent, { boundarySeq?, childSessionId? })` | `SdkSessionFork` 同契约 | ✅ |
| Host omit `boundarySeq`（无 prior / turn=0 retry） | 空前缀 seed（偏差 2「或空」） | SDK `forkSeedFromParent(undefined)` = **last event 全量** | 🔴 |
| Host `boundarySeq=prior`（turn≥1 retry） | seed 截止 prior turn/end | SDK inclusive cut + OPEN_TURN 检查 | ✅ |
| branch `boundarySeq=目标 turn/end` | seed 含该 closed turn | SDK 同 | ✅ |
| P-接续 E2 probes | Host 决策镜像 | `pushFullState.probes` → `mirrorHostDecisions` | ✅ |
| Continue sealed | sealed 时禁用 | `continue-capability` + controller 双检 | ✅ |
| ChangeStore | 子空桶、不拷父 | 无 copy 调用；按 id 分桶 | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| Multi-Tab live\|replay + `setMode`/`switchTo` | 既有 / phase-1 | 冻结复用 | ✅ |
| `session/cancel` pending-map 模式 | phase-2 | fork 镜像同形 | ✅ |
| `session/resume` Continue same-id | phase-2 / Continue | 对照路径未改语义 | ✅ |
| `panel/state.probes` seats + `mirrorHostDecisions` | phase-1 | GAP-CUX-002 产品推送已接 | ✅ |
| ChangeStore per-session Map | phase-4 底座 | 未拷贝、未改分桶契约 | ✅ |
| Core `SessionStore.fork` OPEN_TURN | core | SDK 复刻 `_forkSeed`；产品拒 aborted | ✅ 未放宽 |

## 关键发现

### 🔴 Must-Fix
- **Host↔SDK：`boundarySeq` 省略语义不一致（turn=0 / 无 prior 的 retry·edit）**  
  `forkFromClosedTurn` 在 `findPriorClosedBoundary` 为空时调用 `invokeFork(parent, {})`（省略 `boundarySeq`）。  
  `forkSeedFromParent(parent, undefined)` 将边界定为 **父日志最后一事件**，子 seed = 全量父前缀（含正被「重试」的 turn），随后 `promptTab` 再发一轮 → seed 与产品「空前缀 + 重发」意图断裂。  
  契约应对齐为显式空 seed（或专用 sentinel），禁止把「无 prior」编码成 SDK 的「fork-at-end」。层 B 当前 mock `forkSession` 且未断言传入的 `boundarySeq`，未覆盖此断裂。

### 🟡 Should-Fix
- **Child MessageStore 未按 seed 切分水合**：`applyContinueSwitch` / `applyBranchMark` 将**全量**父 `messages` `replace` 到 child，而 SDK seed 已按 boundary 截断（retry 更是 prior-cut）。UI 投影与 SDK 日志源未连通；建议改为按 `boundarySeq` / 子 session log 水合，避免子 Tab 展示 seed 外回合。

### 🟢 Observations
- `sdkSessionFork` 走 `agents.create` + `forkSeedFromParent`（等价 `_forkSeed` + lineage），非直调 `sessions.fork`；与 implementer 偏差 1 一致，bridge→SDK→prompt-ready child 仍连通。
- P-接续后首次 `pushFullState` 活动 Tab 为 child（无父 probes）；切回父 Tab 后 probes/Continue sealed 完整下发——与层 B 断言方式一致，非断路。
- Webview 入口用 `probes.streaming` 禁按钮，Host 用 `registry.status==='running'` 拒绝；双闸并存，权威在 Host。
- Continue（`session/resume` same-id）与 fork（新 id + 切 Tab）对照路径清晰，无交叉调用。

## 产出路径
`.specdev/specs/vscode-dsh-chat-ux/phases/phase-5-fork-retry-branch/review-connectivity.md`
