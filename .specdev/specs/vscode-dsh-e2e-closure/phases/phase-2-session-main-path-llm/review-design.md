# Design Consistency Review — Phase 2（修复回路复审）

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 复审性质
本轮为**修复回路复审**：上一轮本视角判 **PASS**，本轮仅确认 implementer 的 SHOULD-FIX ×2 + 文档保真 ×2 修复未破坏上一轮已确认的设计一致性。

## 判决
**PASS**

## 修复项与设计一致性对照

| 修复项 | 上一轮设计依据 | 本轮实际改动 | 是否破坏设计 | 判定 |
|:---|:---|:---|:---|:--:|
| SHOULD-FIX #1：流式增量可验证（#18/#20/#21） | AD-4（断言与证据策略：关键区域存在 + 非退化，不逐像素比对）+ AC-10（≥1 条可独立判定端到端断言） | `layer-v-capabilities.json` 三处 `stream` 步补 `requireIncrement:true` + 四行分段提示词（`:267`、`:307`、`:325`） | 否 | ✅ |
| SHOULD-FIX #2：补 agentPreset 继承分支测试 | AD-2（纯编排分层）+ 上一轮已确认的 SDK server `createForkedSession` 继承机制（`composedPreset`/`composeFrom`/`meta.agentPreset`） | `packages/sdk/server/tests/server.spec.ts` 新增「inherits the parent agentPreset when forking a live parent」测试（`:502-547`），**未改 `server.ts` 产品代码** | 否 | ✅ |
| 文档保真 #1：#32 `branch-switch`→`branch-mark` | AD-3（manifest 驱动，`presentationForIntent` 对 `branch` 返回 `branch-mark`） | `implementation.md` §14 表格措辞修正，manifest #32 断言本即 `branch-mark`（`:488`） | 否 | ✅ |
| 文档保真 #2：§AC-7 `requireIncrement` 陈述 | — | `implementation.md` §AC-7 由「#18/#21」更正为「#18/#20/#21 + 四行分段指令」 | 否 | ✅ |

## 关键架构决策逐项复核（确认未被破坏）

### AD-2 纯编排分层（`capability-runner.cjs` 不 import `vscode`）
- 顶部 require 仍仅 `node:child_process`/`node:crypto`/`node:fs`/`node:os`/`node:path`（`capability-runner.cjs:49-53`），无 `vscode`。
- `requireIncrement` 门控（`:691-693`：`const requireIncrement = step.requireIncrement === true; record.ok = !requireIncrement || incrementObserved`）落在纯编排层 `runCapability` 的 `stream` 分支，消费 `pollForStream` 返回的 `sawStreaming`/`sawGrowth` 证据，**不接触宿主绑定**。✅ 未破坏。

### AD-4 可插拔断言注册表（新增断言不改 `matchesExpect` 核心）
- `requireIncrement` 是 manifest 的**按步字段**（数据驱动，与 `timeoutMs`/`intervalMs`/`expect` 同形态），由 `runCapability` 泛化读取，**不是新增 `MATCHERS` 注册表条目**，也不改 `matchesExpect` 核心（`:394-413` 未动）。
- `MATCHERS` 保持 shipped 集（`:321-328`），`$assistantClosed:` 等参数化谓词仍走 `resolveMatcher` 内联分支（`:364-367`）。✅ 未破坏。
- 增量门控与 AD-4 的「非退化」哲学一致：不逐像素比对，但要求流式步**确证中间态**（`sawStreaming` 或 `sawGrowth`），是「关键区域存在 + 非退化」的流式特化。✅

### SDK server agentPreset 继承一致性
- 本轮新增测试（`:502-547`）mock `agentPresets` 服务的 `composedPreset`/`composeFrom`，断言 fork 后 `composedPreset(parentAgent.ctx)` 被调用、`create` 收到 `meta.agentPreset: 'specdev-orchestrator'`、`composeFrom(childCtx, parentAgent.ctx)` 被调用——正是上一轮 PASS 时确认的继承机制（`composedPreset` 负责 durable header、`composeFrom` 负责实际 join）。
- 测试用 `ctx.get(name)`（`:519`：`get: name => name === 'agentPresets' ? { composedPreset, composeFrom } : undefined`）消费可选服务，遵守「可选服务用 `ctx.get(name)`」约定，**未引入 `sdk/server`→`agent-presets` 硬依赖**。✅ 未破坏。
- **本轮未改 `server.ts`**，产品代码继承机制与上一轮 PASS 时完全一致，测试只是补上了此前缺失的分支覆盖。✅

## 模块/命名/结构审查（本轮改动范围）

| 改动 | 所在文件 | 是否合理 | 说明 |
|------|---------|:--:|------|
| `requireIncrement:true` + 四行提示词 | `layer-v-capabilities.json` | ✅ | manifest 数据，符合 AD-3「manifest 是唯一覆盖依据」 |
| agentPreset 继承测试 | `packages/sdk/server/tests/server.spec.ts` | ✅ | 测试与产品 spine 会话方法同包，归属正确 |
| 文档保真修正 | `implementation.md` | ✅ | 仅报告文字，无代码/架构影响 |

## 依赖方向复核

| 检查项 | 判定 | 说明 |
|------|:--:|------|
| `capability-runner.cjs` 不依赖宿主（vscode） | ✅ | `requireIncrement` 门控无任何新依赖 |
| `server.spec.ts` 测试不引入新硬依赖 | ✅ | 仅 mock 可选 `agentPresets` 服务 |
| manifest `stream` 步字段由 runner 泛化消费 | ✅ | 数据驱动，无 runner 反向耦合到具体能力 |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 Observations
- **[文档保真无关 / 维护性] `requireIncrement` 字段未在 `runCapability` 的 JSDoc 步骤清单里显式枚举**：`runCapability` 头注释（`capability-runner.cjs:600-606`）列出 `command/assert/wait/stream/replay/screenshot` 六种 step kind，但未提及 `stream` 步的 `requireIncrement` 按步字段（其语义已由 `pollForStream` JSDoc 在 `:180` 处说明）。这与 `timeoutMs`/`intervalMs`/`expect` 按步字段同样「不逐一枚举」的既有写法一致，不构成接口契约缺口，仅提示后续若流式门控语义扩展时可补一句。**不参与判决**。
