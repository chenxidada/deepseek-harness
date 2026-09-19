# Repository Exploration Report — Phase 2: tests 归并、编号与筛选

> phase 级调研。范围：`apps/vscode-dsh/tests/`（61 个 spec → 10 个 `cap-<domain>.spec.ts|tsx` 域文件）。
> 本报告只提供**事实 + 证据（文件:行号）**，不做 keep/drop 最终判定（最终判定是 implementer 按 design.md K1–K3/D1–D4 的职责）。

## 1. Task Context

Phase 2 是本 feature 的核心执行步：把 `apps/vscode-dsh/tests/` 下 61 个 spec 文件（57 `.ts` + 4 `.tsx`）归并为 10 个域文件 `cap-<domain>.spec.ts|tsx`，逐用例判定 keep/drop（K1 外部可观察行为 / K2 跨模块集成 / K3 负向对照；D1 一次性 spike / D2 私有实现细节耦合 / D3 被更严用例覆盖 / D4 债修复临时守卫），建立全局唯一 `CAP-<DOMAIN>-<NNN>` 编号，回填 `assertion-map.md`（556 行台账骨架）与 `capability-domains.json` 的 `entryAssertions.caps`。本调研为 implementer 提供：每域源文件清单与内部结构、跨文件 hook/fixture 依赖（R-1）、`.ts`/`.tsx` 环境差异（R-4）、用例级 keep/drop 候选素材、spike/gap 5 文件的逐用例分析（AC-26）、每域入口真实调用路径（AC-11）。

## 2. Repository Overview

- **语言/框架**：TypeScript（ESM），测试框架 Vitest（`vitest.config.ts` 位于仓库根，`apps/vscode-dsh` 复用根配置）。测试断言风格统一为 `expect(...)`，无 BDD `given/when/then`。
- **被测对象**：`apps/vscode-dsh/` 是 VS Code 扩展（IDE 宿主），`src/` 为产品代码，`webview/src/` 为 React Webview SPA。测试通过直接 `import` 产品模块（`../src/xxx.ts`、`../../webview/src/xxx.ts`）或真实子进程（`fixtures/fake-sdk-runtime.mjs`）驱动。
- **测试目录结构**（✅ CONFIRMED，`apps/vscode-dsh/tests/`）：
  - 顶层 55 个 spec（含 4 个 `.tsx`）+ `layer-a/`（5 spec）+ `layer-a-rtl/`（2 spec）+ `verifier-phase1/`（2 spec）+ `verifier-phase2/`（2 spec）= 61 spec。
  - 3 个域内 helper：`spike-attribution-helpers.ts`、`spike-t0a-replay-hydrator.ts`、`spike-t0b-continue-helpers.ts`（仅被各自同名 spike spec import，无跨域共享）。
  - `fixtures/fake-sdk-runtime.mjs`（真实子进程运行时，11 个 spec 引用）+ `fixtures/screenshots/README.md`（文档）。
  - 台账与域定义：`capability-domains.json`（10 域）、`assertion-map.md`（556 行）。

## 3. Most Relevant Areas

### 3.1 每域源文件清单与内部结构（域 → 源文件 → 用例数）

**口径说明**：「用例数」= `assertion-map.md` 中的静态断言行数（与 Phase 1 台账 556 行对齐，是 implementer 归并的核对基准）；「it 声明」= 源文件中的 `it(` / `it.each(` / `it.skip(` 静态声明数（含被 `.skip` 的）。二者差额主要来自 2 条 `it.each` 参数化展开（见 §7 R-5）。

> ⚠️ 本套件几乎不使用 `test(` 作为测试声明：grep 到的 `test(` 命中多为 RegExp `.test(line)` 方法调用（如 `display-evidence-shell.spec.ts:430`、`phase2-multitab-history-replay.spec.ts:499`），**不是**测试用例。全部用例以 `it(` / `it.each(` 书写。

