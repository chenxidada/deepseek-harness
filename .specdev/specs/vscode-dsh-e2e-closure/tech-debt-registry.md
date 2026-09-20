# Tech Debt Registry

> 这是本工作流中所有已知技术债的 **唯一定义来源**。
> 所有 Phase 的 agent 共写共读。写入新债，读取已有债，解决后更新状态。

---

## 活跃债务

<!--
  ID 格式：STUB-xxx（桩代码）/ GAP-xxx（功能缺失）/ DEBT-xxx（其他技术债）
  状态：🔴 阻塞 / 🟡 非阻塞
  类型：空实现 / 假返回值 / 流程骨架 / 条件桩 / 类型占位
  来源：implementation.md / review.md / verification.md / scope-gap-report.md

  结构化索引字段（标签列）：
  - module:<name> — 所属模块。例：module:gateway
  - type:<stub|gap|debt> — 债务类型
  - concern:<topic> — 关注领域。例：concern:auth, concern:export
  - bind:<binding> — 绑定关系。例：bind:someip, bind:grpc
  标签 + depends_on → agent 精确查询。例：查「标签含 gateway 的 🔴阻塞项」→ 2 条，不扫全表
-->

| ID | 源Phase | 模块 | 文件:函数:行号 | 当前行为 | 预期行为 | 类型 | 标签 | 依赖它的模块 | 目标Phase | 阻塞 | 来源 | 注册日期 |
|----|:------:|------|---------------|---------|---------|------|------|-------------|:--------:|:---:|------|---------|
| DEBT-2 | phase-2-session-main-path-llm | sdk/server + test-harness | `packages/sdk/server/src/server.ts`（`createForkedSession`，emptySeed 分支）+ `apps/vscode-dsh/src/conversation-controller.ts`（`forkFromClosedTurn` retry 路径） | `forkFromClosedTurn({intent:'retry'})` 对 turn 1 用 `emptySeed:true` 派生子 Agent；测试环境挂载的 shadow preset `specdev-orchestrator`（自主编排 persona）使子 Agent 在**收到 retry 提示词之前**即自启动「无任务 → 检查活跃工作流 → 继续 SpecDev」的自主 loop，导致 retry 提示词成为排队中的后续输入而非首轮触发输入，`cap-fork-from-closed-turn` 的 `child-replied` 步（`$assistantClosed:LAYER-V-CAP-33-OK`）真机超时；**Phase 3 真机复现**（runId `20260919T184505Z-3031408`）：`closed-turn`/`fork-retry` 断言均过、子会话已派生（`breadcrumb.parentSessionId` 存在、title「派生自 新对话」），但 `child-replied` 等待 300s 超时，子会话仅含 system-reminder 用户消息、无首轮 assistant 回复 | emptySeed 分叉的子会话能直接以 retry 提示词触发首轮真实模型往返（回显 marker），而非自主编排自启动 | 功能缺失（测试可达性） | `module:sdk-server, type:gap, concern:fork-emptyseed-autostart` | `conversation-controller.forkFromClosedTurn`（retry 自动重发） | 后续 feature（forkFromClosedTurn emptySeed 自启动语义） | 🟡非阻塞 | implementation.md（phase-2 偏差 1，真机 LINK_FAILURE） | 2026-09-18 |
| DEBT-3 | phase-2-session-main-path-llm | test-harness（流式增量断言） | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`（`cap-message-store-stream-patch` #18 的 `stream` 步 `requireIncrement:true, intervalMs:150`） | #18 `cap-message-store-stream-patch` 的流式增量（`sawStreaming`/`sawGrowth`）跨运行**波动**：较早完整带 key run 为 `true`，最新完整带 key run（runId 20260918T122452Z-1400184）为 `false`（"stream settled but no incremental state was observed (sawStreaming=false, sawGrowth=false)"）；`requireIncrement:true` 机制正确工作（真实捕获了无增量，非假阳性），但 #18 的流式响应节奏在完整 14 项 run 中偶发快到 150ms 轮询无法捕获中间态；#20/#21 稳定为 true；**Phase 3 真机复现**（runId `20260919T174812Z-2275800`）：#18 `cap-message-store-stream-patch` 再 LINK_FAILURE（`no streaming increment observed at "streamed-message"`），同批 session-main-path 其余 7 项模型能力均闭环 | #18 的流式增量在完整 run 中也能稳定被 150ms 轮询捕获（或调大轮询粒度/换更稳健的分段指令） | 已知缺陷（时序敏感） | `module:layer-v-capability-driver, type:debt, concern:stream-increment-observability` | `capability-runner.cjs`（`requireIncrement` 增量门控） | 后续 feature（流式增量观测稳健性） | 🟡非阻塞 | verification.md（phase-2 独立真机复验发现跨 run 波动） | 2026-09-18 |
| DEBT-7 | phase-2-drive-nonmodel | layer-v-capability-driver | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`（`cap-react-spa-root` / `cap-tab-chrome` / `cap-composer` / `cap-delete-confirm-modal` / `cap-chat-ui-store` / `cap-message-bridge` / `cap-editor-panel-viewtype` / `cap-react-spa-html-builder` / `cap-webview-html-injection`） | 9 项能力真机运行后 `closedLoop.closed=false`，缺 `concreteAssertion` + `actualTrigger`（runId `20260919T171809Z`）：这些是 **webview 内部 React 组件 / 面板创建副作用**（App 根 / TabChrome / Composer / 删除确认 Modal / chat-ui-store / message-bridge / viewType / SPA HTML 构建器 / webview HTML 注入），host 侧无任何 `dsh.test.*` 接口暴露其「渲染结果」——现有断言只有弱证据 `panelOpen:true` / `viewId`（自指 `dsh.showPanel` 返回，非组件渲染结果） | 为 webview 内部组件补充 host 侧渲染探测通道（如 webview 内 `data-testid` + `panelSnapshot` 扩展渲染状态 / 截图断言原语），使 `concreteAssertion` 可判定；否则这些项维持「未闭环」登记，不作为 feature UI PASS 证据 | 功能缺失（未验证：缺 host 侧探测 hook） | `module:layer-v-capability-driver, type:gap, concern:webview-internal-observability, group:react-spa-main, group:editor-panel` | 无（覆盖缺口，非接口依赖） | 后续 feature（webview 探测通道） | 🟡非阻塞 | implementation.md（phase-2 真机驱动 9/18 未闭环） | 2026-09-20 |
| DEBT-8 | phase-2-drive-nonmodel | layer-v-capability-driver | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`（`cap-history-panel` / `cap-message-list-streaming`） | 2 项能力真机运行后 `closedLoop.closed=false`，缺 `actualTrigger` + `concreteAssertion`（runId `20260919T171809Z`）：`cap-history-panel` 的 host 侧可观测 `dsh.test.listHistory` 在**无模型往返**时返回空（真实历史会话需 `firstUserPreview`，仅模型往返后产生；`isHistoryEligibleSession` 排除空 title 会话）；`cap-message-list-streaming` 的流式内容需模型往返且无 host 侧流式探测 hook。两项当前 manifest 仅 `dsh.showPanel` + `panelOpen:true` 弱断言，`dsh.showPanel` 属 UI-prep 不构成 actualTrigger。两项均标 `requiresModel:false`，本 Phase 不触发模型；Phase 3 未翻 `requiresModel:true`（task 约束「只动 23 项 `requiresModel:true`、不改 `requiresModel`/`ac` 字段」，此 2 项不在 23 项内） | 历史窗口/流式列表的真机闭环需模型往返：将这两项的 `requiresModel` 改为 `true` 并交 Phase 3 带 key 驱动（`cap-history-panel` 用 `sendPrompt`→`listHistory` 断言 `firstUserPreview`；`cap-message-list-streaming` 用 `$assistantContains` 流式断言），或补一个「仅注入用户消息不等待模型」的测试钩子 | 功能缺失（未验证：依赖模型往返） | `module:layer-v-capability-driver, type:gap, concern:model-dependent-observability, group:react-spa-main` | 无（覆盖缺口，非接口依赖） | 后续 feature（history/streaming 模型往返闭环） | 🟡非阻塞 | implementation.md（phase-2 真机驱动 2/18 未闭环，需模型） | 2026-09-20 |
| DEBT-9 | phase-3-drive-model | code-context（selection-ask） | `apps/vscode-dsh/src/code-context/selection-ask.ts`（`runAskAboutSelection` 防泄漏检查 :182） | `runAskAboutSelection` 的防泄漏检查用 `pointerText.includes(doc.languageId)` 裸子串匹配。当文件名的 `languageId` 恰好是路径子串时（如 `package.json` 的 `languageId` 为 `json`，是文件名 `package.json` 的子串），合法路径被误判为「languageId 泄漏」→ 返回 `{ok:false, reason:'path-unrepresentable'}`。Phase 3 真机取证（runId `20260919T175005Z-2293565`）：`cap-selection-ask` 以 `apps/vscode-dsh/package.json` 为探针文件时 `ask-about-selection` 步断言失败（`path-unrepresentable`），manifest 改用 `apps/vscode-dsh/src/index.ts`（`languageId` `typescript` 无子串冲突）后闭环 | 防泄漏检查应验证 languageId 是否作为**完整 token** 泄漏进 pointerText（按词边界/`/` 分隔符判断），而非裸子串包含；或改为「是否把 selection body / languageId 拼接进 pointerText」而非「文件名是否含 languageId 子串」 | 已知缺陷（误报边界） | `module:code-context, type:debt, concern:selection-ask-path-unrepresentable` | `dsh.test.askAboutSelection`（test-harness 探针） | 后续 feature（修复 selection-ask 防泄漏误报） | 🟡非阻塞 | implementation.md（phase-3 真机取证，探针文件 `package.json` 触发；manifest 已改用 `src/index.ts` 规避） | 2026-09-20 |
| DEBT-10 | phase-3-drive-model | layer-v-capability-driver（subagent 组） | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`（`cap-open-subagent-context` / `cap-pin-subagent-tab`）+ `apps/vscode-dsh/src/extension.ts`（`dsh.test.injectSubagent` :1315-1333） | 两项 `requiresModel:true` 的 subagent 能力（`cap-open-subagent-context`/`cap-pin-subagent-tab`）的步骤用 `dsh.test.injectSubagent`（`applyTestSubagentNotification` 测试注入模拟子会话启动/结束），**不含真实模型往返**（无 `sendPrompt`→`assistant-replied` 首轮 LLM 往返、无子 Agent 真实委托）。runner 的 `assessClosedLoop` 将 `inject-child-started`（非 UI-prep 命令）判为 `actualTrigger`，故 `closedLoop.closed=true`，但该 trigger 是测试注入而非「真实模型委托子 Agent」——AC-9「真实 LLM 往返」不满足 | 若 `requiresModel:true` 语义是「需真实模型委托子 Agent」，改用真实委托路径（父会话 `sendPrompt` 触发 Task 工具委托 → 断言子会话 assistant 回复）；或确认其 `requiresModel` 应为 `false`（子会话上下文/固定 tab 是 UI 机制，无需模型）并相应收窄 AC-9 适用范围 | 功能缺失（覆盖缺口：标记与步骤语义不一致） | `module:layer-v-capability-driver, type:gap, concern:subagent-injection-not-model, group:subagent` | 无（覆盖缺口，非接口依赖） | 后续 feature（subagent 真实模型委托闭环） | 🟡非阻塞 | implementation.md（phase-3 真机驱动，2 项 closedLoop=true 但无真实模型往返） | 2026-09-20 |
| DEBT-11 | phase-4-orchestration-regression | test-scripts（回归护栏） | `apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh`（全文，头部已标 obsolete） | 头部已加 obsolete 注释（方案 C：标记过时、不删不改逻辑）。脚本仍引用 10 个已被 vscode-dsh-test-consolidation 归并为 `cap-*.spec.ts` 的不存在测试文件（`chat-ready-regression.spec.ts` / `auto-start-orchestrator.spec.ts` / `phase1-auto-start.spec.ts` / `phase2-auto-ready.spec.ts` / `phase3-chat-ui-chassis.spec.ts` / `phase4-new-conversation-chrome.spec.ts` / `phase5-should-polish.spec.ts` / `phase3-restart-continue.spec.ts` / `phase2-multitab-history-replay.spec.ts` / `panel-close-delete.e2e.spec.ts`），并交叉引用异工作流 registry（`vscode-dsh-chat-ready`）。回归职责已由 `pnpm exec vitest run apps/vscode-dsh/tests` 覆盖，脚本不再单独维护 | 后续 feature 清理该过时脚本及其 4 处守卫引用（`cap-test-harness.spec.ts` CAP-TEST-HARNESS-083 existsSync 断言、`scripts/check-test-scripts-syntax.sh` pinned、`tests/capability-domains.json` :20/:657、`apps/vscode-dsh/README.md`+README.zh.md :22） | 已知缺陷（过时待清理） | `module:test-scripts, type:debt, concern:chat-ready-regression-obsolete` | `cap-test-harness.spec.ts`（CAP-TEST-HARNESS-083）、`scripts/check-test-scripts-syntax.sh`、`tests/capability-domains.json`、`apps/vscode-dsh/README.md` | 后续 feature（清理 chat-ready 过时脚本及其守卫引用） | 🟡非阻塞 | implementation.md（phase-4 方案 C 决策） | 2026-09-20 |
| DEBT-12 | phase-4-orchestration-regression | layer-v-capability-driver（全链编排入口） | `apps/vscode-dsh/test-scripts/run-vscode-dsh-e2e-closure.sh`（全链串行跑）+ `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`（`cap-extension-activate` / `cap-test-hooks` / `cap-open-subagent-context` 断言） | 全链入口一键跑 41 项真机验证（runId `20260920T003919Z-3464550` nonmodel / `20260920T003933Z-3470490` model）暴露两类**串行状态污染**，整体 exit 1：① nonmodel batch 中 `cap-extension-activate`（断言 `dsh.test.simulateStartupOnly` 返回 `startState:"idle"`）与 `cap-test-hooks`（断言 `dsh.test.getStartState` 返回 `state:"idle"`）硬编码 idle 初始态，但前面 webview/panel 能力（`dsh.showPanel` 打开 conversation view）已把 orchestrator 推进 `started`（`lastReason:"conversation-view-visible"`）→ 2 项 LINK_FAILURE；② model batch 中 `cap-open-subagent-context` 的 `dsh.test.openSubagent` 把 tab 切到 `readonly-live` 子 context 且未复位，后续 13 项（`cap-selection-ask` + change-list 3 + search 2 + fork 2 + continue 3 + history 2）的 `dsh.test.sendPrompt` 全部返回 `{ok:false, reason:"readonly-live"}` → 13 项 LINK_FAILURE | 全链入口在 capability 间做状态隔离（每项能力独立 host / 独立 tab 且用后复位 / 或断言不依赖 host 初始态与 tab readonly 态），使 41 项可可靠一键跑通；否则全链入口无法作为可靠的全量验证入口（其「一键验证 41 项」价值主张不成立） | 功能缺失（串行状态污染） | `module:layer-v-capability-driver, type:gap, concern:per-capability-state-isolation` | `run-vscode-dsh-e2e-closure.sh`（全链入口） | 后续 feature（全链入口状态隔离） | 🟡非阻塞 | 真机验证（全链 run 20260920T003919Z / 003933Z，exit 1） | 2026-09-20 |

