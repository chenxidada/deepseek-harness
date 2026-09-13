# Correctness Review — phase-5-fork-retry-branch

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**MUST-FIX**

## 逐条 AC 验证
| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-30 | 复制写入剪贴板 + `lastCopiedText` | `extension.ts` `dsh.copyToClipboard` / `lastCopiedText`；`action/copy-message` → `requestCopyMessage`；`dsh.test.lastCopiedText` | ✅ | 真实写入 clipboard + 模块级 `lastCopiedText`；层 B 经 Host `requestCopyMessage` 可观测 |
| AC-31 | 重试 → 新 id + P-接续；父 `mode→replay` + E2 | `forkFromClosedTurn` + `applyContinueSwitch` | ❌ | E2/id/active=child 正确；**无 prior 时 omit `boundarySeq` = tip fork，再 `promptTab` 重复整回合**；MessageStore 全量拷贝未按 boundary 裁剪 |
| AC-31b | 父 E2 可探针；拒假只读 | `parentReadonlySessions` / `continueSealedSessions`；`pushFullState.probes`；`continueChromeFor(continueSealed)` | ✅ | 切回父 Tab 后 `probes.parentReadonly/continueSealed=true`、Continue `disabled`+`continue-sealed`；live 无 probes（GAP-CUX-002 已填实） |
| AC-32 | 编辑重发 P-接续+E2；非 resume；无 truncate | `intent:'edit-resend'` → 同 `applyContinueSwitch` + `promptTab(editedText)` | ❌ | E2/presentation 正确且不调父 `resume`；**与 AC-31 同一 prior-cut/空 seed 缺陷**；editedText 经 child prompt 写入（偏差 3，可接受）但 tip 重复问题仍在 |
| AC-33 | 三入口共用 fork；无 truncate | `forkFromClosedTurn` × retry/edit/branch | ✅ | 三入口均 `invokeFork`→`host.forkSession`；仓库无同会话 truncate API；层 B 断言 ≥3 次 fork |
| AC-34 | 拒 aborted/open/非法 boundary + 可见原因 | `resolveClosedTurnBoundary`；banner `fork-rejected` | ✅ | `aborted`/`interrupted` → `aborted-turn`；open → `open-turn`；层 B abort 时 `forkCalls.length===0` |
| AC-60 | 分叉 P-标明；父 mode 不强制 replay | `applyBranchMark` | ✅ | 保存 `parentMode`；不写入 E2 Sets；层 B 父仍 `live`、active 无 `parentReadonly` |
| AC-61 | 非 closed 拒绝；turn/seq 先验 | 同 `resolveClosedTurnBoundary` | ✅ | seq 必须映射到正常 closed `turn/end`；非法 → `invalid-boundary` |
| AC-62 | 分叉 vs Continue 可区分 | `presentation` + banner kind | ✅ | `continue-switch` / `branch-mark`；banner `fork-continue-switch` vs `fork-branch-mark`；Continue 仍走 `session/resume` |
| AC-63 | 父子关系文案 | `parentSessionId` + `forkLabel`「派生自 …」；`forkParentTitleForActive` | ✅ | index 写入 lineage；`panel/state.forkParentTitle` |
| AC-64 | 子 Change 空桶；不 checkout；不拷贝父 index | fork 路径未碰 `changes` | ✅ | 层 B：父 1 条变更，子 `list=[]`；无 checkout 调用 |
| AC-65 | Continue same-id resume | `continueConversation` | ✅ | 前后 `sessionId` 不变；`resumeCalls=[sameId]` |
| AC-66 | P-接续不父 id resume；绑 child Tab | `applyContinueSwitch` + 无 `resumeSession` | ✅ | 层 B `resumeCalls===[]`；`switchTo(child)` |
| P2-1 | 父 running 禁 fork | `parentTab.status==='running'` | ✅ | `reason:'parent-running'` + banner |
| GAP-CUX-002 | Host 推送 probes | `hostProbesForActive` → `pushFullState.probes` | ✅ | registry 已移入「已解决」；产品路径真实下发 |
| 约束 | 无 truncate；未改 agent-loop | — | ✅ | 无 truncate 产品路径；`packages/core/agent-loop` 工作树无改动 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| GAP-CUX-002 | `chat-panel-host.pushFullState` / `continueChromeFor` | ✅ Resolved | 已解决表；Host probes + sealed 闸已接线 |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | 无空壳 `return []` / 硬编码假成功冒充 fork | — | 编排/bridge/SDK 均为真实逻辑 |

