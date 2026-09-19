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
| DEBT-2 | phase-2-session-main-path-llm | sdk/server + test-harness | `packages/sdk/server/src/server.ts`（`createForkedSession`，emptySeed 分支）+ `apps/vscode-dsh/src/conversation-controller.ts`（`forkFromClosedTurn` retry 路径） | `forkFromClosedTurn({intent:'retry'})` 对 turn 1 用 `emptySeed:true` 派生子 Agent；测试环境挂载的 shadow preset `specdev-orchestrator`（自主编排 persona）使子 Agent 在**收到 retry 提示词之前**即自启动「无任务 → 检查活跃工作流 → 继续 SpecDev」的自主 loop，导致 retry 提示词成为排队中的后续输入而非首轮触发输入，`cap-fork-from-closed-turn` 的 `child-replied` 步（`$assistantClosed:LAYER-V-CAP-33-OK`）真机超时 | emptySeed 分叉的子会话能直接以 retry 提示词触发首轮真实模型往返（回显 marker），而非自主编排自启动 | 功能缺失（测试可达性） | `module:sdk-server, type:gap, concern:fork-emptyseed-autostart` | `conversation-controller.forkFromClosedTurn`（retry 自动重发） | phase-5-cleanup-orchestration-regression | 🟡非阻塞 | implementation.md（phase-2 偏差 1，真机 LINK_FAILURE） | 2026-09-18 |
| DEBT-3 | phase-2-session-main-path-llm | test-harness（流式增量断言） | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`（`cap-message-store-stream-patch` #18 的 `stream` 步 `requireIncrement:true, intervalMs:150`） | #18 `cap-message-store-stream-patch` 的流式增量（`sawStreaming`/`sawGrowth`）跨运行**波动**：较早完整带 key run 为 `true`，最新完整带 key run（runId 20260918T122452Z-1400184）为 `false`（"stream settled but no incremental state was observed (sawStreaming=false, sawGrowth=false)"）；`requireIncrement:true` 机制正确工作（真实捕获了无增量，非假阳性），但 #18 的流式响应节奏在完整 14 项 run 中偶发快到 150ms 轮询无法捕获中间态；#20/#21 稳定为 true | #18 的流式增量在完整 run 中也能稳定被 150ms 轮询捕获（或调大轮询粒度/换更稳健的分段指令） | 已知缺陷（时序敏感） | `module:layer-v-capability-driver, type:debt, concern:stream-increment-observability` | `capability-runner.cjs`（`requireIncrement` 增量门控） | phase-5-cleanup-orchestration-regression | 🟡非阻塞 | verification.md（phase-2 独立真机复验发现跨 run 波动） | 2026-09-18 |
| DEBT-4 | phase-3-remaining-capabilities | layer-v-capability-driver | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`（`cap-change-index-store` / `cap-snapshot-revert` / `cap-change-diff-render`） | 三项能力的 steps 与断言已写入 manifest（10–13 步 / 4–7 断言 / 1 截图步骤），但**从未真机执行**：整个 `apps/vscode-dsh/test-artifacts/**` 下匹配这三个 id 的取证文件数为 0（无 `.status.json` / `.summary.json` / 截图） | 带真实 `DEEPSEEK_API_KEY` 逐项执行 `run-layer-v-capabilities.sh --capability <id>`，产出 `conclusion=PASS` + 截图取证，覆盖 AC-7 / AC-10 | 功能缺失（未验证） | `module:layer-v-capability-driver, type:gap, concern:unverified-capabilities, group:change-list` | 无（覆盖缺口，非接口依赖） | 补跑：整合工作流之后 | 🔴阻塞 | 调度者收尾核对（用户决定降范围关闭 Phase 3） | 2026-09-19 |
| DEBT-5 | phase-3-remaining-capabilities | layer-v-capability-driver | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`（`cap-selection-ask`） | 五项中 **4 项已在 Phase 2 真机闭环**（`cap-at-path-token` / `cap-workspace-path-resolve` / `cap-interaction-coordinator` / `cap-interaction-ui`，runId `20260919T171443Z` / `20260919T171640Z`，均 `conclusion=PASS` + `closedLoop.closed=true`）；仅 `cap-selection-ask`（`requiresModel:true`，AC-9 真实模型往返）**仍未取证** | Phase 3 带真实 key 驱动 `cap-selection-ask` 并取证；按 AC-9 补 `env -u DEEPSEEK_API_KEY` 负向 run（断言 `SKIPPED_NO_CREDENTIALS` exit 3，不记 PASS） | 功能缺失（未验证） | `module:layer-v-capability-driver, type:gap, concern:unverified-capabilities, group:code-context` | 无（覆盖缺口，非接口依赖） | phase-3-drive-model | 🟡非阻塞 | implementation.md（phase-2 真机闭环 4/5，剩模型项） | 2026-09-19 |
| DEBT-6 | phase-1-closure-foundation | layer-v-capability-driver | `apps/vscode-dsh/test-scripts/layer-v-capability-driver/extension.cjs`（`activate()` 的「driver-failed-before-run」兜底路径） | per-run 改造后 `activate()` 兜底 status/journal 仍写 `FALLBACK_ARTIFACT_DIR`（base 平铺），而 shell `wait_for_status` 只读 `RUN_DIR`。后果：① 兜底失败 reason（`plan-not-an-object` 等）到不了 shell，shell 只报泛化「no status file within timeout」；② 兜底 status/journal 落 base 目录，shell `rm -f`（现只清 `RUN_DIR`）不再清理 → 孤儿文件。fail-closed 未破（shell 仍 HARNESS_ERROR，无假 PASS）；「reason 丢失」是既有事实（兜底 status 无 `runId`，改造前 `status_belongs_to_this_run` 也会拒绝），本 Phase 净新增仅「孤儿文件不清理」 | shell `wait_for_status` 超时后额外探测 base 路径兜底 status 以回收 reason；或在 `rm -f` 时一并清 base 路径兜底 status/journal | 已知缺陷 | `module:layer-v-capability-driver, type:debt, concern:driver-failed-before-run-fallback` | 无（诊断路径，非接口依赖） | phase-4-orchestration-regression | 🟡非阻塞 | review-connectivity.md（Phase 1 SHOULD-FIX） | 2026-09-19 |
| DEBT-7 | phase-2-drive-nonmodel | layer-v-capability-driver | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`（`cap-react-spa-root` / `cap-tab-chrome` / `cap-composer` / `cap-delete-confirm-modal` / `cap-chat-ui-store` / `cap-message-bridge` / `cap-editor-panel-viewtype` / `cap-react-spa-html-builder` / `cap-webview-html-injection`） | 9 项能力真机运行后 `closedLoop.closed=false`，缺 `concreteAssertion` + `actualTrigger`（runId `20260919T171809Z`）：这些是 **webview 内部 React 组件 / 面板创建副作用**（App 根 / TabChrome / Composer / 删除确认 Modal / chat-ui-store / message-bridge / viewType / SPA HTML 构建器 / webview HTML 注入），host 侧无任何 `dsh.test.*` 接口暴露其「渲染结果」——现有断言只有弱证据 `panelOpen:true` / `viewId`（自指 `dsh.showPanel` 返回，非组件渲染结果） | 为 webview 内部组件补充 host 侧渲染探测通道（如 webview 内 `data-testid` + `panelSnapshot` 扩展渲染状态 / 截图断言原语），使 `concreteAssertion` 可判定；否则这些项维持「未闭环」登记，不作为 feature UI PASS 证据 | 功能缺失（未验证：缺 host 侧探测 hook） | `module:layer-v-capability-driver, type:gap, concern:webview-internal-observability, group:react-spa-main, group:editor-panel` | 无（覆盖缺口，非接口依赖） | 后续 feature（webview 探测通道） | 🟡非阻塞 | implementation.md（phase-2 真机驱动 9/18 未闭环） | 2026-09-20 |
| DEBT-8 | phase-2-drive-nonmodel | layer-v-capability-driver | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`（`cap-history-panel` / `cap-message-list-streaming`） | 2 项能力真机运行后 `closedLoop.closed=false`，缺 `actualTrigger` + `concreteAssertion`（runId `20260919T171809Z`）：`cap-history-panel` 的 host 侧可观测 `dsh.test.listHistory` 在**无模型往返**时返回空（真实历史会话需 `firstUserPreview`，仅模型往返后产生；`isHistoryEligibleSession` 排除空 title 会话）；`cap-message-list-streaming` 的流式内容需模型往返且无 host 侧流式探测 hook。两项当前 manifest 仅 `dsh.showPanel` + `panelOpen:true` 弱断言，`dsh.showPanel` 属 UI-prep 不构成 actualTrigger。两项均标 `requiresModel:false`，本 Phase 不触发模型 | 历史窗口/流式列表的真机闭环需模型往返：将这两项的 `requiresModel` 改为 `true` 并交 Phase 3 带 key 驱动（`cap-history-panel` 用 `sendPrompt`→`listHistory` 断言 `firstUserPreview`；`cap-message-list-streaming` 用 `$assistantContains` 流式断言），或补一个「仅注入用户消息不等待模型」的测试钩子 | 功能缺失（未验证：依赖模型往返） | `module:layer-v-capability-driver, type:gap, concern:model-dependent-observability, group:react-spa-main` | 无（覆盖缺口，非接口依赖） | phase-3-drive-model | 🟡非阻塞 | implementation.md（phase-2 真机驱动 2/18 未闭环，需模型） | 2026-09-20 |

## 已解决

| ID | 源Phase | 描述 | 解决Phase | 解决日期 | 验证方式 |
|----|:------:|------|:--------:|---------|---------|
| DEBT-1 | phase-1-driver-framework-pilot | `capability-runner.cjs` 与 `layer-v-driver/extension.cjs` 的 13+ 原语曾是独立镜像拷贝（非 `require` 复用）；现已抽出共享模块 `layer-v-support/primitives.cjs`，`capability-runner.cjs` 在 `:49-65` `require('../layer-v-support/primitives.cjs')`，镜像拷贝已消除 | phase-1-closure-foundation | 2026-09-20 | 静态检查：`capability-runner.cjs:49-65` 头部即「DEBT-1 dedup, AD-2 reuse」的 `require`，文件中无 `StageError`/`linkFailure`/`harnessError` 等的本地重复定义 |

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
