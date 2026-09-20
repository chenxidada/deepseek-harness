# Phase 2 实现摘要（DEBT-7 + DEBT-10）

> 本文件分两个批次续写：批次 1 只做 DEBT-7（webview 内部组件渲染探测通道）；批次 2 只做 DEBT-10（subagent 真实委托）。
> 不碰 DEBT-2/3/12（后续批次做）。

## 变更清单

### 已改文件（上次 implementer，本批核对无缺）

| 文件 | 改动 | 对应 design DEBT-7 |
|---|---|---|
| `apps/vscode-dsh/webview/src/probes.ts` | `DshProbes` 新增 `queryTestIds()`/`getRenderState()`；新增 `RenderState` 接口、`queryTestIdsInDom()`、`computeRenderState()` | 修复设计 ① webview 侧扩展探测面 |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | `HostToWebviewMessage` 新增 `probe/query-render-state`；`WebviewToHostMessage` 新增 `probe/render-state`；`parseWebviewToHostMessage` 补解析分支 | 修复设计 ② 协议侧新增帧 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | 新增 `lastRenderState`/`renderStateResolvers` 字段；`onWebviewMessage` 处理 `probe/render-state`；新增 `queryWebviewRenderState(timeoutMs)` 公共方法 | 修复设计 ③ host 侧接收 |
| `apps/vscode-dsh/webview/src/bridge/message-bridge.ts` | 新增 `isProbeQuery()`/`respondRenderState()`；`applyFrame` 拦截 `probe/query-render-state` 并回 `probe/render-state` | 修复设计 ③（webview 半侧）|
| `apps/vscode-dsh/webview/src/store/chat-ui-store.ts` | 新增 `hostFrameDelivered` 标志 + `hasHostFrameDelivered()`/`markHostFrameDelivered()`；`applyHostFrame` 置位 | 修复设计 ① store/bridge 信号 |

### 本批新增

| 文件 | 改动 |
|---|---|
| `apps/vscode-dsh/src/extension.ts` | `shouldRegisterTestHooks` 分支内新增 `dsh.test.queryWebviewRenderState` 命令（`VSCODE_DSH_TEST=1` 门控；host→webview 发 `probe/query-render-state`，等 webview 回 `probe/render-state` 后 resolve；超时/无 webview fail-closed）|
| `apps/vscode-dsh/test-scripts/layer-v-capabilities.json` | 8 项 webview 能力弱证据（`panelOpen:true`/`viewId`）升级为 `dsh.test.queryWebviewRenderState` 的 `renderState.*: true` concreteAssertion |
| `.specdev/specs/fix-e2e-closure-debts/tech-debt-registry.md` | DEBT-7 移入「已解决」；新增 DEBT-13（`cap-delete-confirm-modal` 残留缺口，AC-13）|
| `apps/vscode-dsh/webview/dist/assets/index.js` / `index.css` | `webview:build` 重新打包产物（自检必需步骤的副产物）|

## AC-6 实现说明

DEBT-7 真修目标：为 9 项 webview 内部组件补 host 侧渲染探测通道，manifest 把 `panelOpen:true`/`viewId` 弱证据升级为渲染状态 concreteAssertion。

**三处改动落实**：

1. **webview 探测面**（`probes.ts`）：`getRenderState()` 把 9 项能力映射为布尔 —— `reactSpaRoot`/`tabChrome`/`composer`/`deleteConfirmModal` 看 DOM `data-testid`；`chatUiStore`/`messageBridge` 看 `hostFrameDelivered`（host 帧已送达）；`editorPanelViewtype`/`reactSpaHtmlBuilder`/`webviewHtmlInjection` 看 `#root` 有子节点（App root 挂载）。
2. **协议帧**（`protocol.ts`）：`HostToWebviewMessage` 新增 `probe/query-render-state`（请求）；`WebviewToHostMessage` 新增 `probe/render-state`（`{ testIds: string[]; renderState: Record<string, boolean> }`）+ 解析分支。
3. **host 接收 + 门控命令**（`chat-panel-host.ts` + `extension.ts`）：`onWebviewMessage` 缓存 `lastRenderState`；`queryWebviewRenderState(timeoutMs)` 发请求帧并等回包，超时 fail-closed；`dsh.test.queryWebviewRenderState` 注册在 `shouldRegisterTestHooks` 分支内（`VSCODE_DSH_TEST=1` 门控，生产不注册）。

**manifest 升级（9 项中的 8 项）**：

| 能力 | 升级后断言 |
|---|---|
| `cap-react-spa-root` | `renderState.reactSpaRoot: true` |
| `cap-tab-chrome` | `renderState.tabChrome: true` |
| `cap-composer` | `renderState.composer: true` |
| `cap-chat-ui-store` | `renderState.chatUiStore: true` |
| `cap-message-bridge` | `renderState.messageBridge: true` |
| `cap-editor-panel-viewtype` | `renderState.editorPanelViewtype: true` |
| `cap-react-spa-html-builder` | `renderState.reactSpaHtmlBuilder: true` |
| `cap-webview-html-injection` | `renderState.webviewHtmlInjection: true` |

