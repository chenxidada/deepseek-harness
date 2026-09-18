# Phase 2 实现摘要 — 会话/聊天主链路与模型往返能力真机驱动

## 变更清单

| 文件 | 改动 | 归属 |
|------|------|------|
| `apps/vscode-dsh/test-scripts/layer-v-capabilities.json` | 补全 §12.3（9 项）/ §12.8（2 项）/ §12.9（3 项）共 14 项能力的 `steps` 与断言（+119/−34）；#18/#20/#21 `stream` 步补 `requireIncrement:true` + 四行分段提示词 | 工作 1 |
| `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs` | 新增 `$assistantClosed` matcher（`$assistantContains` + 关闭轮门控）；`poll` 超时携带 `lastObserved` 投影（+181） | 工作 3 |
| `apps/vscode-dsh/src/extension.ts` | 新增 `dsh.test.forkRetry` / `dsh.test.forkBranch` / `dsh.test.forkEditResend` 测试钩子 + `parseForkTestRequest` 参数解析（+91） | 工作 2 |
| `apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh` | 补 `--capability <id>` 分组选择 + 凭证门控前置（+65） | 工作 3（支撑） |
| `apps/vscode-dsh/tests/layer-v-capability-runner.spec.ts` | 新增 `$assistantClosed` matcher 单元测试（流式活跃时拒绝匹配）（新增 +148） | 测试 |
| `packages/sdk/server/src/server.ts` | `forkSession` 修复：`this.ctx.sessions` → `this.sessions`；`createForkedSession` 从父 Agent 继承 `agentPreset`（`composeFrom` + `meta.agentPreset`）（+24） | 分叉钩子的前置修复 |
| `packages/sdk/server/tests/server.spec.ts` | 新增 `forkSession` 三个测试（live parent 派生 + 不存在的 parent 拒绝 + agentPreset 继承） | 测试 |

> `packages/sdk/server/lib/` 为构建产物（gitignore），不在提交清单内；E2E 走 source-launch（tsx）路径，源码修复即生效。

## 14 项能力逐项 AC 对照

| # | capability id | group | requiresModel | ac | 结论 | 关键端到端断言 |
|---|---------------|-------|:---:|---|:--:|------|
| 13 | cap-extension-activate | session-main-path | false | AC-7/10 | ✅ PASS | `activate` 返回 + `startState:started` + `hostStatus:connected` |
| 14 | cap-auto-start-orchestrator | session-main-path | true | AC-7/9/10 | ✅ PASS | 真实 marker 往返 `LAYER-V-CAP-14-OK` |
| 15 | cap-auto-ready-coordinator | session-main-path | true | AC-7/9/10 | ✅ PASS | 真实 marker 往返 `LAYER-V-CAP-15-OK` |
| 16 | cap-conversation-controller | session-main-path | true | AC-7/9/10 | ✅ PASS | 真实 marker 往返 `LAYER-V-CAP-16-OK` |
| 17 | cap-prompt-active | session-main-path | true | AC-7/9/10 | ✅ PASS | 真实 marker 往返 `LAYER-V-CAP-17-OK` |
| 18 | cap-message-store-stream-patch | session-main-path | true | AC-7/9/10 | ✅ PASS | 流式增量（`sawStreaming`/`sawGrowth`）+ marker `LAYER-V-CAP-18-OK` |
| 19 | cap-push-full-state | session-main-path | true | AC-7/9/10 | ✅ PASS | 真实 marker 往返 `LAYER-V-CAP-19-OK` |
| 20 | cap-messages-protocol | session-main-path | true | AC-7/9/10 | ✅ PASS | 流式增量（`sawStreaming`/`sawGrowth`）+ marker `LAYER-V-CAP-20-OK` |
| 21 | cap-host-send-stream | session-main-path | true | AC-7/9/10 | ✅ PASS | 流式增量 + marker `LAYER-V-CAP-21-OK` |
| 32 | cap-fork-boundary-parse | fork | true | AC-9/10 | ✅ PASS | `forkBranch` 返回 childSessionId + `presentation:branch-mark` |
| 33 | cap-fork-from-closed-turn | fork | true | AC-9/10 | ❌ LINK_FAILURE | `fork-retry` PASS，但 `child-replied` 超时（见偏差记录） |
| 34 | cap-continue-capability-probe | continue | true | AC-9/10 | ✅ PASS | replay Tab 打开 + Continue 能力探测 |
| 35 | cap-continue-chrome | continue | true | AC-9/10 | ✅ PASS | Continue chrome 生成 + 真实 marker 往返 |
| 36 | cap-continue-conversation | continue | true | AC-9/10 | ✅ PASS | `continueConversation` 真实 marker 往返 |

**总计：13/14 PASS，1 LINK_FAILURE（`cap-fork-from-closed-turn` 的 `child-replied` 步）。**