| 域 id | 目标文件 | absorbed 源文件 | 用例数 | describe | it 声明 |
|---|---|---:|---:|---:|
| **session-host** | `cap-session-host.spec.ts` | session-host.spec.ts | 15 | 5 | 15 |
| | | session-host-preflight.spec.ts | 7 | 1 | 7 |
| | | node-env-guard.spec.ts | 28 | 5 | 28 |
| | | host-diagnostics.spec.ts | 48 | 10 | 48 |
| | | layer-v-inject-disconnect.spec.ts | 2 | 1 | 2 |
| | | auto-start-orchestrator.spec.ts | 11 | 2 | 11 |
| | | phase1-auto-start.spec.ts | 9 | 1 | 9 |
| | | phase2-auto-ready.spec.ts | 9 | 3 | 9 |
| | | verifier-phase1/layer-b-lifecycle.spec.ts | 8 | 2 | 8 |
| | | verifier-phase2/layer-b-host.spec.ts | 7 | 1 | 7 |
| | | **小计** | **144** | 31 | 144 |
| **conversation** | `cap-conversation.spec.ts` | conversation-registry.spec.ts | 5 | 1 | 5 |
| | | multi-tab-session.integration.spec.ts | 1 | 1 | 1 |
| | | multi-tab-dispose.e2e.spec.ts | 1 | 1 | 1 |
| | | panel-close-delete.e2e.spec.ts | 5 | 1 | 5 |
| | | message-store-index.spec.ts | 3 | 2 | 3 |
| | | panel-l2-l3-protocol.spec.ts | 6 | 3 | 6 |
| | | editor-chat-panel.lifecycle.spec.ts | 8 | 2 | 8 |
| | | phase2-multitab-history-replay.spec.ts | 8 | 8 | 8 |
| | | phase4-subagent-enter-pin.spec.ts | 12 | 2 | 12 |
| | | phase4-new-conversation-chrome.spec.ts | 9 | 2 | 9 |
| | | gap-003-004-debt-fix.spec.ts | 5 | 2 | 5 |
| | | **小计** | **63** | 25 | 63 |
| **timeline** | `cap-timeline.spec.ts` | timeline-projector.spec.ts | 2 | 1 | 2 |
| | | timeline-diff.e2e.spec.ts | 2 | 1 | 2 |
| | | timeline-diff.integration.spec.ts | 1 | 1 | 1 |
| | | spike-attribution-snapshot.spec.ts | 7 | 3 | 7 |
| | | phase2-history-delete-host.spec.ts | 2 | 1 | 2 |
| | | phase3-restart-continue.spec.ts | 13 | 5 | 13 |
| | | phase3-review-revert-replay.spec.ts | 16 | 1 | 16 |
| | | chat-ux-fork-retry-branch.spec.ts | 12 | 1 | 12 |
| | | **小计** | **55** | 14 | 55 |
| **interaction** | `cap-interaction.spec.ts` | interaction-approval-resolution.spec.ts | 6 | 1 | 6 |
| | | interaction-fail-closed.e2e.spec.ts | 2 | 2 | 2 |
| | | interaction-fail-closed.integration.spec.ts | 3 | 3 | 3 |
| | | replaceability-interaction-ui.spec.ts | 2 | 1 | 2 |
| | | gap-005-009-debt-fix.spec.ts | 8 | 5 | 8 |
| | | **小计** | **21** | 12 | 21 |
| **code-context** | `cap-code-context.spec.ts` | phase1-code-context.spec.ts | 23 | 6 | 23 |
| | | **小计** | **23** | 6 | 23 |
| **change-list** | `cap-change-list.spec.ts` | phase2-change-list-display.spec.ts | 16 | 1 | 16 |
| | | chat-ux-refs-changes-diff.spec.ts | 3 | 1 | 3 |
| | | layer-a/refs-changes-diff.spec.ts | 4 | 1 | 4 |
| | | **小计** | **23** | 3 | 23 |
| **search** | `cap-search.spec.ts` | chat-ux-session-search.spec.ts | 6 | 1 | 6 |
| | | **小计** | **6** | 1 | 6 |
| **chat-panel** | `cap-chat-panel.spec.ts` | chat-ux-activity-stream.spec.ts | 5 | 1 | 5 |
| | | chat-ux-streaming-cancel-follow.spec.ts | 7 | 1 | 7 |
| | | phase3-chat-ui-chassis.spec.ts | 19 | 12 | 19 |
| | | phase5-should-polish.spec.ts | 12 | 6 | 12 |
| | | layer-a/activity-stream.spec.ts | 5 | 1 | 5 |
| | | layer-a/streaming-cancel-follow.spec.ts | 4 | 1 | 4 |
| | | layer-a/foundation-render-probe.spec.ts | 9 | 1 | 9（含 1 `it.skip`） |
| | | layer-a/protocol-decision-smoke.spec.ts | 1 | 1 | 1 |
| | | **小计** | **62** | 24 | 62 |
| **webview** | `cap-webview.spec.tsx` | layer-a-rtl/editor-chat-shell.spec.tsx | 5 | 1 | 5 |
| | | layer-a-rtl/editor-chat-phase2.spec.tsx | 12 | 1 | 12 |
| | | verifier-phase1/layer-a-rtl.spec.tsx | 7 | 1 | 7 |
| | | verifier-phase2/layer-a-rtl.spec.tsx | 12 | 1 | 12 |
| | | **小计** | **36** | 4 | 36 |
| **test-harness** | `cap-test-harness.spec.ts` | artifact-index.spec.ts | 11 | 4 | 11 |
| | | display-evidence.spec.ts | 16 | 2 | 16 |
| | | display-evidence-shell.spec.ts | 11 | 3 | 11 |
| | | build-freshness.spec.ts | 19 | 4 | 19 |
| | | sandbox-clean-state.spec.ts | 12 | 3 | 10 + 2 `it.each` |
| | | chat-ready-regression.spec.ts | 1 | 1 | 1 |
| | | layer-v-capabilities-phase3.spec.ts | 15 | 5 | 15 |
| | | layer-v-capability-runner.spec.ts | 30 | 9 | 30 |
| | | spike-t0a-replay-rebuild.spec.ts | 4 | 1 | 4 |
| | | spike-t0b-continue-capability.spec.ts | 4 | 1 | 4 |
| | | **小计** | **123** | 33 | 123 |
| **合计** | 10 域 | 61 个源文件 | **556** | — | 556 |

