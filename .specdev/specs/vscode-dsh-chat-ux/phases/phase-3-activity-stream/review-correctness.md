# Correctness Review — Phase phase-3-activity-stream

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**PASS**

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-13c | cancel/中断时 running→aborted；不永久 running；不自动 revert | `conversation-controller.ts` `abortRunningActivities` / `markTurnIncomplete` / `cancelActiveTurn` | ✅ | `turn/end` `aborted\|interrupted` → 扫描同 turn `kind:'activity'` 且 `status==='running'` → `patch({ activityStatus:'aborted' })` + `pushPatch`。`cancelActiveTurn` 只调用 `host.cancelSession`，无 revert。层 B：`chat-ux-activity-stream.spec.ts` cancel fixture 断言两活动项 aborted、无 `change/revert-result` |
| AC-20 | live 工具活动插入对话流（非仅 Timeline） | `projectToolCallActivity` → MessageStore → `pushAppend` → Webview `renderActivityBubble` | ✅ | `onSdkNotification` `tool/call` 在 attributor 之外调用 `projectToolCallActivity`，写入 `kind:'activity'`。Provider `renderBubble` 对 activity 走 `renderActivityBubble`（`[data-kind=activity]`）。Timeline `apply` 仍并行，但对话投影独立存在。层 B 断言 `messages/append` 含 `kind:'activity'` |
| AC-21 | 默认折叠；探针可读 | `activity-dom.ts` `renderActivityBubble` | ✅ | 默认 `expanded=false` → `data-expanded=false` + `is-collapsed`；`probes.setActivity(id,{status,expanded:false})`。层 A 覆盖 |
| AC-22 | 展开可读状态；探针 expanded true | `toggleActivityExpanded` / `applyActivityExpanded` | ✅ | 切换 DOM/`aria-expanded`/body.hidden + `setActivity`/`setExpanded`。Webview 另发 `action/toggle-activity`（Host ack no-op，呈现态本地） |
| AC-23 | 同回合多活动归组 | `projectToolCallActivity` + `applyMessageIdentity` | ✅ | 同 turn 共享 `turn`/`data-turn`，`ordinal` 0-based 递增。层 A：两 activity 同 `data-turn`；层 B：ordinal `[0,1]` |
| AC-24 | 活动独立于文本 chunk | `onSdkNotification` tool 分支 vs `assistant/chunk` | ✅ | tool 投影不经 `projectAssistantChunk`。层 B：仅 tool/call、无 assistant text 仍有 activity |
| AC-25 | 变更列表与活动同组可判定 | activity + change-list 均写 `data-turn` | ✅ | 层 A：activity×2 + change-list 均 `[data-turn="3"]`。Live change-list 本就带 `turn`（既有路径） |
| AC-26 | 层 A 断言折叠/展开 | `tests/layer-a/activity-stream.spec.ts` + `activity-dom.ts` | ✅ | 抽离模块 + jsdom 用例（默认折叠、toggle、expanded 探针）。本机 Node 20 跑层 A 会因 jsdom/ESM 起不来；实现方注明需 Node 22——属环境约束，非空壳实现 |
| AC-27 | 状态机 running→done\|failed\|aborted（含 cancel→aborted） | `activityStatusFromToolResult` + `projectToolResultActivity` + `abortRunningActivities` | ✅ | `ABORTED`/`ABORTED_BEFORE_DISPATCH`→aborted；`isError`→failed；else→done。DOM `data-status` + probes。层 A 状态机 + 层 B 四段 result + cancel 收敛 |
| AC-28 | 回放重建活动；replay 禁发 | `replay-hydrator.ts` `foldActivities`；Host `sendPrompt` | ✅ | hydrate 将 activity 写入 `messages[]`；无 result + `turn/end aborted` 残留 running→aborted。`mode==='replay'` → `reject('replay')` / `ui/reject-send`。层 B 覆盖 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）

| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| GAP-CUX-001 | `probes.setActivity` / product fill | ✅ 已解决 | 活跃表已移除；已解决表记录 phase-3。产品路径：`renderActivityBubble` / `applyActivityStatus` / `applyActivityExpanded` / provider embed 均调用 `setActivity` |
| DEBT-CUX-001 | change-list/diff 内联双路径 | ⚠️ Known | 非本 Phase；不影响 activity 正确性 |
| GAP-CUX-002 | parentReadonly / continueSealed | ⚠️ Known | 目标 phase-5；非本 Phase |

### 新发现的未注册桩

| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | 无 | — | — |

说明：`action/toggle-activity` Host 侧空 return 是设计允许的呈现态 ack（非假完成桩）；展开权威在 Webview DOM + probes。

## 关键发现

### 🔴 Must-Fix
- 无

### 🟡 Should-Fix
- 无（边界均有可工作路径；层 A Node 版本约束已在 implementation 注明，不构成 AC 未满足）

### 🟢 Observations
- `hydrateFromAuthoritativeLog` 将 activity **追加**在 folded 文本消息之后（非按 seq 交织）；AC-28/23/25 以 `data-turn`/存在性判定，不要求时间序交织。
- `cancelActiveTurn` 本身不直接 abort 活动项——依赖后续 live `tool/result` 与/或 `turn/end aborted` 的 fail-closed `abortRunningActivities`（符合 exploration R11 建议）。
- `packages/core/agent-loop` 工作区与 diff 均为空改动（约束满足）。
- 层 B `chat-ux-activity-stream.spec.ts`：本环境 **5/5 passed**。层 A 需 Node ≥22（jsdom ESM）；代码路径经静态审查为真实逻辑。

## 约束核对
- Timeline 仍弱化：activity 主路径走 MessageStore/对话 DOM，未把 Timeline 当主阅读面。
- 无自动 revert：cancel 路径无 revert 调用。
- 未改 agent-loop：确认。

## 测试抽样
```text
vitest run apps/vscode-dsh/tests/chat-ux-activity-stream.spec.ts
→ 1 file / 5 tests passed
```