每项由 `assert`（`dsh.showPanel` + `panelOpen:true`）改为 `wait`（`dsh.test.queryWebviewRenderState` + `renderState.*: true`，`timeoutMs: 15000`）。`wait` 使 runner 在 webview 挂载前轮询重试，命令本身超时 fail-closed，符合 AC-6「不得仅以 `panelOpen:true`/`viewId` 弱证据记 PASS」。这 8 项在 runner 的 `assessClosedLoop` 下同时满足 `actualTrigger`（命令非 UI-prep）+ `concreteAssertion`（`renderState.*: true` 为具体布尔事实）+ `realScreenshot` → `closedLoop.closed=true`。

**第 9 项 `cap-delete-confirm-modal` 未升级**：见「偏差记录」。

## 测试结果

| # | 命令 | 结果 |
|---|---|---|
| 1 | `jq . apps/vscode-dsh/test-scripts/layer-v-capabilities.json` | exit 0，JSON 可解析 |
| 2 | `bash scripts/check-test-scripts-syntax.sh` | exit 0，`6 shell asset(s) parse` |
| 3 | `pnpm exec tsc --noEmit -p apps/vscode-dsh/tsconfig.json`（Node 24.21.0） | exit 0 |
| 4 | `pnpm --filter @deepseek-ai/dsh-vscode-dsh run webview:build` | exit 0，`38 modules transformed`, `built in 647ms` |
| 5 | `pnpm --filter @deepseek-ai/dsh-vscode-dsh run build:host` | exit 0，`tsc -b && tsdown`，3 files |
| 6 | `pnpm exec vitest run apps/vscode-dsh/tests` | exit 0，`12 passed / 560 passed` |

> 说明：webview 侧 `tsc --noEmit -p apps/vscode-dsh/webview/tsconfig.json` 因预存配置问题失败（`baseUrl` 已在 TS 6 弃用；import `.ts/.tsx` 扩展需 `allowImportingTsExtensions`；`chat-ui-store.ts:496` 的 `mode` 类型既存不匹配），均为**既有问题、非本批引入**。webview 的实际编译走 vite（`webview:build`，esbuild），已通过。本批改动在 webview 侧无新增类型错误（错误行均指向既有 import/类型模式，不指向新增的 `queryTestIds`/`getRenderState`/`markHostFrameDelivered` 等符号）。

## 偏差记录

### 偏差 1（AC-13 登记）：`cap-delete-confirm-modal` 未闭环

- **偏差描述**：`cap-delete-confirm-modal` 未从弱证据升级为 `renderState.deleteConfirmModal: true`，保留原 `panelOpen: true` 弱证据，`closedLoop.closed` 维持 `false`。
- **影响范围**：spec.md §AC-6（第 45 行运行时验证「个别『非 React 节点』确无可靠渲染信号时按 AC-13 如实登记」）、§AC-13；design.md §实现方案 → DEBT-7 修复设计 item 4（manifest 升级）。
- **原因**：`DeleteConfirmModal` 仅在 `chat-ui-store.deleteConfirm` 被置位时条件渲染（`App.tsx:131`）；`openDeleteConfirm` 只被 TabChrome 溢出菜单 / HistoryPanel 的 **webview 内部点击** 触发，`applyHostFrame` 无任何 host 侧 open-delete-confirm 帧。默认 `dsh.showPanel` 状态下 `delete-confirm-modal` testid 不出现，`renderState.deleteConfirmModal` 恒为 false，host 侧无 test hook 可触发。
- **影响**：9 项中 8 项闭环，1 项按 AC-13 如实登记为残留债务 **DEBT-13**（`tech-debt-registry.md` 活跃债务表），不放宽断言、不删 manifest 项、不改探针规避。后续如需闭环，需补 host 侧可触发的 open-delete-confirm 探测帧（超出本批 design 三处改动范围，未实施）。

## 未注册 @STUB

无。本批未创建任何 `@STUB(phase-N)` 桩，也未留下 `TODO: wire this up later` 类注释。

---

# DEBT-10 实现摘要（批次 2）

## 变更清单

