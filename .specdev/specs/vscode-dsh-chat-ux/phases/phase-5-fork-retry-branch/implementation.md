# Phase 5 实现摘要 — phase-5-fork-retry-branch（MUST-FIX loop 1）

## 变更清单（文件列表）

### MUST-FIX 本轮修改
| 文件 | 说明 |
|------|------|
| `apps/vscode-dsh/src/fork/fork-orchestrator.ts` | `ForkResult.emptySeed` / `seedMaxTurn`；`buildForkResult` seedCut；`projectMessagesForForkSeed` |
| `apps/vscode-dsh/src/conversation-controller.ts` | turn=0 retry/edit → `{ emptySeed: true }`；子 MessageStore 按 `seedMaxTurn` 裁剪水合 |
| `apps/vscode-dsh/src/session-host.ts` | bridge `session/fork` 透传 `emptySeed` |
| `packages/sdk/server/src/session-fork.ts` | `SdkSessionForkOptions.emptySeed` |
| `packages/sdk/server/src/server.ts` | `forkSeedFromParent({ emptySeed })` → `seed: []`（禁止 omit= tip） |
| `packages/ide/ide-bridge/src/types.ts` | `session/fork.emptySeed` + capability 选项 |
| `packages/ide/ide-bridge/src/validate.ts` | 校验 `emptySeed`；与 `boundarySeq` 互斥 |
| `packages/ide/ide-bridge/src/index.ts` | `handleFork` 透传 `emptySeed` |
| `apps/vscode-dsh/tests/chat-ux-fork-retry-branch.spec.ts` | turn-0 emptySeed + prior-cut MessageStore + edit-resend 文本断言 |

### 既有（loop 0，仍有效）
fork-orchestrator / bridge·SDK session/fork / P-接续·P-标明 / E2 probes / AC-64 空桶 / Continue 对照 / GAP-CUX-002 — 未回退。

## Must-Fix 修复说明

### 1. turn=0 / 无 prior 的 retry·edit → 显式 `emptySeed`
- **问题**：`findPriorClosedBoundary` 为空时省略 `boundarySeq`，SDK `forkSeedFromParent(undefined)` = tip（全量父日志），再 `promptTab` 叠一轮 → 重复整回合。
- **修复**：无 prior 时调用 `invokeFork({ emptySeed: true })`；SDK / bridge 将 `emptySeed` 映射为 `agents.create({ seed: [] })`。**禁止**把「无 prior」编码成 tip-fork。有 prior 时仍传 `boundarySeq=prior.turn/end`。
- **契约**：`emptySeed` 与 `boundarySeq` 互斥（validate + server 双检）。

### 2. child MessageStore 按 seed 裁剪水合
- **问题**：`applyContinueSwitch` / `applyBranchMark` 全量拷父投影，UI 仍显示应丢弃的 assistant。
- **修复**：`projectMessagesForForkSeed`：
  - `emptySeed` → `[]`（随后 auto-prompt 只写入新 user）
  - 有 `seedMaxTurn` → 仅保留 `turn ≤ seedMaxTurn` 的气泡
  - branch：`seedMaxTurn = 目标 turn`；retry/edit prior-cut：`seedMaxTurn = prior.turn`

## 对每个验收标准的实现说明

| AC | 状态 | 说明 |
|----|:----:|------|
| AC-30 | ✅ | 未改 |
| AC-31/31b/66 | ✅ | E2/id/active 不变；**turn-0 现走 emptySeed** |
| AC-32 | ✅ | 同上 + 层 B 断言 child 末条 user = `editedText`、无父 assistant |
| AC-33/34/60–65 | ✅ | 未破坏；branch 仍 `boundarySeq=目标 turn/end` + 裁剪水合 |
| P2-1 / GAP-CUX-002 | ✅ | 未改 |
| 约束 | ✅ | 无 truncate；未改 agent-loop |

## 测试结果（命令 + 输出）

```bash
./node_modules/.bin/vitest run apps/vscode-dsh/tests/chat-ux-fork-retry-branch.spec.ts
# Test Files  1 passed (1)
# Tests  12 passed (12)

./node_modules/.bin/vitest run apps/vscode-dsh/tests/chat-ux-streaming-cancel-follow.spec.ts
# Tests  7 passed (回归)

# 合计 19 passed
```

新增回归：
- `Must-Fix: turn-0 retry uses emptySeed…` — `emptySeed: true`、无 tip `boundarySeq`、child 无父 assistant
- `Must-Fix: retry turn=1 trims MessageStore…` — `boundarySeq=3`、`seedMaxTurn=0`、丢弃 turn-1 assistant
- AC-32 补强：`editedText` 进入 child user；无父 assistant

## 偏差记录

### 偏差 1–3（loop 0，仍适用）
见 `.archive/implementation-20260911T024430Z.md`：agents.create+seed；retry prior-cut；edit 经 child prompt。

### 偏差 4（本轮澄清偏差 2）
- **偏差描述**：无 prior 时不再用「省略 boundarySeq」表达空前缀；改为显式 `emptySeed: true`。`ForkResult.boundarySeq` 在空 seed 时省略（不再用 `-1` 哨兵）。
- **影响范围**：spec.md AC-31/32；design.md AD-CUX-5；偏差 2「prior（或空）」
- **原因**：SDK omit = tip，与「空前缀 + 重发」不一致。
- **影响**：下游 / 层 B 须断言 `emptySeed`，勿假设 omit boundary = 空 seed。

## 债务

- 无新增桩；GAP-CUX-002 仍在「已解决」。
