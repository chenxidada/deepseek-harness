# Correctness Review — phase-5-fork-retry-branch（MUST-FIX 复审）

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**PASS**

## Must-Fix 关闭核对

| # | 原缺陷 | 修复证据 | 状态 |
|---|--------|---------|:----:|
| 1 | turn=0 / 无 prior 省略 `boundarySeq` → tip-fork + `promptTab` 叠回合 | `forkFromClosedTurn`：`prior === undefined` → `{ emptySeed: true }`；SDK `forkSeedFromParent`：`emptySeed` → `seed: []`；validate/server 与 `boundarySeq` 互斥 | ✅ 关闭 |
| 2 | MessageStore 全量拷父 | `applyContinueSwitch` / `applyBranchMark` → `projectMessagesForForkSeed`（`emptySeed`→`[]`；有 `seedMaxTurn`→`turn ≤ seedMaxTurn`） | ✅ 关闭 |

层 B 新增回归均绿：`Must-Fix: turn-0 retry uses emptySeed…`、`Must-Fix: retry turn=1 trims MessageStore…`；AC-32 断言 `editedText` + 无父 assistant。套件 **12 passed**。

## 逐条 AC 验证
| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-30 | 复制写入剪贴板 + `lastCopiedText` | `extension.ts` / `action/copy-message` | ✅ | 未回退；真实 clipboard + 可观测出口 |
| AC-31 | 重试 → 新 id + P-接续；父 E2 | `forkFromClosedTurn` + `applyContinueSwitch` | ✅ | turn-0 现走 `emptySeed`，再 `promptTab`；有 prior 时 `boundarySeq=prior` + `seedMaxTurn=prior.turn` |
| AC-31b | 父 E2 可探针；拒假只读 | `parentReadonlySessions` / `continueSealedSessions` / probes | ✅ | P-接续写入 Sets；切回父可探针；GAP-CUX-002 仍为已解决 |
| AC-32 | 编辑重发 P-接续+E2；非 resume | `intent:'edit-resend'` + `promptTab(editedText)` | ✅ | turn-0 `emptySeed`；层 B：`lastUser.text==='new text'`、无 assistant |
| AC-33 | 三入口共用 fork；无 truncate | retry/edit/branch → `invokeFork` | ✅ | 层 B ≥3 次 fork；无同会话 truncate API（仅 timeline 文案 `truncate`） |
| AC-34 | 拒 aborted/open/非法 boundary | `resolveClosedTurnBoundary` | ✅ | aborted → `aborted-turn`；`forkCalls.length===0` |
| AC-60 | 分叉 P-标明；父 mode 不强制 replay | `applyBranchMark` | ✅ | 父仍 `live`；active 无 `parentReadonly`；`seedMaxTurn=目标 turn` 裁剪水合 |
| AC-61 | 非 closed 拒绝；turn/seq 先验 | 同 `resolveClosedTurnBoundary` | ✅ | 非法 → `invalid-boundary` |
| AC-62 | 分叉 vs Continue 可区分 | presentation + banner | ✅ | `continue-switch` / `branch-mark`；Continue 仍 `session/resume` |
| AC-63 | 父子关系文案 | `parentSessionId` + `forkLabel` | ✅ | 「派生自 …」+ `forkParentTitleForActive` |
| AC-64 | 子 Change 空桶；不 checkout | fork 路径未碰 `changes` | ✅ | 层 B：子 `list=[]`；父仍 1 条 |
| AC-65 | Continue same-id resume | `continueConversation` | ✅ | `resumeCalls=[sameId]`；sessionId 不变 |
| AC-66 | P-接续不父 id resume；绑 child | `applyContinueSwitch` + 无 `resumeSession` | ✅ | `switchTo(child)`；不调父 resume |
| P2-1 | 父 running 禁 fork | `parentTab.status==='running'` | ✅ | `reason:'parent-running'` |
| GAP-CUX-002 | Host 推送 probes | `hostProbesForActive` → `pushFullState` | ✅ | registry 已解决；产品路径真实下发 |
| 约束 | 无 truncate；未改 agent-loop | — | ✅ | 工作树无 `packages/core/agent-loop` 改动；无 session truncate |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| GAP-CUX-002 | Host probes / sealed Continue | ✅ Resolved | 已解决表；本轮未回退 |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | 无 | — | emptySeed / projectMessagesForForkSeed / SDK fork 均为真实逻辑 |

## 关键发现
### 🔴 Must-Fix
- （无 — 上轮两条均已关闭）

### 🟡 Should-Fix
- （无阻塞级边界缺口；上轮 AC-32 editedText 层 B 断言已补齐）

### 🟢 Observations
- `emptySeed` 与 `boundarySeq` 在 bridge validate + SDK `forkSession` 双检互斥，避免再把 omit 误当成空 seed。
- prior-cut：`seedMaxTurn = prior.turn` 与 SDK `boundarySeq = prior.turn/end` 对齐；auto-prompt 只重发目标回合 user。
- branch：`seedMaxTurn = resolved.turn`（含目标回合），与「在该 closed turn 处分叉」一致。
- P-标明不写入 E2 Sets；Continue 对照路径未改坏；AC-64 自然空桶成立。

## 复审结论
上轮 MUST-FIX（emptySeed 契约 + MessageStore 按 seed 裁剪）已在产品路径与层 B 同时落地；其余 AC / 非破坏项保持成立。**PASS**。