**结论**：10 域 absorbed 映射覆盖 **61 个源文件**（无遗漏、无重复），用例数合计 **556**，与 Phase 1 台账完全对齐。每域用例数分布极不均衡（session-host 144、test-harness 123 为大域；search 6、interaction 21 为小域），implementer 需为 session-host / test-harness 两个大域规划更细的 `describe` 分层。

### 3.2 spike/gap 5 文件的逐用例特别分析（AC-26）

这 5 个文件是「债修复临时守卫」（gap-*）与「一次性 spike 探查」（spike-*）的典型代表。逐用例列 SUT 与「是否已固化在实现 / 是否被其它用例覆盖」，供 implementer 判定 D1 / D3 / D4 理由码。

#### gap-003-004-debt-fix.spec.ts（→ conversation 域，5 用例）

| # | 用例（行号） | 断言的 SUT | 固化情况 | 初步线索 |
|---|---|---:|---|---|
| 1 | `keeps the Tab in the registry while disposeSession is in-flight` (L16) | `ConversationController.deleteConversation` 的 dispose 时序 | GAP-003 已修复，行为落在 `src/conversation-controller.ts` | 外部可观察行为（删除期间 Tab 保留）→ 倾向 **K1 保留**，D4 债已还清 |
| 2 | `retains the Tab when disposeSession fails so delete can be retried` (L41) | `deleteConversation` 失败路径 | 已固化 | 负向对照（dispose 抛错 → Tab 保留可重试）→ **K3** |
| 3 | `calls disposeSession before registry.close on the delete success path` (L62) | `deleteConversation` 顺序（failClosed → dispose → close） | 已固化 | 外部可观察顺序 → **K1** |
| 4 | `closeConversation does not call disposeSession (AD-CU-3)` (L94) | `ConversationController.closeConversation` | AD-CU-3 已固化 | 负向对照（close ≠ dispose）→ **K3** |
| 5 | `sets TreeItem.command to dsh.switchConversation with the Tab id` (L114) | `createConversationTabBar` + `canRegisterConversationTabBar` | GAP-004 已修复，行为落在 `src/conversation-tab-bar.ts` | 外部可观察入口（TreeView 命令接线）→ **K1 保留** |

**小结**：文件名是 D4 债修复触发，但 5 个用例断言的均为**已固化的外部行为**（K1/K3），债务已还清，应**保留并重分类为 K1/K3**，不因「gap 命名」而整体 D4 丢弃。

#### gap-005-009-debt-fix.spec.ts（→ interaction 域，8 用例）

| # | 用例（行号） | 断言的 SUT | 固化情况 | 初步线索 |
|---|---|---:|---|---|
| 1 | `notifies onError listeners when onTransportDeath fires` (L24) | `IdeSessionHost.onTransportDeath` | 已固化 | 外部可观察（transport 死亡 → error）→ **K1** |
| 2 | `extension startSession wires onError to showErrorMessage (AC-30 UI)` (L41) | `extension.ts` 的 `onError` → `showErrorMessage` 接线 | GAP-005 已修复 | **D2/D4 强候选**：用例通过 `readFile` 读 `extension.ts` 源码 + 正则 `/onError\s*\(/`、`/showErrorMessage\(/` 断言**源码文本**而非行为 → 应被 cap-interaction 中的行为级用例取代 |
| 3 | `hides createQuickPick when AbortSignal aborts` (L77) | `createVscodeInteractionUi.presentApproval` | 已固化 | 外部可观察（abort → quickpick 隐藏）→ **K1** |
| 4 | `coordinator failClosedAll aborts signal seen by UI` (L121) | `InteractionCoordinator.failClosedAll` | 已固化 | 跨模块集成（coordinator → UI）→ **K2** |
| 5 | `collects custom via showInputBox when options are empty` (L148) | `presentQuestions` 走 `showInputBox` | GAP-008 已修复 | 外部可观察（自由文本问题）→ **K1** |
| 6 | `omits custom when InputBox is cancelled` (L172) | `presentQuestions` 取消路径 | 已固化 | 负向对照（取消 → 无 custom）→ **K3** |
| 7 | `aborts only the closed session pending interactions and does not dispose` (L193) | `ConversationController.closeConversation` + `InteractionCoordinator` | GAP-009 已修复 | 跨模块集成 → **K2** |
| 8 | `routes fake-runtime questions to the owning Tab and returns selected answer` (L255) | `IdeSessionHost.start` + questions Host→UI→response（真实 fake-sdk-runtime 子进程） | 已固化 | 跨模块端到端集成 → **K2 保留** |

**小结**：仅 #2 是「读源码文本」的 D2/D4 债守卫（应由行为级用例取代）；其余 7 条均为已固化的 K1/K2/K3 行为，**保留**。

#### spike-attribution-snapshot.spec.ts（→ timeline 域，7 用例）

