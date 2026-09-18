# Phase 2 验证报告 — 会话/聊天主链路与模型往返能力真机驱动

## 判决：PARTIAL

## 验证结论概要

本 Phase 覆盖 14 项能力的真机 EDH 驱动（§12.3 九项 + §12.8 二项 + §12.9 三项）。独立验证结论如下：

1. **分支与合规**：确认工作分支为 `impl-phase-2-session-main-path-llm`；改动均在 `impl-*` 分支。
2. **单元测试**：`server.spec.ts` 37 例全过、`layer-v-capability-runner.spec.ts` 30 例全过（独立复跑确认）。
3. **13/14 能力通过真实 LLM 端到端验证**（marker 往返），**#33 `cap-fork-from-closed-turn` 如实 LINK_FAILURE**（`child-replied` 超时），与 DEBT-2 描述一致，用户已接受。
4. **流式增量独立复验发现 #18 波动**：`cap-message-store-stream-patch` 的 `sawStreaming`/`sawGrowth` 在较早完整 run 为 `true`、在最新完整 run（runId `20260918T122452Z-1400184`）为 `false`（`stream settled but no incremental state was observed`）。`requireIncrement:true` 机制本身正确工作（真实捕获无增量，**非假阳性**），但暴露 #18 流式增量在完整 14 项 run 中**不可稳定观测**。#20/#21 流式增量稳定为 `true`。
5. **判定依据**：按调度者给定判决标准——「#18/#20/#21 流式增量仍为假阳性，或有其他未登记的缺陷 → 判 FAIL/PARTIAL」。独立复验发现 #18 流式增量跨 run 波动属**未登记缺陷**（已登记 DEBT-3），故判 **PARTIAL** 而非 PASS。

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-7/9/10：14 项能力真机驱动（带 key，较早完整 run） | spec | `run-layer-v-capabilities.sh --capability session-main-path --capability fork --capability continue` | ✅ 13 PASS + #33 LINK_FAILURE | 较早 run（宿主 pid 1159169，12:07:29–12:13:05Z，conclusion LINK_FAILURE）；本次读到的 14 项 status 中 13 项 PASS，13 张截图（20:07–20:13 本地）留存；该 status 随后被本轮复跑覆盖 |
| AC-7/9/10：14 项能力真机驱动（带 key，verifier 独立复跑） | verifier | 同上（最新 run，runId `20260918T122452Z-1400184`） | ⚠️ 9 PASS + #18 LINK_FAILURE + #33 中断 | 最新 journal（`layer-v-capabilities-journal.jsonl`）+ plan.json |
| AC-9：流式增量 #18/#20/#21（独立复验） | verifier | 见「流式增量复验」 | ⚠️ #18 波动、#20/#21 稳定 | journal 第 43/59/67 行 |
| AC-9：无 key fail-closed | spec | `env -u DEEPSEEK_API_KEY run-layer-v-capabilities.sh --capability <model-gated>` | ✅ exit 3 `SKIPPED_NO_CREDENTIALS` | `summary.json`（runId `20260918T121408Z-1248271`，exitCode 3） |
| 单元测试 | verifier | `vitest run packages/sdk/server/tests/server.spec.ts` | ✅ 37/37 | 20:30:54 运行输出 |
| 单元测试 | verifier | `vitest run apps/vscode-dsh/tests/layer-v-capability-runner.spec.ts` | ✅ 30/30 | 20:30:54 运行输出 |
| AC-8：manifest 无 thin HTML / Tier-3 | verifier | 静态检查 `layer-v-capabilities.json` | ✅ 无对应能力 | manifest 全文（41 项，本 Phase 14 项） |
| AC-7：`dsh.test.fork*` 钩子存在 | verifier | 静态检查 `src/extension.ts` | ✅ 存在 | `shouldRegisterTestHooks` 块 |

## 逐 AC 对照

### AC-7（14 项能力执行操作序列 + 截图 + 断言，覆盖会话/聊天主链路，不覆盖 thin HTML）

