# Correctness Review — Phase 2（修复回路复审）

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**PASS**

> 本轮为 SHOULD-FIX 修复回路复审。上一轮判决 SHOULD-FIX（2 项 Should-Fix + 2 项文档保真），implementer 已修复。本复审聚焦这 4 项修复点，逐项核实。

## 上轮修复点逐项核实

| 修复点 | 上轮状态 | 本轮核实 | 判定 |
|-------|---------|---------|:--:|
| Should-Fix #1：manifest #18/#20/#21 补 `requireIncrement:true` | ❌ 三处均缺省 | `layer-v-capabilities.json:267`/`:307`/`:325` 三处 `stream` 步均含 `requireIncrement: true` | ✅ 已修复 |
| Should-Fix #1：提示词改「四行分段输出」 | ❌ 单行 marker | 三处 `send-prompt` args 均为「请严格按下面四行逐行输出…第四行：LAYER-V-CAP-NN-OK」（`:266`/`:306`/`:324`） | ✅ 已修复 |
| Should-Fix #1：真机 sawStreaming/sawGrowth | ❌ #20/#21 为 false | `layer-v-capabilities-status.json` 三处 `sawStreaming:true, sawGrowth:true`（`:246-247`/`:453-454`/`:673-674`） | ✅ 已修复 |
| Should-Fix #2：agentPreset 继承测试 | ❌ 无直接断言 | `server.spec.ts:502-547` 新增测试，断言 `composedPreset(parentCtx)` / `composeFrom({}, parentCtx)` / `meta.agentPreset` | ✅ 已修复 |
| 文档保真 #1：#32 `branch-switch` → `branch-mark` | ❌ 写 `branch-switch` | `implementation.md:30` 现写 `presentation:branch-mark` | ✅ 已修正 |
| 文档保真 #2：§AC-7 requireIncrement 陈述 | ❌ 与实际不符 | `implementation.md:43` 现写「三处均显式设 requireIncrement:true + 四行分段指令」，与交付物一致 | ✅ 已修正 |

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-7 | 操作序列 + 截图 + 断言，覆盖会话/聊天主链路，不覆盖 thin HTML | `layer-v-capabilities.json`（14 项 steps） | ✅ | 14 项均有 `command → assert/wait/stream → screenshot` 完整序列；`assistantText` 只拼 `role==='assistant'`；manifest 无 `buildThinChatHtml` 对应能力 |
| AC-8 | 过时功能不覆盖 + 过时功能清单 | `implementation.md §过时功能清单` | ✅ | thin HTML / Tier-3 全文搜索 / 侧栏可写面三项列入清单；manifest 仅 `cap-tier1-field-match`（Tier-1） |
| AC-9 | 真实模型往返 + 凭证门控 fail-closed | `dsh.test.sendPrompt` + `capability-runner.cjs:847-863` | ✅ | `sendPrompt → panelHost.sendPrompt → acceptSend → promptActive → host.prompt`（真实 SDK prompt）；13 项 `requiresModel:true` 均走此路径；凭证门控 `requiresModel && !hasCredential → SKIPPED_NO_CREDENTIALS`（exit 3，fail-closed） |
| AC-10 | 每项 ≥1 条可独立判定端到端断言（完整数据路径） | `$assistantContains`/`$assistantClosed` matcher + marker | ✅ | 每项含 marker 断言（唯一字符串，仅真实模型可产出），覆盖「操作 sendPrompt → 产品响应 marker → 截图」完整路径 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| DEBT-1 | `capability-runner.cjs`（`StageError`/`safeJson`/`pngVerdict` 等 13+ 原语镜像） | ⚠️ Known | 已注册，目标 phase-5，本 Phase 不处理（spec 明确） |
| DEBT-2 | `server.ts` `createForkedSession`（emptySeed 分支）+ `conversation-controller.ts` `forkFromClosedTurn` retry | ⚠️ Known | 已注册，如实描述 #33 超时根因，目标 phase-5 |

### 新发现的未注册桩
无。`resolveMatcher` 对未知谓词返回 `() => false`（fail-closed 设计，非桩）。

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix
无。（上轮 2 项 Should-Fix 均已修复并核实）

### 🟢 Observations
无新增。

## 关键代码核实结论（修复点专项）

1. **流式增量门控链路完整**：
   - manifest 三处 `stream` 步（`:267`/`:307`/`:325`）均带 `requireIncrement: true`，提示词为四行分段指令（`send-prompt` args，`:266`/`:306`/`:324`）。
   - runner 门控正确：`capability-runner.cjs:691-693` `incrementObserved = value.sawStreaming || value.sawGrowth`；`record.ok = !requireIncrement || incrementObserved`。`requireIncrement:true` 时，若未观测到任何增量则 `record.ok=false` 并写 detail（`:700`）。
   - `pollForStream` 记录 `sawStreaming`（`assistantStreamingActive`）与 `sawGrowth`（`len > prevLen`）（`:191-202`）。
   - 单元测试覆盖增量门控（`layer-v-capability-runner.spec.ts:345/368` 均设 `requireIncrement:true`）。
   - 真机证据：`layer-v-capabilities-status.json` 三处 `sawStreaming:true, sawGrowth:true`（`:246-247`/`:453-454`/`:673-674`），对应 #18/#20/#21。✅ 修复有效。

2. **agentPreset 继承测试真实有效**：
   - `server.spec.ts:502-547` 测试「inherits the parent agentPreset when forking a live parent」：mock `agentPresets` 服务（`composedPreset`/`composeFrom`），断言 `composedPreset` 以 `parentCtx` 调用（`:535`）、`composeFrom` 以 `({}, parentCtx)` 调用（`:536`）、`create` 收到 `meta.agentPreset: 'specdev-orchestrator'`（`:543`）。
   - 与实现一致：`server.ts:473` `parentPreset = presets?.composedPreset(parentAgent.ctx)`；`:482` `meta.agentPreset`；`:493-495` `setup: childCtx => presets.composeFrom(childCtx, parentAgent.ctx)`。断言精确锁定三条继承路径，非浅层存在性断言。✅ 覆盖缺口已补。

3. **文档保真两处均修正**：
   - §14 表格 #32 `presentation:branch-mark`（`implementation.md:30`），与 `presentationForIntent` 及 manifest #32 断言一致。
   - §AC-7 陈述「三处均显式设 `requireIncrement:true` + 四行分段指令」（`implementation.md:43`），与 manifest 交付物一致。

## 判决理由

上轮 2 项 Should-Fix（流式增量强制 + agentPreset 继承测试）均已实质修复并核实：manifest 三处 `requireIncrement:true` 落地、四行分段提示词落地、真机三项均 `sawStreaming:true, sawGrowth:true`、`server.spec.ts` 新增针对 `composedPreset`/`composeFrom`/`meta.agentPreset` 的精确断言。2 项文档保真（`branch-mark`、§AC-7 陈述）均已修正。无新发现 MUST-FIX / SHOULD-FIX / 未注册桩。全部 AC 满足。判决 **PASS**。