| # | 用例（行号） | 断言的 SUT | 固化情况 | 初步线索 |
|---|---|---:|---|---|
| 1 | `inject recoverable meta.diffs → attribution candidates non-empty` (L31) | `spike-attribution-helpers.ts` 的 `attributionCandidatesFromMeta` / `attributionPathsForLatestTurn` | 生产 `src/change/change-attributor.ts` 已用 `recoverableDiffsFromMeta`（`src/replay-hydrator.ts`）实现真实归因 | **D1/D3**：spike helper 已被生产实现取代 |
| 2 | `write-create style empty diffs → not attributed (GAP-010 / 宁可漏记)` (L57) | `attributionCandidatesFromMeta` | 生产策略「宁可漏记」已固化 | **D1/D3** |
| 3 | `patch-only / missing oldText → reject (not attributed)` (L70) | `attributionCandidatesFromMeta` | 同上 | **D1/D3** |
| 4 | `helpers do not import vscode workspace watch/save APIs for intake` (L79) | spike helper 源码「不 import vscode」 | 一次性 spike 纪律守卫 | **D2**：断言 helper 源码文本（`not.toMatch(/from 'vscode'/)`），spike 特有，无保留价值 |
| 5 | `write/read/delete blob under changes/<sessionId>/...` (L91) | `dryRunSnapshotStore` + `snapshotBlobPath` / `snapshotSessionDir` | 生产 `src/change/snapshot-store.ts` 已实现真实 SnapshotStore | **D1**：spike dry-run 已被生产取代 |
| 6 | `documents association keys + prune policy constants` (L140) | `SNAPSHOT_STORE_SPIKE` 常量 | 生产常量已落 `snapshot-store.ts` | **D2**：断言 spike 常量表，无保留价值 |
| 7 | `user manual save near DSH turn window MUST NOT be labeled DSH change` (L153) | `simulateUserManualSave` + `attributionPathsForLatestTurn` | 「用户手动保存不算 DSH 变更」策略已固化 | **D1/K3**：负向对照（误报否定）有长期价值，可**保留**并入 cap-timeline |

**小结**：spike 一次性探查（#1–#6）大多被生产实现取代，倾向 **D1/D2 丢弃**；#7 是「误报否定」负向对照，可保留为 K3。

#### spike-t0a-replay-rebuild.spec.ts（→ test-harness 域，4 用例）

| # | 用例（行号） | 断言的 SUT | 固化情况 | 初步线索 |
|---|---|---:|---|---|
| 1 | `AC-30/47: cold-read folds messages + timeline matching fixture order/roles (one-shot)` (L42) | `readColdSessionLog`（`@deepseek-ai/dsh-session-query`）+ `foldMessages` / `foldTimeline`（`spike-t0a-replay-hydrator.ts`） | 生产 `src/replay-hydrator.ts` 已实现 fold（cold log → messages/timeline） | **D1/K2**：spike 已固化，但属「持久化 → query → fold」跨模块集成，可**保留为 K2** |
| 2 | `AC-76: Diff probe distinguishes recoverable meta.diffs vs absent` (L74) | `probeDiffAvailability` + `recoverableDiffsFromMeta` | 生产已用 `recoverableDiffsFromMeta` | **D1** |
| 3 | `AC-77: incomplete open turn is detectable...` (L109) | `probeIncomplete` | 生产 `src/replay-hydrator.ts` 已有不完整回合探测 | **D1** |
| 4 | `AC-80 evidence: reopen after writer dispose still lists and stats` (L136) | `JsonlSessionPersistence` list/stat + `readColdSessionLog` | 已固化（持久化跨进程重开） | **D1/K2**：跨进程持久化证据，可保留 |

**小结**：T-0a 是「证明权威日志可重建」的一次性 spike，其 fold/probe 逻辑已固化进 `src/replay-hydrator.ts`。倾向 **D1 丢弃**（#2/#3），但 #1/#4 有跨模块集成价值可保留为 K2（实现者按 design.md 判定）。

#### spike-t0b-continue-capability.spec.ts（→ test-harness 域，4 用例）

| # | 用例（行号） | 断言的 SUT | 固化情况 | 初步线索 |
|---|---|---:|---|---|
| 1 | `AC-66/32: agents.resume same id appends without rewriting committed prefix` (L49) | `agents.resume`（`@deepseek-ai/dsh-agent`） | 生产 `src/continue-capability.ts` 已用 `agents.resume` 接续 | **D1/K2**：同 id 接续跨模块路径，可保留为 K2 |
| 2 | `AC-66/67: derive-only path leaves parent prefix intact + from→to link` (L85) | `agents.create({seed})` + `continueLinkFromDerive` | 生产已实现 derive 接续 | **D1** |
| 3 | `AC-28: continueCapability probe maps Gate + facts` (L137) | `probeContinueCapability`（spike helper） | 生产 `src/continue-capability.ts` 有真实 `ContinueCapability` probe | **D1**：spike probe 被生产取代 |
| 4 | `AC-32 IDE gap: SDK create-only path cannot same-id resume after dispose` (L179) | SDK `create` vs `resume`（静态 oracle + 实证） | 结论已固化（文档化 IDE 缺口） | **D1**：一次性缺口取证 |

**小结**：T-0b 是一次性接续能力 spike，逻辑已固化进 `src/continue-capability.ts`。倾向 **D1 丢弃**，其中 #1 的同 id 接续路径可保留为 K2。

### 3.3 用例级 keep/drop 候选素材（域级汇总，覆盖全部 556 条）

不逐条最终判定，但为 implementer 提供**文件级倾向 + 代表用例证据**，确保 61 个文件 / 556 条用例全部有分类线索：