| 文件 | 改动 | 对应 design DEBT-10 |
|---|---|---|
| `apps/vscode-dsh/test-scripts/layer-v-capabilities.json` | ① `cap-open-subagent-context` 与 `cap-pin-subagent-tab` 的 `requiresModel` 由 `true`→`false`（UI 机制误标修正）；② subagent 组新增 `cap-delegate-subagent-model`（`requiresModel:true`） | 第一步（修正标记）+ 第二步（新增真实委托 capability）|
| `apps/vscode-dsh/src/conversation-controller.ts` | 新增 `listChildren(parentSessionId?)`：列出父会话的子会话（按 index `parentSessionId` 过滤）+ hydrated 投影消息（`ensureChildHydrated`） | 第二步（供 `dsh.test.listChildren` 断言）|
| `apps/vscode-dsh/src/extension.ts` | `shouldRegisterTestHooks` 分支内新增 `dsh.test.listChildren` 命令（`VSCODE_DSH_TEST=1` 门控） | 第二步（供真实委托断言）|

> `layer-v-shadow-preset.sh` **未改动**（保持回退后原状，`git diff` 为空）。见「关键事实修正」。

## AC-7 实现说明

DEBT-10 真修两步，第一步（确定性）已完成，第二步的「真实委托是否可达」留给 verifier 真机判定。

### 第一步：修正 `requiresModel`（UI 机制误标）

`cap-open-subagent-context` 与 `cap-pin-subagent-tab` 本质是「打开子会话上下文 / 钉住 Tab」的 **UI 机制**，其步骤用 `dsh.test.injectSubagent`（`applyTestSubagentNotification`）构造子会话存在性并断言 `readonly-live`/`tabId`/`tabStatus`，本就不需要模型往返。`requiresModel` 由 `true`→`false`，两项归 nonmodel 批，结论不再声称「真实 LLM 往返」。`injectSubagent` 仍用于验证 UI 机制本身，不冒充真实委托。

### 第二步：新增 `cap-delegate-subagent-model`（真实委托）

- **manifest**：`group: subagent`、`requiresModel: true`，步骤骨架 `reveal-editor-panel`→`open-activity-bar`→`fire-conversation-visible`→`host-started`→`new-conversation`→`sendPrompt`（指令让模型调用 `subagent` 工具委托「回显 LAYER-V-CAP-24-OK」）→`wait`（`dsh.test.listChildren` 断言 `children.0` 的 assistant 文本含 marker `$assistantContains:LAYER-V-CAP-24-OK`）→`screenshot`。
- **`dsh.test.listChildren`**（`extension.ts`，门控）：调用 `conversation-controller.ts` 新增的 `listChildren()`，列出父会话子会话 + hydrated 消息。`listChildren()` 按 `index.read().sessions.filter(parentSessionId === parent)` 找子会话，逐个 `ensureChildHydrated()`（从权威日志 hydrate 投影消息），返回 `{ parentSessionId, children: [{ sessionId, parentSessionId, title, status, messages }] }`。
- **端到端链路**（`onSubagentStarted` 已存在）：模型调用 `subagent` → `ctx.subagents.start('spawn')` 委托子 Agent → `onSubagentStarted`（`conversation-controller.ts:1988`）`index.upsertSession({ parentSessionId })` 把子会话入索引 → `dsh.test.listChildren` 按父会话 id 命中该子会话 → 断言其 assistant 回复含 marker。此链路是产品已有能力，本批只在验证层补观测命令，不新增产品委托逻辑。

## 关键事实修正（对 code-explorer R5 报告的更正）

code-explorer 的 R5 报告称「父 preset `specdev-orchestrator` 未挂 `tool-subagent`，需补挂或确认 base bundle 已叠加」——**该报告不完整**：

- 实际 `tool-subagent` 已在 **base bundle** `packages/bundle/base/cordis.patch.yml:355-360` 激活挂载：

```yaml
- id: tool-subagent
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: spawn
    toolName: subagent
    backgroundMode: continuable
```

- **佐证**：`apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh:100` 的 `EXPECTED_TOOL_COUNT=25`，且 `:1853` 断言 `toolCount !== 25` 即 fail。shadow preset 只贡献 `persona` + `tool-fs-search` 两行，凑不出 25 个模型可见工具——这证明 base bundle 的 `tool-subagent` → `subagent` 工具已叠加进父会话。

**结论**：无需补挂 shadow preset。

## 决策记录（方案 A）

**用户选定方案 A**：不改 shadow preset，避免回归冒烟回路「2删0增」冻结契约（`run-layer-v-smoke.sh:618` 写死 `diffMustBeTwoDeletionsZeroInsertions: true`，且 `--check-shadow-preset` 断言 shadow preset 恰好「2 行删除 + 0 行新增」）。补挂 shadow preset 是冗余的（base bundle 已提供 `tool-subagent`），且会破坏已完成的 `vscode-dsh-usable-loop` 冒烟回路。

## DEBT-10 真机验证留 verifier

`cap-delegate-subagent-model` 是否**真实闭环**（模型在 `subagent` 工具可用的情况下真实调用并委托子 Agent 回显 marker）由 **verifier 真机判定**。若真机上模型不调用 `subagent` / 无可用 provider（R5 的端到端 HYPOTHESIS 尚未真机核验），按 AC-13 如实登记「真实委托在本工作流内不可达」及原因，**不回退 `requiresModel` 收窄冒充闭环**。本批只完成静态/确定性部分（`requiresModel` 修正 + 新增 capability + 观测命令 + 链路就位）。