## 关键发现
### 🔴 Must-Fix
- **Retry/edit 无 prior closed turn 时 tip-fork + 再 prompt（破坏「丢弃其后并重发」）**  
  `findPriorClosedBoundary` 对 turn 0 返回 `undefined` 后，`invokeFork` **省略** `boundarySeq`。SDK `forkSeedFromParent(undefined)` 切在**最后事件**（整段 tip），随后 `promptTab` 再发同一/编辑后的 user 文本 → 子会话保留原 user+assistant 并追加重复 user。偏差 2 写明「prior（或空）」，但省略 boundary ≠ 空 seed（空 seed 当前 API 也无法表达）。单回合会话上点「重试」即踩中。  
  位置：`conversation-controller.ts` `forkFromClosedTurn` ~L811–827；`server.ts` `forkSeedFromParent`。
- **MessageStore 子投影未按 fork boundary 裁剪**  
  `applyContinueSwitch` / `applyBranchMark` 用 `messages.replace(child, parentMessages.map(...))` **全量**拷贝。即便多回合 prior-cut 的 SDK seed 正确，UI 仍展示被丢弃回合的 assistant，与 seed 不一致。  
  位置：`conversation-controller.ts` ~L868–872、L899–903。

### 🟡 Should-Fix
- **AC-32 层 B 未断言 `editedText` 实际进入 child prompt**  
  产品路径有 `promptTab(editedText)`，但测试只查 presentation/E2；建议补一层 B 断言（prompt 调用参数或子 MessageStore 末条 user 文本）。
- **UI running 闸依赖 `probes.streaming`，Host 另有 `status==='running'`**  
  Host 拒绝可靠；Webview 禁用按钮用 streaming 探针，短暂不同步时按钮仍可点（随后 Host 拒绝）。可接受但可对齐 registry status。

### 🟢 Observations
- Bridge/SDK `session/fork`、`sdkSessionFork`、`IdeSessionHost.forkSession` pending-map 与 cancel 对称，函数体完整。
- P-标明不碰父 mode / E2 Sets；P-接续强制 `replay` + sealed Continue + `sendPrompt` reject `replay` — AC-31b 真只读成立。
- Continue 对照路径未改坏（AC-65）；P-接续不调用父 `continueConversation`/`resume`（AC-66）。
- AC-64 自然成立：fork 不复制 ChangeStore；无 checkout。
- `agents.create`+seed 替代裸 `sessions.fork`（偏差 1）可产生 prompt-ready child，与 web Remote 一致，非空壳。
- 层 B `chat-ux-fork-retry-branch.spec.ts`：10 passed（本审查复跑）。

## 建议修复方向（供 implementer，非本视角实施）
1. 无 prior 时走**空 seed**（扩展 `sdkSessionFork` 显式 `emptySeed` / `agents.create({ seed: [] })`），再 `promptTab`；禁止「省略 boundarySeq = tip」。
2. 有 prior 时 MessageStore 子投影只保留 `seq/turn ≤ prior`（或从 seed/log 重投影），与 SDK cut 对齐。
3. 层 B 增加：turn-0 retry 后子 log/消息无重复 assistant；edit-resend 子末条 user = `editedText`；fork 调用的 `boundarySeq` 期望值。