| 域 | 文件级倾向 | 关键 drop 候选（D1/D2/D3/D4）线索 | 关键 keep 候选（K1/K2/K3）线索 |
|---|---|---|---|
| session-host | 绝大多数 **keep**（K1/K3 外部可观察启动/诊断行为） | `host-diagnostics.spec.ts`（48 条）中大量 `dsh.test.*` 诊断命令探针 → 逐条核「是否被 production 行为级用例重复覆盖」（D3） | `node-env-guard.spec.ts` 节点环境守卫（K3 负向对照）、`phase1-auto-start`/`phase2-auto-ready` 启动时序（K1） |
| conversation | 基本 **keep**；`gap-003-004` 5 条已固化（见 §3.2） | 无明确 D 候选；`phase2-multitab-history-replay.spec.ts` 中 L499/L500 两处 `m.test(...)` 是源码正则断言 → 核对是否 D2 | `conversation-registry`（K1 注册表行为）、`editor-chat-panel.lifecycle`（K1 生命周期）、`multi-tab-*.e2e/integration`（K2 真实子进程多 Tab） |
| timeline | **混合**：`spike-attribution-snapshot` 7 条偏 D1/D2（见 §3.2） | `spike-attribution-snapshot.spec.ts` #1–#6 已被生产取代 | `phase3-review-revert-replay`（16 条 K1 审阅/撤销/重放）、`chat-ux-fork-retry-branch`（12 条 K1 分叉重试分支）、`timeline-projector`（K1 投影） |
| interaction | 基本 **keep**；`gap-005-009` 中 #2 为 D2/D4（见 §3.2） | `gap-005-009-debt-fix.spec.ts` #2 源码文本断言 | `interaction-fail-closed.*`（K2 真实子进程 fail-closed）、`interaction-approval-resolution`（K1 审批决议） |
| code-context | 全部 **keep** | 无明确 D 候选（单文件，23 条均为 `selection-ask` 行为） | `phase1-code-context.spec.ts` 23 条（K1 选区/引用/上下文） |
| change-list | 基本 **keep** | `layer-a/refs-changes-diff.spec.ts`（4 条）与 `chat-ux-refs-changes-diff.spec.ts`（3 条）疑似重复（D3，同一 diff 渲染两条目） | `phase2-change-list-display.spec.ts`（16 条 K1 变更列表展示） |
| search | 全部 **keep** | 无 | `chat-ux-session-search.spec.ts` 6 条（K1 会话搜索） |
| chat-panel | **混合**：`layer-a/` 探针类偏 D1/D2 | `layer-a/foundation-render-probe.spec.ts` #9（`it.skip` legacy fixture，L194）→ D1/D2；`layer-a/protocol-decision-smoke.spec.ts`（1 条 smoke）→ D1 | `phase3-chat-ui-chassis.spec.ts`（19 条 K1 UI 底盘）、`phase5-should-polish`（12 条）、`chat-ux-*`（K1 行为） |
| webview | 全部 **keep**（4 个 `.tsx` RTL 渲染） | 无明确 D 候选 | `layer-a-rtl/editor-chat-phase2`/`editor-chat-shell` + `verifier-phase1/2/layer-a-rtl`（36 条 K1 DOM 行为，jsdom） |
| test-harness | **混合**：`spike-t0a/t0b` 8 条偏 D1（见 §3.2） | `spike-t0a-replay-rebuild.spec.ts` / `spike-t0b-continue-capability.spec.ts`（已固化，D1） | `layer-v-capability-runner`（30 条 K1 capability runner）、`layer-v-capabilities-phase3`（15 条）、`artifact-index`/`display-evidence*`/`build-freshness`/`sandbox-clean-state`（K1 测试基建行为） |

> 🔴 分类线索已覆盖全部 **61 个文件 / 556 条用例**（文件级全覆盖；5 个 spike/gap 文件逐用例覆盖）。最终 keep/drop + `CAP-` 编号由 implementer 在归并时逐条落定并回填台账。

### 3.4 `.ts` vs `.tsx` 环境差异（R-4 事实面）

- **`.tsx`（jsdom 环境）4 个**，全部在 webview 域：
  - `layer-a-rtl/editor-chat-shell.spec.tsx`（5 用例）
  - `layer-a-rtl/editor-chat-phase2.spec.tsx`（12 用例）
  - `verifier-phase1/layer-a-rtl.spec.tsx`（7 用例）
  - `verifier-phase2/layer-a-rtl.spec.tsx`（12 用例）
- **`.ts` 但携带 `// @vitest-environment jsdom` 的 5 个**（✅ CONFIRMED，grep `@vitest-environment`）：
  - `layer-a/activity-stream.spec.ts`
  - `layer-a/foundation-render-probe.spec.ts`
  - `layer-a/refs-changes-diff.spec.ts`
  - `layer-a/streaming-cancel-follow.spec.ts`
  - `chat-ux-streaming-cancel-follow.spec.ts`