## 测试结果（批次 2）

| # | 命令 | 结果 |
|---|---|---|
| 1 | `jq . apps/vscode-dsh/test-scripts/layer-v-capabilities.json` | exit 0，JSON 可解析；subagent 组 3 项：`cap-open-subagent-context`/`cap-pin-subagent-tab` `requiresModel=false`，`cap-delegate-subagent-model` `requiresModel=true` |
| 2 | `bash scripts/check-test-scripts-syntax.sh` | exit 0，`6 shell asset(s) parse` |
| 3 | `pnpm exec tsc --noEmit -p apps/vscode-dsh/tsconfig.json`（Node 24.21.0） | exit 0 |
| 4 | `pnpm exec vitest run apps/vscode-dsh/tests` | exit 0，`12 passed / 560 passed` |

> `layer-v-shadow-preset.sh` 回退后 `git diff` 为空，未触碰冒烟回路冻结契约。

## 偏差记录（DEBT-10）

无实现偏差。`requiresModel` 修正与新增 capability 均按 design DEBT-10 两步照做；唯一「与任务指令的分歧」——任务要求「在测试父 preset 显式补挂 tool-subagent」——经升级（🔴 BLOCKING）后用户采纳方案 A（不补挂），依据是 base bundle 已激活 `tool-subagent`（`cordis.patch.yml:355`）+ `EXPECTED_TOOL_COUNT=25` 佐证，补挂会回归冒烟回路「2删0增」冻结契约。此决策记录于上文「关键事实修正」与「决策记录」，不属于需 AC-13 登记的缺口（真实委托可达性由 verifier 真机判定）。

## 未注册 @STUB

无。本批（DEBT-10）未创建任何 `@STUB(phase-N)` 桩，未留下 `TODO: wire this up later` 类注释。

---

# DEBT-12 实现摘要（批次 3）

## 变更清单

| 文件 | 改动 | 对应 design DEBT-12 |
|---|---|---|
| `apps/vscode-dsh/src/conversation-controller.ts` | 新增 `resetForTest()`：清所有 Tab 的 `contextSessionId`（回父 Tab 流）+ 关闭所有 pinned subagent 子 Tab，返回 `{ clearedContexts, closedChildTabs }` | 污染②「清所有 tab 的 contextSessionId + 关子 tab」组合复位方法 |
| `apps/vscode-dsh/src/extension.ts` | `shouldRegisterTestHooks` 分支新增 `dsh.test.resetToIdle`（`VSCODE_DSH_TEST=1` 门控）：调 `orchestrator?.onUserStop()`（回 idle + 清 pending + 重置 autoRetryUsed）+ `conversations?.resetForTest()` | 污染① + 污染② 复位命令 |
| `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs` | `runManifest` 循环在每项**已执行**能力结束后调用 `dsh.test.resetToIdle`（best-effort：失败仅 journal，不改能力判决）；新增 `resetToIdle()` 内部辅助函数 | 全链驱动「每项能力结束→复位到干净初始态」接入点 |
| `apps/vscode-dsh/tests/cap-test-harness.spec.ts` | `mockHost` 默认应答 `dsh.test.resetToIdle`（no-op `{ ok:true, startState:'idle' }`），使 runner 新增的复位调用在 mock 下不产生「unexpected command」噪声 | 回归护栏（runner 行为契约更新）|

> `layer-v-capabilities.json` **未改**（本批不改 manifest 断言语义，`cap-extension-activate`/`cap-test-hooks` 的 idle 断言保持原语义）。

## AC-8 实现说明

污染①（idle 初始态）：`cap-extension-activate`（`:183`）与 `cap-test-hooks`（`:725`）的 `idle` 断言**原样未动**——仍验证「扩展激活时 orchestrator 确实 idle」。修复动作是 `dsh.test.resetToIdle` 调 `orchestrator?.onUserStop()`（`auto-start-orchestrator.ts:195-203`：`generation += 1` / `state = 'idle'` / `pending.length = 0` / `autoRetryUsed = false`），全链驱动在每项能力结束后复位，使这两项 idle 断言能力运行在干净初始态下。复位后需要 `started` 的能力（如 `cap-auto-start-orchestrator`）会经自身步骤（`fireConversationVisibility` → `orchestrator.request('conversation-view-visible')`）重新推进到 `started`（`request()` 在 port 已连接时短路置 `state='started'`），不受复位影响。

污染②（readonly-live）：`resetForTest()` 清所有 Tab 的 `contextSessionId`（`registry.setContextSessionId(tabId, undefined)`）+ 关闭所有 pinned subagent Tab（`registry.close(tabId)`），使后续能力的 `dsh.test.sendPrompt` 不再因 `readonly-live` 被 reject（`chat-panel-host.ts:700-714` 门控：`projection.mode === 'readonly-live'` / `active.contextSessionId !== undefined` 两条路径都被清空）。