## 已解决

| ID | 源Phase | 描述 | 解决Phase | 解决日期 | 验证方式 |
|----|:------:|------|:--------:|---------|---------|
| DEBT-1 | phase-1-driver-framework-pilot | `capability-runner.cjs` 与 `layer-v-driver/extension.cjs` 的 13+ 原语曾是独立镜像拷贝（非 `require` 复用）；现已抽出共享模块 `layer-v-support/primitives.cjs`，`capability-runner.cjs` 在 `:49-65` `require('../layer-v-support/primitives.cjs')`，镜像拷贝已消除 | phase-1-closure-foundation | 2026-09-20 | 静态检查：`capability-runner.cjs:49-65` 头部即「DEBT-1 dedup, AD-2 reuse」的 `require`，文件中无 `StageError`/`linkFailure`/`harnessError` 等的本地重复定义 |
| DEBT-4 | phase-3-remaining-capabilities | change-list 3 项（`cap-change-index-store` / `cap-snapshot-revert` / `cap-change-diff-render`）从未真机执行 | phase-3-drive-model | 2026-09-20 | Phase 3 带真实 key 逐项驱动（runId `20260919T184241Z-2993792`）：3 项均 `conclusion=PASS` + `closedLoop.closed=true`（`actualTrigger`/`concreteAssertion`/`realScreenshot` 三齐）。`list-changes` 断言返回真实 change 条目（`kind:"modified"` + `path` + `changeId`），`send-edit-prompt`→`assistant-replied` 确认模型真实调用 edit 工具修改探针文件 |
| DEBT-5 | phase-3-remaining-capabilities | `cap-selection-ask`（`requiresModel:true`）仍未取证 | phase-3-drive-model | 2026-09-20 | Phase 3 带真实 key 驱动（runId `20260919T185118Z-3121871`）：`conclusion=PASS` + `closedLoop.closed=true`，`ask-about-selection` 返回具体 `pointerText`（`@apps/vscode-dsh/src/index.ts 的 1-2 行`）+ `assistant-replied`（`$assistantContains:LAYER-V-CAP-26-OK`）真实模型往返；负向 run（`env -u DEEPSEEK_API_KEY`）`SKIPPED_NO_CREDENTIALS` exit 3 |
| DEBT-6 | phase-1-closure-foundation | per-run 改造后 driver `activate()` 兜底 status/journal 仍写 `FALLBACK_ARTIFACT_DIR`（base 平铺），而 shell `rm -f` 现只清 `RUN_DIR` → 兜底孤儿文件 | phase-4-orchestration-regression | 2026-09-20 | 静态检查：`run-layer-v-capabilities.sh` 在 `mkdir RUN_DIR` 后 `rm -f` 一并清 `${ARTIFACT_DIR}/layer-v-capabilities-status.json` + `${ARTIFACT_DIR}/layer-v-capabilities-journal.jsonl`；`bash -n` 与 `scripts/check-test-scripts-syntax.sh` 均通过 |