- **其余 52 个 `.ts` 为 node 环境**（默认，无 pragma）。
- **同域混存情况**：
  - `webview` 域：4 个文件全 `.tsx`，**纯 jsdom**，无混存 → 目标文件 `cap-webview.spec.tsx` 整文件 jsdom 即可。
  - `chat-panel` 域：**存在混存** —— `layer-a/` 下 4 个 `.ts`（jsdom pragma）+ 顶层 `chat-ux-*`（`chat-ux-streaming-cancel-follow` 有 pragma，其余 `chat-ux-activity-stream` 无 pragma 但断言 DOM？）→ 需确认归并后环境划分（见 §7 R-4）。
  - `change-list` 域：`layer-a/refs-changes-diff.spec.ts`（jsdom pragma）与 `phase2-change-list-display.spec.ts` / `chat-ux-refs-changes-diff.spec.ts`（node）混存。
  - 其余域（session-host / conversation / timeline / interaction / code-context / search / test-harness）全部 node 环境，无混存。
- **`// @vitest-environment jsdom` 作用域**：Vitest 中该 pragma **按文件生效**（文件级注释），**不能**降级到 `describe` 块生效（⚠️ HYPOTHESIS，见 §8）。因此同域混存 jsdom 与 node 时，必须**拆 `.tsx` 子文件**或在单一 `describe` 内手动复用 jsdom 环境（需确认 Vitest 是否支持 `// @vitest-environment jsdom` 放在 describe 内 —— 默认不支持）。

## 4. Key Entry Points / Call Paths

### 4.1 每域入口真实注册位置（AC-11，✅ CONFIRMED，`grep registerCommand` + 源码阅读）

`capability-domains.json` 中 `entryAssertions[].entrypoint` 骨架值与真实注册**一致**，实现者可直接沿用并回填 `caps`：

| 域 | entrypoint（工具名/命令 id/导出符号） | 注册位置 |
|---|---|---|
| session-host | `activate`（扩展启动）；命令 `dsh.startSession` | `src/extension.ts:377`（activate）；`src/extension.ts:564`（dsh.startSession） |
| conversation | 命令 `dsh.test.newConversation` | `src/extension.ts:1170` |
| timeline | 命令 `dsh.test.listHistory` | `src/extension.ts:1079` |
| interaction | 命令 `dsh.test.injectApproval` | `src/extension.ts:1419` |
| code-context | 命令 `dsh.test.resolveAtPath` | `src/extension.ts:1452` |
| change-list | 命令 `dsh.test.listChanges` | `src/extension.ts:1339` |
| search | 命令 `dsh.test.searchSessions` | `src/extension.ts:1392` |
| chat-panel | 命令 `dsh.showPanel` | `src/extension.ts:512` |
| webview | 导出符号 `createMessageBridge`（Webview RPC 桥） | `webview/src/bridge/message-bridge.ts:64` |
| test-harness | 命令 `dsh.test.simulateStartupOnly`（另有 `dsh.test.getStartState`） | `src/extension.ts:1243`（:1240 getStartState） |

### 4.2 关键调用链（1–3 条，ASCII）

```
[宿主启动/会话域]
activate (src/extension.ts:377)
  └─ registerCommand('dsh.startSession') (src/extension.ts:564)
       └─ IdeSessionHost.start(...) (src/session-host.ts)  ← session-host / test-harness 被测对象
            └─ 真实子进程 fixtures/fake-sdk-runtime.mjs（集成 e2e 用）

[会话/交互域]
dsh.test.newConversation (src/extension.ts:1170)
  └─ ConversationController.newConversation (src/conversation-controller.ts)
       ├─ ConversationRegistry (src/conversation-registry.ts)   ← conversation 域
       └─ InteractionCoordinator (src/interaction-coordinator.ts) ← interaction 域
            └─ createVscodeInteractionUi (src/interaction-ui.ts)

[时间线/变更域]
dsh.test.listHistory (src/extension.ts:1079)
  └─ TimelineStore / projector (src/timeline-store.ts)
dsh.test.listChanges (src/extension.ts:1339)
  └─ ChangeAttributor (src/change/change-attributor.ts)
       └─ recoverableDiffsFromMeta (src/replay-hydrator.ts) + SnapshotStore (src/change/snapshot-store.ts)
```

## 5. Likely Impact Surface

本 Phase 的改动**仅落在 `apps/vscode-dsh/tests/` 与两个台账文件**，不触碰产品代码。影响面：

| 目标 | 变更类型 | 风险 |
|---|---|---|
| 新建 10 个 `cap-<domain>.spec.ts|tsx` | 新增（归并 61 spec 的用例） | 🔴 高：import 路径重写 + `describe` 重分层 + `CAP-` 编号 |
| 删除 61 个原 spec 文件 | 删除（归并后源文件废弃） | 🟡 中：需确认无外部脚本引用旧路径 |
| `assertion-map.md` | 回填（判定/理由码/目标 cap 编号列） | 🟡 中：556 行需逐条对齐 |
| `capability-domains.json` | 回填（`entryAssertions.caps`） | 🟢 低 |
| 3 个 spike helper（`spike-*.ts`） | 可能删除或并入 | 🟡 中：若对应 spike spec 判 D1 丢弃，helper 无引用者可删 |

**不触碰**：`src/**`、`webview/src/**`、`vitest.config.ts`、`package.json`、根 gates/scripts。

## 6. Existing Constraints / Conventions