## AC-9 实现说明

全链驱动接入点选在 `capability-runner.cjs` 的 `runManifest` 循环（`capability-runner.cjs:724`）——这是 `runCapability` 的唯一调用点（in-host driver `extension.cjs:156` 也经此进入），覆盖单能力与全链两种入口，且是最小侵入点。每项**已执行**能力结束后（`requiresModel` 未凭据跳过项经 `continue` 不触发复位，因未执行不产生污染）`await resetToIdle(host, journal, cap.id)`，失败 best-effort（journal `reset-to-idle` 条目 + 吞掉，不改能力自身 verdict、不改退出码契约）。全链一键跑 41 项的 exit code 语义（0/1/2/3/4）与 `closedLoop`/`classifyAssertionStrength`/断言原语均**未动**。

> **AC-9 运行时终验留 verifier**：全链真机串行跑 41 项、exit code 反映真实结论，由 verifier 真机判定；本批只完成静态/确定性部分（复位命令 + 驱动接入点）。

## 测试结果（批次 3）

| # | 命令 | 结果 |
|---|---|---|
| 1 | `pnpm exec tsc --noEmit -p apps/vscode-dsh/tsconfig.json`（Node 24.21.0） | exit 0 |
| 2 | `bash scripts/check-test-scripts-syntax.sh` | exit 0，`6 shell asset(s) parse` |
| 3 | `jq . apps/vscode-dsh/test-scripts/layer-v-capabilities.json` | exit 0，JSON 可解析（本批未改 manifest） |
| 4 | `pnpm exec vitest run apps/vscode-dsh/tests` | exit 0，`12 passed / 560 passed` |

## 偏差记录（DEBT-12）

无实现偏差。复位命令与驱动接入点均按 design DEBT-12 照做；`resetForTest()` 为 design 明示「可加」的组合复位方法（属 AC-1 授权）。唯一对测试夹具的改动（`cap-test-harness.spec.ts` `mockHost` 默认应答 `dsh.test.resetToIdle`）是 runner 行为契约更新（runner 新增了每能力后的复位调用），**非断言改动**——所有 `CAP-TEST-HARNESS-*` 断言语义保持不变。

## 未注册 @STUB

无。本批（DEBT-12）未创建任何 `@STUB(phase-N)` 桩，未留下 `TODO: wire this up later` 类注释。

---

# DEBT-3 实现摘要（批次 4）

## 变更清单

| 文件 | 改动 | 对应 design DEBT-3 |
|---|---|---|
| `apps/vscode-dsh/test-scripts/layer-v-capabilities.json` | `cap-message-store-stream-patch`（#18）的 `stream` 步：`intervalMs` 150→50；`sendPrompt` 的流式指令由「4 行」扩为「6 段更长分段」 | 调低轮询粒度 + 更长分段指令 |

## AC-5 实现说明

根因是 #18 的流式响应偶发快到 150ms 轮询漏捕获中间态（`requireIncrement:true` 机制本身正确，真实捕获了无增量）。修法（design R2「调低 intervalMs + 更长分段指令」）：

1. **`intervalMs: 150 → 50`**：把轮询粒度收紧到 50ms，使流式增量（`sawStreaming`/`sawGrowth`）在 50ms 轮询下更易被捕获。
2. **更长分段指令**：把「按四行逐行输出」扩为「按六段逐段输出，每段更长、逐段生成、每段之间不要合并」，使流式回复更长、分段更明显，中间态更稳定。

`requireIncrement` 保持 `true`（未放宽），`expect` 断言 `$assistantContains:LAYER-V-CAP-18-OK` 原样未改。落点仅在 #18 stream 步 + prompt args，未动 #20/#21 等其他 stream 步。

> **AC-5 运行时终验留 verifier**：`cap-message-store-stream-patch` 真机连续 2 次 run 稳定通过（`sawStreaming`/`sawGrowth` true）由 verifier 真机判定；真机仍偶发失败时按 AC-13 如实登记（R2 兜底），本批只完成静态/确定性改动。

## 测试结果（DEBT-3）

| # | 命令 | 结果 |
|---|---|---|
| 1 | `jq . apps/vscode-dsh/test-scripts/layer-v-capabilities.json` | exit 0，JSON 可解析；#18 stream 步 `intervalMs=50` `requireIncrement=true` |
| 2 | `bash scripts/check-test-scripts-syntax.sh` | exit 0，`6 shell asset(s) parse` |
| 3 | `pnpm exec tsc --noEmit -p apps/vscode-dsh/tsconfig.json`（Node 24.21.0） | exit 0 |
| 4 | `pnpm exec vitest run apps/vscode-dsh/tests` | exit 0，`12 passed / 560 passed` |