---

## 维护规则

### 谁写入
- **implementer**：创建 `@STUB(phase-N)` 后立即注册到「活跃债务」。编码完成后检查是否有未注册的桩。
- **reviewer**：发现 implementer 未标注的桩/缺陷 → 新增条目到「活跃债务」
- **verifier**：独立验证发现疑似桩或已知缺陷 → 新增条目到「活跃债务」
- **Cursor Agent**（Phase Closure）：从 scope-gap-report.md 中同步推迟项到注册表

### 谁读取
- **code-explorer**（Phase 准备阶段）：读注册表，交叉验证代码中的桩 → 输出到 `repo-exploration.md` §9
- **plan-generator**：设计时检查 registry，确认依赖接口是否已有 stubs
- **implementer**：编码前读 registry，不把桩当真实现
- **reviewer**：审查时对照 registry，已知桩不误报为「发现」
- **verifier**：验证时对照 registry，已知桩跳过行为验证

### 谁更新状态
- **implementer**：实现之前注册的桩 → 从「活跃债务」移到「已解决」
- **reviewer**：确认桩已填实 → 可标记为已解决
- **verifier**：验证通过 → 确认可关闭
- **Cursor Agent**（Phase Closure）：标记不再适用的过时项 → ⚠️ 标记

### 字段规范

