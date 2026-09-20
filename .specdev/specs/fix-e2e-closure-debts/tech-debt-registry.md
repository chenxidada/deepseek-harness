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
| DEBT-2 | phase-2-session-main-path-llm | sdk/server + test-harness | `packages/sdk/server/src/server.ts`（`createForkedSession`，emptySeed 分支 + `:473/:482/:493-495` fork 子会话继承父 preset）+ `apps/vscode-dsh/src/conversation-controller.ts`（`forkFromClosedTurn` retry 路径） | `forkFromClosedTurn({intent:'retry'})` 对 turn 1 用 `emptySeed:true` 派生子 Agent；测试环境挂载的 shadow preset `specdev-orchestrator`（自主编排 persona）使子 Agent 在**收到 retry 提示词之前**即自启动「无任务 → 检查活跃工作流 → 继续 SpecDev」的自主 loop，导致 retry 提示词成为排队中的后续输入而非首轮触发输入，`cap-fork-from-closed-turn` 的 `child-replied` 步（`$assistantClosed:LAYER-V-CAP-33-OK`）真机超时；子会话仅含 system-reminder 用户消息、无首轮 assistant 回复。**AC-13 登记（phase-2 批次 4）**：fork 子会话的 preset 由产品/SDK 代码硬编码继承父 preset（`server.ts:473` `composedPreset(parentAgent.ctx)` + `:482` `meta.agentPreset=parentPreset` + `:493-495` `composeFrom(childCtx, parentAgent.ctx)`），fork RPC options 仅携带 `emptySeed`/`boundarySeq`/`childSessionId`，**无 `agentPreset` 覆盖 seam**；在测试 harness 侧加独立 preset 文件或改 shadow preset 内容均无法让 fork 子会话改用非自主编排 preset | emptySeed 分叉的子会话能直接以 retry 提示词触发首轮真实模型往返（回显 marker），而非自主编排自启动；需在 SDK 分叉语义中为 fork 子会话提供「非继承父 preset」的选项（超出本工作流「不改产品/SDK 分叉语义」授权） | 功能缺失（测试可达性；需改 SDK 分叉 preset 继承语义） | `module:sdk-server, type:gap, concern:fork-emptyseed-autostart` | `conversation-controller.forkFromClosedTurn`（retry 自动重发） | 后续 Phase（本工作流外：需改 SDK `createForkedSession` fork preset 继承） | 🟡非阻塞 | implementation.md（phase-2 偏差 1 真机 LINK_FAILURE + 批次 4 AC-13 登记） | 2026-09-18 |
| DEBT-3 | phase-2-session-main-path-llm | test-harness（流式增量断言） | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`（`cap-message-store-stream-patch` #18 的 `stream` 步 `requireIncrement:true, intervalMs:150`） | #18 `cap-message-store-stream-patch` 的流式增量（`sawStreaming`/`sawGrowth`）跨运行**波动**：`requireIncrement:true` 机制正确工作（真实捕获了无增量），但 #18 的流式响应节奏在完整 run 中偶发快到 150ms 轮询无法捕获中间态 | #18 的流式增量在完整 run 中也能稳定被轮询捕获（或调大轮询粒度/换更稳健的分段指令） | 已知缺陷（时序敏感） | `module:layer-v-capability-driver, type:debt, concern:stream-increment-observability` | `capability-runner.cjs`（`requireIncrement` 增量门控） | 后续 Phase | 🟡非阻塞 | verification.md（phase-2 二轮真机复验：隔离 3×pass 但全链 model 批 1×fail，`intervalMs:150→50` 未彻底消除波动） | 2026-09-18 |
| DEBT-13 | phase-2-realmachine-infra | layer-v-capability-driver | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`（`cap-delete-confirm-modal`） | `cap-delete-confirm-modal` 的 `DeleteConfirmModal` 仅在 `chat-ui-store.deleteConfirm` 被置位时渲染（`App.tsx:131` 条件渲染），而 `openDeleteConfirm` 仅被 TabChrome 溢出菜单 / HistoryPanel 的 webview 内部点击触发，host 侧无任何 test hook 可触发；默认 `dsh.showPanel` 状态下 `delete-confirm-modal` testid 不出现，`renderState.deleteConfirmModal` 恒为 false | 为 delete 确认弹窗补 host 侧可触发的渲染信号（如新增测试专用 `open-delete-confirm` 探测帧，或改由 `dsh.test.deleteConversation` 进入 confirm 分支），使 `renderState.deleteConfirmModal` 可判定 | 功能缺失（未验证：modal 条件渲染无 host 侧触发） | `module:layer-v-capability-driver, type:gap, concern:webview-delete-confirm-unreachable, group:react-spa-main` | 无（覆盖缺口，非接口依赖） | 后续 Phase（或维持登记） | 🟡非阻塞 | implementation.md（phase-2 AC-13 登记） | 2026-09-20 |
| DEBT-15 | phase-2-realmachine-infra | layer-v-capability-driver（流式增量断言） | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`（`cap-messages-protocol` 的 `stream` 步 `requireIncrement:true, intervalMs:150`） | `cap-messages-protocol` 的 `streamed-message` 步 `requireIncrement:true` 真机全链 model 批失败（`no streaming increment observed`），隔离复跑通过——与 DEBT-3 同因（流式响应偶发快到轮询漏捕获中间态），且该项 `intervalMs` 未随 DEBT-3 一起调低 | 与 DEBT-3 一并解决流式增量可观测波动（`cap-messages-protocol` 也调低 `intervalMs` 或换更稳健分段指令） | 已知缺陷（时序敏感） | `module:layer-v-capability-driver, type:debt, concern:stream-increment-observability` | `capability-runner.cjs`（`requireIncrement` 增量门控） | 后续 Phase | 🟡非阻塞 | verification.md（phase-2 二轮真机复验：全链 model 批 fail、隔离 pass） | 2026-09-20 |

## 已解决

| ID | 源Phase | 描述 | 解决Phase | 解决日期 | 验证方式 |
|----|:------:|------|:--------:|---------|---------|
| DEBT-9 | phase-3-drive-model | `selection-ask.ts:182` 防泄漏检查由裸子串 `pointerText.includes(doc.languageId)` 改为完整 token 判定 `isLanguageIdTokenLeaked`（两侧均非 `[A-Za-z0-9._-]` 才判泄漏），`package.json`(languageId=json) 不再误判；新辅助函数经 `code-context/index.ts` 导出；`cap-selection-ask` 探针文件由 `src/index.ts` 改回 `package.json` | phase-1-deterministic-fixes | 2026-09-20 | 单测 `cap-code-context.spec.ts` CAP-CODE-CONTEXT-024~028（28 tests 全过）；`tsc --noEmit -p apps/vscode-dsh/tsconfig.json` exit 0 |
| DEBT-8 | phase-2-drive-nonmodel | `cap-history-panel` 与 `cap-message-list-streaming` 的 `requiresModel` 由 false 翻 true，并补齐真实模型往返步骤（前者 `sendPrompt`→`closed-turn`→`listHistory` 断言 `firstUserPreview`；后者 `sendPrompt`→`stream` 步 `$assistantContains` 流式断言） | phase-1-deterministic-fixes | 2026-09-20 | 静态检查：两项 `requiresModel:true` 且步骤含 `sendPrompt`→`listHistory`/`$assistantContains` 流式断言（manifest JSON 可解析） |
| DEBT-11 | phase-4-orchestration-regression | 删除过时的 `run-chat-ready-regression.sh`，同步更新 4 处守卫（`cap-test-harness.spec.ts` 移除 CAP-TEST-HARNESS-083 + 清理 `existsSync`/`resolve` 未用导入、`check-test-scripts-syntax.sh` pinned 清单、`capability-domains.json` :20/:657 两处、`README.md`/`README.zh.md` 移除回归命令章节） | phase-1-deterministic-fixes | 2026-09-20 | 静态检查：4 处守卫范围（`apps/vscode-dsh/tests`、`scripts/`、`README*.md`）零引用 + `pnpm exec vitest run apps/vscode-dsh/tests`（560 tests）+ `bash scripts/check-test-scripts-syntax.sh` exit 0 |
| DEBT-7 | phase-2-drive-nonmodel | 为 9 项 webview 内部组件补 host 侧渲染探测通道：`probes.ts` 扩展 `__dshProbes`（`queryTestIds`/`getRenderState`，9 项能力映射布尔）；`protocol.ts` 新增 `probe/query-render-state` + `probe/render-state` 帧；`chat-panel-host.ts` 缓存 `lastRenderState` + `queryWebviewRenderState()`；`extension.ts` 新增门控 `dsh.test.queryWebviewRenderState`；`layer-v-capabilities.json` 8 项能力弱证据升级为 `renderState.*` concreteAssertion | phase-2-realmachine-infra | 2026-09-20 | 静态检查：`dsh.test.queryWebviewRenderState` 注册于 `shouldRegisterTestHooks` 分支（`VSCODE_DSH_TEST=1` 门控）；`tsc --noEmit` + webview build + `jq` 可解析 + vitest 回归通过；8/9 能力 `renderState.*: true` concreteAssertion；残留下游 `cap-delete-confirm-modal`（modal 条件渲染无 host 触发）登记为 DEBT-13（AC-13） |
| DEBT-10 | phase-3-drive-model | 修正 `cap-open-subagent-context`/`cap-pin-subagent-tab` `requiresModel` true→false（UI 机制）；新增 `cap-delegate-subagent-model`（`requiresModel:true`）走真实委托链路（父 `sendPrompt` → 模型 `subagent` 工具委托子 Agent → `dsh.test.listChildren` 断言子会话 assistant 回复含 marker） | phase-2-realmachine-infra | 2026-09-20 | verifier 真机复验：单跑 `cap-delegate-subagent-model` exit 0、`closedLoop.closed=true`；`dsh.test.listChildren` 返回真实子会话（title `Subagent 7491d40f`，status `ended`，assistant 回复 `LAYER-V-CAP-24-OK`）——确认模型真实调用 `subagent` 工具委托，非 `injectSubagent` 注入 |
| DEBT-12 | phase-4-orchestration-regression | 全链入口每项能力前后 `dsh.test.resetToIdle`（`orchestrator.onUserStop()` 回 idle + `resetForTest()` 清 contextSessionId/关 pinned 子 tab）；`capability-runner.cjs` `runManifest` 循环接入复位（best-effort，不改判决/退出码契约） | phase-2-realmachine-infra | 2026-09-20 | verifier 真机复验：nonmodel 批 18 项 exit 0（`cap-extension-activate`/`cap-test-hooks` idle 断言 PASS）；model 批 subagent 后 13 项 `sendPrompt` 无 `readonly-live` 失败（污染② 复位生效）；全链 exit 1 系 DEBT-2/3/14/15 真实失败、非串行污染 |
| DEBT-14 | phase-2-realmachine-infra | `cap-selection-ask` 的 `assistant-replied` 步真机 2 次复跑超时（selection-ask 会话未成为 active tab，active 停留在前序 stream 会话的 replay）。根因：`dsh.test.openEditorWithSelection` 打开文本编辑器 → Conversation webview 失焦 → auto-ready 的 `readyAppliedForVisibilityEpoch` 被重置 → `runAskAboutSelection` 内的 `revealConversationPanel` 重新触发异步 `restoreOpenTabSet` → 关闭 live Tab、恢复 replay Tab；`ensureLiveTab` 在 restore 完成前执行，restore 完成后无人重建 live Tab。修复：`dsh.test.askAboutSelection` 在 `runAskAboutSelection` 返回后 `await autoReady.triggerAutoReady()` 结算 in-flight restore，再若 active 非 live 则 `newConversation` 重建 live Tab（纯测试 hook，`VSCODE_DSH_TEST=1` 门控，不改产品 `runAskAboutSelection`/auto-ready 语义） | phase-2-realmachine-infra | 2026-09-20 | 真机复验 `LAYER_V_CAPABILITY_ONLY="cap-selection-ask"`（+key）exit 0、`closedLoop.closed=true`（`assistant-replied` ok:true 命中 `LAYER-V-CAP-26-OK`）；`tsc --noEmit` + `bash scripts/check-test-scripts-syntax.sh` + `jq` + vitest 560 passed |

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
