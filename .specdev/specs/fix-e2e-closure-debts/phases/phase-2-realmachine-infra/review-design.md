# Design Consistency Review — Phase 2（DEBT-14 增量修复，重跑）

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 判决
**SHOULD-FIX**

## 审查焦点

本轮为**重跑**，聚焦 DEBT-14 增量修复（上一轮已覆盖 DEBT-7/10/12/3/2）。DEBT-14 是 DEBT-12 修复 readonly-live 污染②后**新暴露**的真实缺陷：`cap-selection-ask` 的 `assistant-replied` 步真机超时，根因是 selection-ask 会话未成为 active tab（active 停留在前序 stream 会话的 replay Tab）。

修复动作（`apps/vscode-dsh/src/extension.ts:1028-1040`）：在测试 hook `dsh.test.askAboutSelection` 内，`runAskAboutSelection` 返回后 `await autoReady?.triggerAutoReady()` 结算 in-flight restore，再若 active 非 live 则 `newConversation(EMPTY_LIVE_TITLE)` 重建 live Tab。

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| AC-1：新增/修改的测试面均 `VSCODE_DSH_TEST=1` 门控、注册在 `shouldRegisterTestHooks` 分支内 | 是 | `dsh.test.askAboutSelection` 位于 `extension.ts:1012` 的 `if (shouldRegisterTestHooks(vscodeArg))` 块内（:1028）；未新增任何 `dsh.test.*` 之外的命令 | ✅ |
| AC-1：不得引入新产品业务逻辑变更（不改产品语义） | 是 | 产品路径 `dsh.askAboutSelection`（:842-843）→ `runAskAboutSelection`（:2612）未改动；修复只调用既有公共方法 `triggerAutoReady()` / `newConversation()`，不修改 `runAskAboutSelection` / `auto-ready-coordinator` / `conversation-controller` 的实现 | ✅ |
| 退出码契约（0/1/2/3/4）冻结 | 是 | 本批未触碰 exit code 相关代码 | ✅ |
| `closedLoop` / `classifyAssertionStrength` / 断言原语冻结 | 是 | 本批未触碰 `capability-runner.cjs` 的闭环判定/断言原语 | ✅ |
| 真修优先，AC-13 诚实登记为兜底而非默认 | 是 | DEBT-14 可修复 → 走真修（settle restore + 重建 live Tab），未放宽 `$assistantContains`/超时断言、未删步骤、未改探针规避 | ✅ |
| 全链驱动复位接入点（DEBT-12）不被动摇 | 是 | 本批只改测试 hook 内部，不触及 `capability-runner.cjs` 的 `resetToIdle` 接入点 | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 新文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| （无新文件） | — | — | DEBT-14 仅改既有 `extension.ts` 测试 hook + `tech-debt-registry.md` 状态行 |

### 命名规范审查
| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 修复引用的方法 | `triggerAutoReady()` / `newConversation()` / `EMPTY_LIVE_TITLE` | 既有符号，非本批新造 | ✅ 复用既有 API，无新命名 |

### Constitution §2 检查
| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2 依赖方向 / 核心不依赖外围 | 验证基建不反向侵入产品 | ✅ | 修复全部落在测试 hook（外围验证基建），通过既有控制器/协调器公共方法交互，无核心模块新增对外围的依赖 |
| 门控隔离 | 测试专用 hook 生产不注册 | ✅ | `shouldRegisterTestHooks` 分支内，`VSCODE_DSH_TEST=1` 门控 |

## 四项审查重点的逐项结论

### 1. DEBT-14 修复是否落在 AC-1 授权范围

**是**。判定依据：

- DEBT-14 修改的是**既有**测试 hook `dsh.test.askAboutSelection`（非新增命令），其本来就注册在 `shouldRegisterTestHooks` 分支（`extension.ts:1012`）内、`VSCODE_DSH_TEST=1` 门控，生产不注册。
- 未引入任何产品业务逻辑变更：`runAskAboutSelection`（产品命令 `dsh.askAboutSelection` 背后的实现）保持原样；`auto-ready-coordinator.ts` 的 restore 语义、`conversation-controller.ts` 的会话激活逻辑均未改。
- design 虽未在 8 条债务清单中预列 DEBT-14，但 AC-1 的授权面是「验证基建（测试 hook，门控）」而非「只许改 8 条债务」；工作流目标（design.md 第 5 行）本身即「补齐真机闭环验证缺口与产品缺陷」。DEBT-14 是 DEBT-12 复位后真机暴露的验证闭环缺口，在 AC-1 授权的验证基建面上真修，**不越界**。