## 偏差记录（DEBT-3）

无实现偏差。`intervalMs` 150→50 + 六段分段指令均按 design DEBT-3「默认修复方向」照做，`requireIncrement` 未放宽。

---

# DEBT-2 实现摘要（批次 4）—— AC-13 登记（无法真修）

## 变更清单

无代码/脚本改动。本批对 DEBT-2 的处置是 **AC-13 如实登记为残留债务**，仅更新 `tech-debt-registry.md` 的 DEBT-2 行（追加 AC-13 缺口原因 + 目标Phase 改为「本工作流外」）。

## AC-4 实现说明 —— 为何无法真修

**根因（已核实）**：fork emptySeed 子会话的 preset 由**产品/SDK 代码硬编码继承父 preset**：

```482:495:packages/sdk/server/src/server.ts
        ...parentPreset === undefined ? {} : { agentPreset: parentPreset },
      },
      ...
      ...presets === undefined
        ? {}
        : {
          setup: (childCtx: Context) => {
            presets.composeFrom(childCtx, parentAgent.ctx)
          },
        },
```

- `server.ts:473` `composedPreset(parentAgent.ctx)` 读取父 preset id（`specdev-orchestrator`）。
- `server.ts:482` 把父 preset id 写进子会话 `meta.agentPreset`。
- `server.ts:493-495` `composeFrom(childCtx, parentAgent.ctx)` 把子 Agent 的 scope **绑定到父的 standing composition**（`agent-presets/src/index.ts:455-464`，join 而非重新 mount）。

**fork RPC options 无 `agentPreset` 覆盖 seam**：`session-host.ts:524-562` 的 `forkSession` 只透传 `emptySeed`/`boundarySeq`/`childSessionId`（`:550-552`），`server.ts:283` `forkSession` → `createForkedSession` 也只收 `emptySeed`/`boundarySeq`，无任何「子会话用不同 preset」的入参。

**因此 design 的「默认修复方向」（测试环境为 fork 子会话挂非自主编排 shadow preset）在本工作流内不可落地**：

1. 在 shadow root 加独立 preset 文件（`layer-v-shadow-preset.sh` 之外的新目录）→ **不破坏冒烟「2删0增」契约**（冒烟只校验 `specdev-orchestrator` 的派生），但**无效**——fork 子会话继承父 preset id（`specdev-orchestrator`），不会指向新 preset，因为没有 seam 让它改用。
2. 改 `layer-v-shadow-preset.sh` 生成器的派生结果（如换掉 `specdev-orchestrator` 的 persona）→ **会破坏冒烟冻结契约**（`run-layer-v-smoke.sh:602-603/618` 的「2删0增」+ `EXPECTED_TOOL_COUNT=25`），且 persona 必须 verbatim 才能过自检。
3. 唯一真正的修法是在 SDK `createForkedSession` / fork RPC 加「fork 子会话不继承父 preset」的选项——**属产品/SDK 分叉语义改动，超出「不改产品/SDK 分叉语义」的硬约束**。

## 决策记录（AC-13）

按 AC-13 如实登记 DEBT-2 为**残留债务**，缺口原因 = 真机 fork 自启动在本工作流内无法在不改产品/SDK 分叉语义（`server.ts` 的 fork preset 继承）的前提下修复。未放宽 `$assistantClosed`/`requireIncrement` 断言、未删 manifest 项、未改探针规避、未用 `forkOverride` 测试桩冒充真实分叉。

> **AC-4 运行时（真机 + key）留 verifier**：`cap-fork-from-closed-turn` 的 `child-replied` 步预期真机仍 LINK_FAILURE（子会话自主编排自启动）；verifier 据 AC-13 确认该项残留，不冒充闭环。

## 测试结果（DEBT-2）

无代码/脚本改动，仅 registry 更新；`jq`/`bash`/`tsc`/`vitest` 结果见 DEBT-3 测试结果表（同一批跑，全绿）。

## 偏差记录（DEBT-2）

- **偏差描述**：DEBT-2 未真修，按 AC-13 登记为残留债务（`tech-debt-registry.md` DEBT-2 行更新「目标Phase = 本工作流外」+ AC-13 缺口原因）。
- **影响范围**：spec.md §AC-4（第 42 行运行时验证）、§AC-13（第 54 行诚实登记）；design.md §实现方案 → DEBT-2（第 165-171 行，R1 兜底「无法在本工作流内达成时按 AC-13 如实登记」）。
- **原因**：fork 子会话 preset 由 SDK `createForkedSession` 硬编码继承父 preset（`server.ts:473/482/493-495`），fork RPC 无 `agentPreset` 覆盖 seam；测试 harness 侧（shadow preset 生成器）无法在不破坏冒烟「2删0增」契约且不改产品/SDK 分叉语义的前提下让 fork 子会话改用非自主编排 preset。
- **影响**：`cap-fork-from-closed-turn` 真机 `child-replied` 步维持 LINK_FAILURE，`closedLoop.closed=false`；该残留债务留待「改 SDK 分叉 preset 继承语义」的后续工作流处理。