| 字段 | 说明 | 必须在 |
|------|------|:--:|
| **ID** | `STUB-N`(桩) / `GAP-N`(功能缺失) / `DEBT-N`(其他) | ✅ |
| **源Phase** | 产生该债的 Phase | ✅ |
| **模块** | 所属模块名 | ✅ |
| **文件:函数:行号** | 精确代码定位 | ✅ |
| **当前行为** | 代码实际做什么，不是意图 | ✅ |
| **预期行为** | 完整实现应该怎么做 | ✅ |
| **类型** | `空实现` / `假返回值` / `流程骨架` / `条件桩` / `类型占位` / `功能缺失` / `已知缺陷` / `性能问题` | ✅ |
| **标签** | `module:<name>`, `type:<stub\|gap\|debt>`, `concern:<topic>`, `bind:<binding>` | ✅ |
| **依赖它的模块** | 哪些模块依赖这个接口 | 🟡 尽量填 |
| **目标Phase** | 计划在哪个 Phase 解决 | ✅ |
| **阻塞** | 🔴阻塞 / 🟡非阻塞 | ✅ |
| **来源** | 谁发现的（implementation.md / review.md / verification.md / scope-gap-report.md） | ✅ |
| **注册日期** | ISO 日期 | ✅ |

### 标签规范
- 每个条目必须有 `module:` 和 `type:` 标签
- `concern:` 和 `bind:` 可选，尽可能填写以提高查询精度
- 标签使用英文小写，多词用连字符连接
- 例：`module:auth-service, type:stub, concern:password-reset, bind:email`