- **覆盖范围**：manifest 中 `session-main-path`（9 项）+ `fork`（2 项）+ `continue`（3 项）= 14 项，与 §12.3/§12.8/§12.9 一一对应。✅
- **操作序列 + 截图 + 断言**：每项含 `command/assert/wait/stream` 步 + 末尾 `screenshot` 步，截图落盘 `test-artifacts/layer-v-capabilities/`（已核验 13 张新鲜 PNG）。✅
- **不覆盖 thin HTML**：manifest 无 `buildThinChatHtml` 对应能力。✅
- **结论**：✅ 满足。但注意 #18 流式断言在最新 run 中未通过（见 AC-9/流式增量复验）。

### AC-8（过时功能不覆盖 + 过时功能清单）

- manifest 不含 `buildThinChatHtml` / Tier-3 全文搜索对应能力；`implementation.md` §过时功能清单列出 thin HTML（`chat-panel-provider.ts:190`）、Tier-3（`session-search.ts:136`）、侧栏可写面。✅

### AC-9（真实模型往返 + fail-closed 凭证门控）

- **真实模型**：13 项 `requiresModel:true` 能力走 `dsh.test.sendPrompt` 真实往返；journal 无 `injectAssistant` / `answerApproval`（反注入审计通过）。✅
- **无 key fail-closed**：`summary.json` 记录 `SKIPPED_NO_CREDENTIALS` + exitCode 3（runId `20260918T121408Z-1248271`）。✅
- **流式增量真实**：#20/#21 `sawStreaming:true, sawGrowth:true`（稳定）；**#18 波动**（见下）。⚠️

### AC-10（每项 ≥1 条可独立判定的端到端断言）

- 每项含 marker 断言（`$assistantContains:` / `$assistantClosed:` / `stream` 步），覆盖「操作 → 真实响应 → 截图」完整数据路径。✅
- #33 的 `child-replied` 断言（`$assistantClosed:LAYER-V-CAP-33-OK`）如实超时，未以 DOM/HTTP 弱证据冒充。✅

## 流式增量复验（本 Phase 核心关注点）

调度者要求独立复验 #18/#20/#21 的 `sawStreaming`/`sawGrowth`，不能只信 implementer 报告。独立证据如下：

| 能力 | 较早完整 run（12:07–12:13Z） | 最新完整 run（`122452Z-1400184`） | 判定 |
|------|:--:|:--:|:--:|
| #18 `cap-message-store-stream-patch` | sawStreaming=true, sawGrowth=true | **sawStreaming=false, sawGrowth=false（LINK_FAILURE）** | ⚠️ 波动 |
| #20 `cap-messages-protocol` | sawStreaming=true, sawGrowth=true | sawStreaming=true, sawGrowth=true | ✅ 稳定 |
| #21 `cap-host-send-stream` | sawStreaming=true, sawGrowth=true | sawStreaming=true, sawGrowth=true | ✅ 稳定 |

**#18 最新 run 失败详情**（journal 第 43 行）：

```
{"capability":"cap-message-store-stream-patch","step":"streamed-message","kind":"stream",
 "verdict":"LINK_FAILURE",
 "detail":"stream settled but no incremental state was observed (sawStreaming=false, sawGrowth=false) at \"streamed-message\""}
```

**关键判断**：`requireIncrement:true` 机制**正确工作**——它真实捕获了「无增量被观测」，而非以最终 marker 冒充流式（**非假阳性**）。这恰恰证明 implementer 引入的防假阳性门控是有效的。但同一能力在另一 run 中又观测到增量，说明 #18 的流式响应节奏在完整 14 项 run 中**时序敏感**：偶发快到 150ms 轮询无法捕获中间态。因此「三项均 sawStreaming/sawGrowth=true」的修复声明**不可在完整 run 中稳定复现**。

## 独立验证场景（verifier 自行设计）