## 未注册 @STUB

无。本批（DEBT-2/3）未创建任何 `@STUB(phase-N)` 桩，未留下 `TODO: wire this up later` 类注释。

---

# DEBT-14 实现摘要（批次 5，增量修复）

## 变更清单

| 文件 | 改动 | 说明 |
|---|---|---|
| `apps/vscode-dsh/src/extension.ts` | `dsh.test.askAboutSelection`（`shouldRegisterTestHooks` 分支内，`VSCODE_DSH_TEST=1` 门控）在 `runAskAboutSelection` 返回后追加：`await autoReady?.triggerAutoReady()` 结算 in-flight restore，再若 active 非 live 则 `newConversation(EMPTY_LIVE_TITLE)` 重建 live Tab | 纯测试 hook 改动，不改产品 `runAskAboutSelection` / auto-ready / conversation-controller 语义 |
| `.specdev/specs/fix-e2e-closure-debts/tech-debt-registry.md` | DEBT-14 从「活跃债务」移到「已解决」 | 状态回填 |

## 根因分析

`cap-selection-ask` 真机 `assistant-replied` 步（`$assistantContains:LAYER-V-CAP-26-25`）超时的完整因果链：

1. **触发**：`dsh.test.openEditorWithSelection` 调 `showTextDocument(doc, { selection, preview: false })` 打开文本编辑器，导致 Conversation webview panel 失焦（`onDidChangeViewState` → `visible=false`）→ `handleConversationVisibility(false)` → `autoReady.onVisibilityChanged(false)` → **`readyAppliedForVisibilityEpoch` 被重置为 false**（`auto-ready-coordinator.ts:61-68`）。
2. **异步 restore**：`dsh.test.askAboutSelection` → `runAskAboutSelection` → `revealConversationPanel` → `openOrFocus` → `onVisibilityChanged(true)` → `autoReady.onVisibilityChanged(true)` → `void maybeApplyReady()`（**异步、不 await**）→ `applyBody` → `restoreOpenTabSet`（`conversation-controller.ts:580-583` **关闭所有 live Tab**、`:589+` 恢复 replay Tab）。
3. **竞态**：`askAboutSelection` 里的 `ensureLiveTab` 是**同步**的，在 restore 完成前执行（看到刚创建的 live Tab，直接复用）；restore 完成时把那个 live Tab 关闭、active 切到前序 replay Tab，**无人重建 live Tab**。
4. **后果**：紧随的 `send-prompt` 发到了尚未被 restore 关闭的 live Tab（`firstUserPreview` 正确写入 `LAYER-V-CAP-26-OK`），但 `assistant-replied` 的 `panelSnapshot` 读到的是 restore 后的 replay Tab（`mode:'replay'`，sessionId = 前序 stream 会话），300s 超时。

证据（verifier status.json `lastObserved`）：`mode:"replay"`、`sessionId` 为前序 `cap-message-store-stream-patch` 会话、`openTabSet` 两个 Tab 均 `mode:"replay"`、selection-ask 会话仅存于 `index.sessions`（`firstUserPreview` 含 marker）但不在 `openTabSet`——与「restore 关闭 live Tab + 恢复 replay」完全吻合。

## 修复说明

在**测试 hook** `dsh.test.askAboutSelection` 内，`runAskAboutSelection` 返回后：

```ts
await autoReady?.triggerAutoReady()          // 结算 in-flight restore（幂等：无 restore 则 ensureReadySurface）
const controller = conversations
if (controller !== undefined) {
  const active = controller.registry.getActive()
  if (active === undefined || active.mode !== 'live') {
    controller.newConversation(EMPTY_LIVE_TITLE)   // restore 后 active 是 replay → 重建 live Tab
    panelHost?.pushFullState()
  }
}
```

- `triggerAutoReady()` 会 `await` in-flight 的 `restoreOpenTabSet`（`maybeApplyReady` 的 `applyInFlight` 单飞），确保 restore 已结算；无 restore 时走 `ensureReadySurface`（不新建，保持幂等）。
- restore 结算后，若 active 不是 live（replay/empty），`newConversation` 重建 live Tab 并成为 active，使随后的 `dsh.test.sendPrompt` 与 `assistant-replied` 的 `panelSnapshot` 读到**同一 live 会话**。
- **边界**：修复落在验证基建（test hook），不改产品 `runAskAboutSelection`（`dsh.askAboutSelection` 命令仍走原逻辑）、不改 `auto-ready-coordinator` 的 restore 语义、不改 `conversation-controller` 的会话激活逻辑。属 AC-1 授权范围。