## 对每个验收标准的实现说明

### AC-7（操作序列 + 截图 + 断言，覆盖会话/聊天主链路，不覆盖 thin HTML）
- 14 项能力全部补齐「发 marker 提示 → poll `dsh.test.panelSnapshot()` → 断言 assistant text 含 marker」的完整操作序列，每项末尾带 `screenshot` 步，截图落盘 `apps/vscode-dsh/test-artifacts/layer-v-capabilities/`。
- `requiresModel:true` 的能力全部走 `dsh.test.sendPrompt`（真实模型），未用 `injectAssistant` / `answerApproval` 作模型往返等价验收。
- 流式能力（#18/#20/#21）用 `stream` 步，三处均显式设 `requireIncrement:true`，并要求模型「四行分段输出」以放慢流式节奏，使 150ms 轮询能稳定捕获 `streaming:true` 或 assistant text 长度增长。

### AC-8（过时功能不覆盖，列入过时功能清单）
- manifest 不含 `buildThinChatHtml` 对应能力、不含 Tier-3 全文搜索对应能力（见下方过时功能清单）。

### AC-9（真实模型往返 + fail-closed 凭证门控）
- 13 项 `requiresModel:true` 能力均走真实 `DEEPSEEK_API_KEY`；`cap-fork-from-closed-turn` 的 fork-retry 分叉也真实触发模型（见偏差）。
- 无 key 分支：`runManifest` 的凭证门控对 `requiresModel:true && !hasCredential` 记 `SKIPPED_NO_CREDENTIALS`（exit 3），不执行、不记 PASS（见 `capability-runner.cjs:847-863`）。

### AC-10（每项 ≥1 条可独立判定的端到端断言）
- 每项至少 1 条 marker 断言（`$assistantContains:` / `$assistantClosed:` / `stream` 步），可独立判定 ✅/❌，覆盖「操作 → 真实响应 → 截图」完整数据路径。
- `$assistantClosed:` matcher 额外要求「无 assistant 消息仍在 streaming」，避免分叉在 turn 未关闭时被误触发。

## 过时功能清单（AC-8）

| 过时功能 | 位置 | 处理 |
|---------|------|------|
| thin HTML（`buildThinChatHtml`） | `chat-panel-provider.ts:190` `@deprecated` | 不建立闭环覆盖；manifest 无对应能力 |
| Tier-3 全文搜索 | `session-search.ts:136` | 不建立闭环覆盖；manifest 仅覆盖 Tier-1 字段匹配（`cap-tier1-field-match`，非本 Phase 范围） |
| 侧栏可写面（被 React SPA 替代） | — | 不覆盖 |

## 真实往返证据（AC-9）

带 key 真机跑 `run-layer-v-capabilities.sh --capability session-main-path --capability fork --capability continue`：

- 13 项 PASS 的 `requiresModel` 能力，journal 记录真实 `send-prompt` → `wait` marker 往返（非注入）；`layer-v-capabilities-status.json` 的 `index.sessions` 中每项会话的 `firstUserPreview` 均含真实 `LAYER-V-CAP-NN-OK` 提示词。
- 流式能力（#18/#20/#21）在 `stream` 步记录了 `sawStreaming` / `sawGrowth` 增量证据（真机复验三项均 `sawStreaming:true, sawGrowth:true`）。
- 截图产出到 `apps/vscode-dsh/test-artifacts/layer-v-capabilities/`（如 `cap-fork-boundary-parse.png`、`cap-continue-conversation.png` 等）。
- 无 key 分支：凭证门控 fail-closed → exit 3 `SKIPPED_NO_CREDENTIALS`（见 `capability-runner.cjs` 凭证门控 + `run-layer-v-capabilities.sh` 凭证探测）。

## 偏差记录

### 偏差 1：`cap-fork-from-closed-turn` 的 `child-replied` 步 LINK_FAILURE（真机实测）