- **断言风格**：统一 `expect(...)`，无 BDD；测试标题为英文描述句（implementer 归并时保留原语义，仅加 `CAP-<DOMAIN>-<NNN>` 前缀或映射台账）。
- **import 约定**：产品模块用相对 `.ts` 后缀（`../src/xxx.ts`、`../../webview/src/xxx.ts`）；包用 `@deepseek-ai/dsh-*`；本地 helper 用 `./spike-*.ts`。归并后路径层级变化（`layer-a/`、`verifier-phase*/` → 顶层）时，所有 `../src/`、`../../webview/` 相对深度必须相应调整。
- **fixture 约定**：真实子进程用 `fixtures/fake-sdk-runtime.mjs`，通过 `fileURLToPath(new URL('./fixtures/fake-sdk-runtime.mjs', import.meta.url))` 定位（`gap-005-009-debt-fix.spec.ts:21`）。归并到顶层 `cap-*.spec.ts` 后 `./fixtures/` 仍可解析（fixtures 在 tests 根），无需改。
- **hook 约定**：`afterEach` 统一做临时目录清理（`rm(dirs.pop()!, { recursive: true, force: true })`，见 `spike-t0a-replay-rebuild.spec.ts:35`）；`beforeEach` 少用，无 `beforeAll`/`afterAll`（✅ CONFIRMED：全 61 文件 `beforeAll`/`afterAll` 计数为 0）。
- **命名铁律**：`CAP-<DOMAIN>-<NNN>` 全局唯一；`DOMAIN` 取 10 域 id（session-host / conversation / timeline / interaction / code-context / change-list / search / chat-panel / webview / test-harness）。

## 7. Risks / Unknowns

### R-1 跨文件 hook/fixture 依赖与作用域污染（✅ CONFIRMED 事实 + 风险判断）

**事实面**：
- **无跨文件共享的 `beforeEach`/`beforeAll`/`afterEach`**：每个 spec 的 hook 都是文件内联定义，作用域仅限本文件顶层 `describe`。全 61 文件 `beforeAll`/`afterAll` 计数为 0；`afterEach` 仅用于临时目录清理。
- **无 `vi.mock`**（模块级 mock 提升）：✅ CONFIRMED，grep `vi.mock(` 全库 0 命中。存在的是**用例内 `vi.spyOn(...).mockImplementation()`**（如 `session-host.spec.ts:258`、`phase1-auto-start.spec.ts:101` 等），这些 spy 在各自 `it` 块内创建、作用域局部，**不会跨 describe 提升污染**。
- **共享 fixture 仅 1 个**：`fixtures/fake-sdk-runtime.mjs`，被 **11 个 spec** 引用，且**跨 4 个域**：
  - session-host：`session-host.spec.ts`、`layer-v-inject-disconnect.spec.ts`
  - interaction：`interaction-fail-closed.e2e.spec.ts`、`interaction-fail-closed.integration.spec.ts`、`replaceability-interaction-ui.spec.ts`、`gap-005-009-debt-fix.spec.ts`
  - timeline：`timeline-diff.e2e.spec.ts`、`timeline-diff.integration.spec.ts`
  - conversation：`multi-tab-session.integration.spec.ts`、`multi-tab-dispose.e2e.spec.ts`、`panel-close-delete.e2e.spec.ts`
- **无 spec 互相 import**（✅ CONFIRMED，跨 spec import grep 0 命中）：每个 spec 自包含 import。

**风险判断**：
- `beforeEach`/`afterEach` 污染风险**低**：因无 `vi.mock`（提升）、无跨文件 hook，只要 implementer 把每个源文件的用例放进**独立的嵌套 `describe`**（不拍平到同一层），各源文件的 `afterEach`/`beforeEach` 天然隔离，**不会互相污染**。
- 唯一需注意：归并后 `afterEach` 临时目录清理若多个源文件都定义在顶层，会共享一个 `dirs` 数组——建议每个源文件保持独立局部数组（原样搬移即可，现有实现各自有 `dirs`/`roots` 局部变量）。
- **结论**：按域内**独立 `describe` 拍平**（而非拆文件），R-1 风险可控；`fake-sdk-runtime.mjs` 路径在归并后无需改。

### R-4 `.ts`/`.tsx` 同域混存（✅ CONFIRMED 事实 + ⚠️ 决策点）

- 事实：`webview` 域纯 `.tsx`（jsdom），无混存 → 安全。`chat-panel`、`change-list` 两域存在 **jsdom（`.ts` 带 pragma / `.tsx`）与 node 混存**。
- 风险：`// @vitest-environment jsdom` 是**文件级** pragma。若把 `layer-a/*.spec.ts`（jsdom）与顶层 `chat-ux-*`（node）合并进同一个 `cap-chat-panel.spec.ts`，会出现「同一文件内部分 describe 需要 jsdom、部分需要 node」的冲突，而 pragma 无法在 describe 级降级。
- 建议（供 implementer，⚠️ HYPOTHESIS 需 implementer 实测确认，见 §8）：`chat-panel`、`change-list` 两域拆出 jsdom 用例到独立子文件（如 `cap-chat-panel.dom.spec.ts` / `cap-change-list.dom.spec.ts`），或在单一 `.tsx` 域文件内用 `describe` + 手动挂 jsdom 环境（不可行则必须拆文件）。`webview` 域直接 `cap-webview.spec.tsx`。

### R-5 `it.each` 参数化用例的静态/运行时错位（✅ CONFIRMED）