## 测试结果（DEBT-14）

> ⚠️ **诚实记录（构建产物遗漏，已修正）**：本批次（DEBT-14 第一批）**漏跑 `build:host`**，导致 `package.json` 的 `main: lib/extension.js` 指向旧 `lib/` 产物，真机 host 加载的是**旧 lib**（未含 `triggerAutoReady` 修复分支），当时的「真机复验」实为假阳性（restore 走 empty、修复分支恒不触发）。本批（收尾）补跑构建后，verifier 已在 `openTabSet:1` 场景复验确认真闭环。此遗漏不掩盖、如实记录。

### 静态/回归检查

| # | 命令 | 结果 |
|---|---|---|
| 1 | `pnpm exec tsc --noEmit -p apps/vscode-dsh/tsconfig.json`（Node 24.21.0） | exit 0 |
| 2 | `bash scripts/check-test-scripts-syntax.sh` | exit 0，`6 shell asset(s) parse` |
| 3 | `jq . apps/vscode-dsh/test-scripts/layer-v-capabilities.json` | exit 0，JSON 可解析（本批未改 manifest） |
| 4 | `pnpm exec vitest run apps/vscode-dsh/tests` | exit 0，`12 passed / 560 passed`（首跑因 `/tmp/dsh-vscode-dsh-changes` 残留目录 `ENOTEMPTY` 偶发失败，`rm -rf` 清理后全绿——既存 flaky，与本批无关） |

### 构建（本批收尾补跑）

| # | 命令 | 退出码 | 输出摘要 |
|---|---|---|---|
| 5 | `pnpm --filter @deepseek-ai/dsh-vscode-dsh run build:host`（Node 24.21.0） | 0 | `tsc -b && tsdown`；`lib/index.js` 3.88 kB、`lib/extension.js` 0.52 kB、`lib/extension-C6sxRWop.js` 501.00 kB（gzip 120.57 kB）；`Build complete in 111ms` |
| 6 | `pnpm --filter @deepseek-ai/dsh-vscode-dsh run webview:build` | 0 | `vite v6.4.3`；`38 modules transformed`；`dist/index.html` 0.38 kB、`dist/assets/index.css` 5.22 kB、`dist/assets/index.js` 186.86 kB；`built in 542ms` |

### 构建产物更新证据（`stat` mtime，升序）

```
1789875958  apps/vscode-dsh/webview/src/probes.ts
1789886537  apps/vscode-dsh/src/extension.ts
1789889399  apps/vscode-dsh/lib/extension-C6sxRWop.js    ← 晚于 src/extension.ts
1789889399  apps/vscode-dsh/lib/extension.js             ← 晚于 src/extension.ts
1789889414  apps/vscode-dsh/webview/dist/assets/index.js ← 晚于 webview/src/probes.ts
```

`lib/` 与 `webview/dist/` 均已晚于对应源码。**构建产物含修复分支**：`grep` 证实 `lib/extension-C6sxRWop.js` 内 `dsh.test.askAboutSelection` 命令体含 `await autoReady?.triggerAutoReady()` + `controller.newConversation(EMPTY_LIVE_TITLE)`，即 DEBT-14 修复已编译进 lib。

### 真机闭环（verifier 第三轮，补 build 后复验）

verifier 在本机 `build:host` 重编译后复跑，确认 `cap-selection-ask` 在 **非空 `openTabSet:1`** 场景真闭环：`assistant-replied` 命中 `LAYER-V-CAP-26-OK`，`mode:live`、`sessionId` 一致、`closedLoop.closed=true`。本批不重复真机跑（逻辑正确、仅缺构建，verifier 已证），此处引用该证据。

## 偏差记录（DEBT-14）

- **偏差描述**：第一批修复代码正确，但**漏跑 `build:host`**，导致真机 host 加载旧 `lib/`（未含修复分支），当时的「真机复验」为假阳性。本批补跑 `build:host` + `webview:build`，`lib/`/`webview/dist/` 已更新并确认含修复分支。
- **影响范围**：spec.md §AC-9（全链 exit 0 依赖 lib 产物正确）；非 spec/design 章节偏差，属构建收尾遗漏。
- **原因**：DEBT-14 批次改 `src/extension.ts` 后只跑了 `tsc --noEmit`（类型检查）与 vitest，未跑 `build:host` 产出 lib。
- **影响**：已修正——补 build 后 lib 含修复分支，verifier 已在 `openTabSet:1` 复验确认 `cap-selection-ask` 真闭环。修复完全落在验证基建（test hook），未放宽断言、未删步骤、未改探针规避。DEBT-14 已从 registry「活跃」移到「已解决」。

## 未注册 @STUB

无。本批（DEBT-14 收尾）未创建任何 `@STUB(phase-N)` 桩，未留下 `TODO: wire this up later` 类注释。