- **偏差描述**：`fork-retry` 步 PASS（分叉成功、返回 `childSessionId` + `promptText`），但 `child-replied` 步（`wait $assistantClosed:LAYER-V-CAP-33-OK`）300s 超时。子会话 `lastObserved` 显示其为 `mode:live`，首条 user 消息是注入的 `<system-reminder>`（skill 列表）而非重发的 marker 提示词，assistant 进入自主 SpecDev 编排（读 active-workflow、连续调用 bash、跑完 14+ 个工具调用），从未回显 `LAYER-V-CAP-33-OK`。
- **影响范围**：spec.md §12.8（#33「从闭合轮分叉」）、AC-9/AC-10（本项能力的「真实回复含 marker」断言）。
- **原因**：本 Phase 测试环境由 `run-layer-v-capabilities.sh` 挂载 shadow preset `specdev-orchestrator`（`layer-v-shadow-preset.sh`，即 shipped preset 删掉 `orchestrator-tool-policy` 两行）。该 preset 是**自主编排 persona**。`forkFromClosedTurn({intent:'retry'})` 对 turn 1 采用 `emptySeed:true` 派生（无 prior 边界），`createForkedSession` 用空 seed 创建子 Agent；子 Agent 因 preset 的自主编排语义在**收到 retry 提示词之前**即自启动一轮「无任务 → 检查活跃工作流 → 继续 SpecDev」，导致 retry 提示词成为排队中的后续输入而非触发首轮回复的输入。父会话之所以能正常回显 marker，是因为父会话首轮 loop 由显式 `sendPrompt` 触发，直接回答该条强指令。
- **影响**：这是**产品级行为**（emptySeed 分叉 + 自主编排 preset 的 loop 自启动交互），非测试基础设施缺陷。修复需二选一：(a) 为分叉测试换用非自主 preset（但 shadow preset 全局挂载，改动面大）；或 (b) 产品层调整「emptySeed 分叉不自动启动 loop / retry 提示词作为 seed 首消息投递」。两者均超出本 Phase「测试基础设施」scope，已登记为 DEBT-2（目标 Phase 5 或后续专门处理）。本项能力在 HG-3 时需用户显式决策：接受「fork-retry 分叉成功 + 子会话真实模型往返（自主编排）已达成 AC-9，但 marker 回显断言不成立」，还是要求修复后重验。

## 审查修复回路（SHOULD-FIX ×2 + 文档保真 ×2）

本 Phase 首轮审查（review-correctness）判决 SHOULD-FIX（2 项 Should-Fix + 2 项文档保真）。本回路修复如下：

### SHOULD-FIX #1：让流式增量真正可验证
- `layer-v-capabilities.json` 中 #18/#20/#21 三处 `stream` 步显式补 `requireIncrement:true`（原缺省时 `record.ok = !requireIncrement || incrementObserved` 恒真、不强制增量）。
- 三处能力提示词由「单行 marker 回复」改为「四行分段输出」指令，放慢流式节奏，使 150ms 轮询能稳定捕获中间态（`streaming:true` 或 assistant text 增长）。
- **真机复验**（带 key，三项能力单跑）：三项均 PASS，`sawStreaming:true, sawGrowth:true`（#20/#21 原为 `sawStreaming:false, sawGrowth:false`）。分段指令生效，未需调整 `pollForStream` 轮询间隔。

### SHOULD-FIX #2：补 agentPreset 继承分支测试
- `server.spec.ts` 新增「inherits the parent agentPreset when forking a live parent」：mock `agentPresets` 服务（`composedPreset`/`composeFrom`），断言 fork 后 `composedPreset(parentAgent.ctx)` 被调用、`create` 收到 `meta.agentPreset`、`composeFrom(childCtx, parentAgent.ctx)` 被调用。覆盖 `server.ts` `createForkedSession` 的预设继承分支。

### 文档保真 #1：§14 表格 #32 `branch-switch` → `branch-mark`
- 已修正（`presentationForIntent` 对 `branch` 实际返回 `branch-mark`，manifest #32 断言亦为 `branch-mark`）。

### 文档保真 #2：§AC-7 `requireIncrement:true` 陈述
- SHOULD-FIX #1 落地后，manifest 三处 `stream` 步确带 `requireIncrement:true`，§AC-7 原陈述由「#18/#21」更正为「#18/#20/#21 + 四行分段指令」，与交付物一致。

## 测试结果

| 命令 | 结果 |
|------|------|
| `vitest run packages/sdk/server/tests/server.spec.ts` | ✅ 全过 37 例（含 fork 三个测试：live parent 派生 / 不存在 parent 拒绝 / agentPreset 继承） |
| `vitest run apps/vscode-dsh/tests/layer-v-capability-runner.spec.ts` | ✅ 全过 30 例（含 `$assistantClosed` matcher + `requireIncrement` 增量门控测试） |
| `run-layer-v-capabilities.sh --capability session-main-path --capability fork --capability continue`（带 key） | 13 PASS + 1 LINK_FAILURE（`cap-fork-from-closed-turn`，exit 1） |
| `run-layer-v-capabilities.sh --capability cap-message-store-stream-patch --capability cap-messages-protocol --capability cap-host-send-stream`（带 key，修复回路复验） | 3 PASS（#18/#20/#21 均 `sawStreaming:true, sawGrowth:true`，exit 0） |
| 无 key 凭证门控路径 | `requiresModel:true` → `SKIPPED_NO_CREDENTIALS`（exit 3） |

## 债务登记

- 新增 DEBT-2（见 `tech-debt-registry.md`）：emptySeed 分叉 + `specdev-orchestrator` 自主 preset 的 loop 自启动导致 fork-retry marker 回显不可达成。
- DEBT-1（Phase 1 镜像原语，目标 phase-5）本 Phase 不处理（spec 明确）。