### 2. 是否违背 design 的冻结契约

**否**。退出码契约、`closedLoop`/`classifyAssertionStrength`/断言原语、产品语义三方面均未动。修复通过 `triggerAutoReady()`（既有公共方法，`auto-ready-coordinator.ts:84-86` 直接转 `maybeApplyReady`）与 `newConversation()`（既有控制器方法）实现，不改任何冻结契约。

### 3. 是否与 DEBT-12 复位设计自洽

**自洽，无新设计张力**。两者作用域正交：

- DEBT-12 的 `dsh.test.resetToIdle`（`orchestrator.onUserStop()` + `resetForTest()` 清 `contextSessionId`/关 pinned 子 tab）解决**跨能力**的串行污染，作用于「能力结束→复位干净态」。
- DEBT-14 解决**能力内部**的异步 restore 竞态，作用于「selection-ask 能力自身跑通时 active tab 正确」。
- DEBT-14 的 `triggerAutoReady()` 结算的是 auto-ready 的 `applyInFlight` 单飞（`auto-ready-coordinator.ts:100-117`，in-flight 时 `await` 后再复核 `readyAppliedForVisibilityEpoch`），与 DEBT-12 复位路径无交叠。DEBT-14 重建的 live Tab 会在能力结束后的复位中正常清理，不构成残留。

> 观察（不计入判决，见 §Observations）：DEBT-14 用 `newConversation()`（恒新建）而非 auto-ready 侧 `ensureReadySurface` 所用的 `newConversationOrReuseEmpty()`（可复用空 Tab）。这是实现正确性层面的细节取舍（恒新建可保证 active 必为 live 且无内容污染），不构成架构偏离——二者都是 `conversation-controller` 既有公共方法，design 未对 DEBT-14（未预列）指定用哪个。

### 4. 是否应回填 design.md 修订记录

**应（SHOULD-FIX）**。design.md 的「范围覆盖」（第 7/9 行）与「架构摘要」反复以「8 条债务」为交付口径，而实际交付新增关闭了第 9 条 DEBT-14。这造成 design.md 与 `tech-debt-registry.md`（已把 DEBT-14 记入「已解决」）之间的事实漂移。虽然 DEBT-14 修复本身在 AC-1 授权内、不违反任何冻结契约，但 design.md 作为「实施与验收依据」应同步口径：在「设计修订记录」补一条「DEBT-14（DEBT-12 复位后真机新暴露）真修：test hook settle restore + 重建 live Tab」，并/或在「范围覆盖」注明实际关闭 9 条（8 条预列 + DEBT-14 增量）。

> 说明：这属于文档口径一致性缺口，**不**构成对架构决策的违反，故定级 SHOULD-FIX 而非 MUST-FIX。

## 关键发现
### 🔴 Must-Fix
- 无。

### 🟡 Should-Fix
- **[文档口径漂移]** design.md「范围覆盖/架构摘要」仍以「8 条债务」为交付口径，未记录 DEBT-14 这条真机新暴露并已真修的债务。建议回填「设计修订记录」+ 更新范围口径，使 design.md 与 `tech-debt-registry.md`（DEBT-14 已入「已解决」）一致。

### 🟢 Observations
- `newConversation()`（恒新建 live Tab）与 auto-ready 侧的 `newConversationOrReuseEmpty()`（可复用空 Tab）在 DEBT-14 修复路径上的取舍差异——正确性细节，非架构偏离，交由 reviewer-correctness 评估恒新建是否安全。
- `triggerAutoReady()` 在 `auto-ready-coordinator.ts` 中已有 `dsh.test.triggerAutoReady`（`extension.ts:1286`）命令入口，DEBT-14 修复直接调用 `autoReady` 对象方法而非复用该命令——二者等价，本批直接调用更贴切（同作用域、无需走命令注册层），无一致性问题。