- `sandbox-clean-state.spec.ts` 有 **2 条 `it.each`**（L157 8 组、L178 7 组），标题含 `%s` 占位符（`'refuses %s'`），静态台账只记 2 行，但运行时展开为 **15 个用例**。
- 归并 + `CAP-` 编号时必须**展开为字面标题**（15 个独立 `it`，各带独立 `CAP-TEST-HARNESS-NNN`），否则台账「556 静态」与「569 运行时」对不齐（Phase 1 实测 568 passed + 1 skipped = 569）。

### 其它风险

- ⚠️ **大域分层**：session-host（144）、test-harness（123）归并后单文件过大，需 `describe` 分层（按原源文件命名空间）以保证可读性。
- ⚠️ **`.skip` 用例**：`layer-a/foundation-render-probe.spec.ts:194` 的 `it.skip`（legacy fixture）在归并时需显式决策 keep/drop，不能静默保留 `.skip`。

## 8. Uncertain / Unverified

| 断言 | 确认度 | 影响 |
|---|---|---|
| `// @vitest-environment jsdom` 能否降级到 `describe` 块（而非仅文件级） | ❓ UNKNOWN（未实测） | 决定 R-4 是「拆文件」还是「describe 内嵌」；implementer 须先跑一个最小实验确认 |
| `vitest.config.ts` 是否已对 `.tsx` 施加 jsdom 默认（还是纯靠 per-file pragma） | ⚠️ HYPOTHESIS（根 `vitest.config.ts` 有 jsdom 相关配置行，但未确认 `environmentMatchGlobs` 是否覆盖 `.tsx`） | 影响 webview 域是否需要显式 pragma |
| 3 个 spike helper（`spike-attribution-helpers.ts` 等）是否有生产引用 | ❓ UNKNOWN（grep 只见测试内 import，未扫 `src/` 反向引用） | 若 D1 丢弃 spike spec，需先确认无生产引用再删 helper |
| `dsh.test.*` 命令在 `extension.ts` 中是否仅测试注入用途 | ⚠️ HYPOTHESIS（命名 `dsh.test.` 暗示测试专用，未逐条读 body） | 回填 `entryAssertions` 时标注「测试注入入口」vs「产品入口」 |

## 9. Stub Detection & Registry Cross-Validation

本 Phase 不生产新桩（纯测试归并，不写产品代码）。但需核验：**被归并测试断言的 SUT 是否落在 tech-debt-registry 已登记的桩上**。

### Registry 校验结果

读取 `tech-debt-registry.md`（`DEBT-1` 镜像原语、`DEBT-4`/`DEBT-5` 明确不由本工作流关闭）。交叉校验：

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|---|---|---:|---|---|
| DEBT-1（镜像原语） | `webview/src/` 与 `src/` 的镜像渲染原语 | 活跃 | 未深入核验（本 Phase 不碰） | ✅ 匹配（不在本 Phase 范围） |
| — | `src/replay-hydrator.ts` / `src/change/change-attributor.ts` / `src/continue-capability.ts` | 未注册为桩 | 已实现真实逻辑（✅ CONFIRMED，已读 body） | ✅ 非桩 |
| — | `tests/` 下 3 个 spike helper | 未注册 | 为测试辅助，非产品桩 | ✅ 非桩（属测试资产） |

### Stub Detection Summary

- ✅ Confirmed stubs: 0 个本 Phase 范围内的产品桩。
- ⚠️ Registry mismatch: 0 个。
- 🔴 Unregistered stubs: 0 个。
- 说明：Phase 2 为**纯测试归并**，不新增产品代码，故无新桩登记需求；归并后的用例若断言到已登记债务（如 DEBT-1 镜像原语），implementer 需在归并时于 `assertion-map.md` 对应行标注该债务依赖，供后续 Phase 决策。

## 10. Recommended Next Reads

1. ⭐ MUST READ — `design.md`（K1–K3/D1–D4 最终筛选规则、`CAP-` 编号约定、`assertion-map.md` schema、`capability-domains.json` 结构）
2. ⭐ MUST READ — `apps/vscode-dsh/tests/capability-domains.json`（10 域 absorbed 映射与 `entryAssertions` 骨架，本报告 §3.1/§4.1 与其对齐）
3. ⭐ MUST READ — `apps/vscode-dsh/tests/assertion-map.md`（556 行台账骨架，归并逐条回填对象）
4. 🔷 SHOULD READ — `phase-plan.md` 的 Phase 2 验收标准（16 条 AC）+ `requirements.md`（AC-1/3/6/7/8/9/10/11/12/13/24/25/26/27/28/29）
5. 🔷 SHOULD READ — 5 个 spike/gap spec 源文件（本报告 §3.2 的逐用例分析，implementer 落最终 D1/D3/D4 判定时需回读原文）
6. 🔷 SHOULD READ — `src/replay-hydrator.ts`、`src/change/change-attributor.ts`、`src/change/snapshot-store.ts`、`src/continue-capability.ts`（判 spike 用例「是否已固化」的依据）
7. 🔹 OPTIONAL — `src/extension.ts`（§4.1 入口命令的 body，回填 `entryAssertions.caps` 时需读）
8. 🔹 OPTIONAL — Phase 1 `implementation.md`（冻结基线的 61 文件清单与脚本退出码，交叉核对）