| 场景 | 命令/方法 | 结果 |
|------|------|:--:|
| 启动自清理协议 | 归档旧 `verification.md` → `.archive/`（本次为首次，无旧产物） | ✅ |
| 独立断言脚本（落盘） | `test-scripts/verifier-independent-phase2.mjs`（校验 14 项 = 13 PASS + #33 LINK_FAILURE + 流式增量 + 反注入；`node --check` 通过） | ✅ |
| 反注入审计 | grep journal 全量：无 `injectAssistant` / `answerApproval` | ✅ |
| 流式增量跨 run 对照 | 对比两次 run 的 #18/#20/#21 增量状态 | ⚠️ 发现 #18 波动 |

## #33 与 DEBT-2 一致性核对

- **DEBT-2 描述**：`forkFromClosedTurn({intent:'retry'})` 对 turn 1 用 `emptySeed:true` 派生；shadow preset `specdev-orchestrator` 自主编排使子 Agent 在收到 retry 提示词前自启动 loop，导致 `child-replied`（`$assistantClosed:LAYER-V-CAP-33-OK`）超时。
- **最新 journal 实测**（runId `122452Z-1400184`）：#33 的 `closed-turn` 步 PASS、`fork-retry` 步 PASS（`dsh.test.forkRetry` 分叉成功、返回 `childSessionId` + `promptText`），随后进入 `child-replied` 步（300s 超时），journal 在此步后中断——**与 DEBT-2「分叉成功但 marker 回显不可达成」一致，未谎报**。✅
- **登记状态**：DEBT-2 已登记（🟡非阻塞，目标 phase-5），用户已接受 13/14 交付。✅

## 残余风险

| 风险 | 严重性 | 阻塞 HG-3 | 说明 |
|------|:--:|:--:|------|
| #18 流式增量跨 run 波动（`sawStreaming`/`sawGrowth` 在完整 run 中偶发不可观测） | 🟡 MEDIUM | 否（已登记 DEBT-3） | `requireIncrement:true` 正确工作、非假阳性；但「三项均 true」不可稳定复现，需在后续 run 关注时序或调轮询粒度 |
| #33 `child-replied` 超时 | 🟡 MEDIUM | 否（DEBT-2 已登记，用户接受） | emptySeed 分叉 + 自主编排 preset，属产品级行为，目标 phase-5 |
| 最新 run 在 #33 步中断，未产出完整 status.json | 🟢 LOW | 否 | #34/#35/#36 已在较早完整 run 中 PASS，不缺失验证证据 |

## 主动问题上报（为何不是 PASS）

1. **AC-9 流式增量 #18 波动**（MEDIUM）：独立真机复验发现 `cap-message-store-stream-patch` 的 `sawStreaming`/`sawGrowth` 在最新完整 run 中为 `false`（`stream settled but no incremental state was observed`），与 implementer「三项均 true」的声明不符（该声明仅在隔离 3 项 run 中成立）。#20/#21 稳定。此属未登记的时序敏感缺陷，已登记 DEBT-3。→ 因此判决非 PASS。
2. **#33 LINK_FAILURE**（已知，DEBT-2）：如实记录，非本 Phase 范围，用户已接受，不单独导致降级。
3. **最新 run 中断**（LOW）：不影响判决，但说明流式增量在完整 run 上下文中的可观测性需要更稳健的验证策略。

## Pipeline 合规检查

- ✅ 所有非 specs 文件变更均在 `impl-phase-2-session-main-path-llm` 分支（`git branch --show-current` 确认）。
- ✅ 未执行任何修改仓库状态的 git 命令；未修改 `current-status.json`；未修改产品代码。
- ✅ 新增债务 DEBT-3 已登记至 `tech-debt-registry.md`（verifier 职责内，非代码改动）。

## 验证脚本

- 落盘：`.specdev/specs/vscode-dsh-e2e-closure/phases/phase-2-session-main-path-llm/test-scripts/verifier-independent-phase2.mjs`
- 用途：对 `layer-v-capabilities-status.json` 做独立断言（14 项 = 13 PASS + #33 LINK_FAILURE + #18/#20/#21 流式增量 + 反注入），`node --check` 语法通过。