### 查询指引（各 agent 如何精确查询）

| Agent | 查询方式 | 示例 |
|-------|---------|------|
| **plan-generator** | 查目标Phase=N AND 阻塞=🔴 → 按标签分组 | "下一 Phase 继承了哪些阻塞债务" |
| **implementer** | 查文件:函数精确匹配 → 已知桩不当真实现 | "我依赖的这个接口是桩吗" |
| **reviewer** | 查文件含当前目录前缀 → 已知桩不重复发现 | "我审查的代码里哪些函数是已知桩" |
| **verifier** | 查阻塞=🔴 且不在已解决表中 → 跳过验证 | "哪些已知问题不需要现在验证" |
| **code-explorer** | 逐行按文件:函数:行号验证代码是否匹配 | "registry 里的桩还在代码里吗" |

### 去重与清理
- 写入前搜索标签和文件:函数避免重复
- Phase Closure 时检查文件路径/函数名是否变化 → 标记 ⚠️ 或更新
- Phase 间传递的债务不重复注册

### Phase Entry Gate 联动
- 进入新 Phase 前，Cursor Agent 读取本文件
- 筛选「目标Phase = 当前Phase」且「阻塞 = 🔴」的条目
- 向用户呈现继承的债务清单，用户确认后正式开始 Phase
- 用户可选：(a) 本 Phase 优先解决 (b) 推迟 (c) 取消
- 根据决策更新 registry 中的目标Phase
