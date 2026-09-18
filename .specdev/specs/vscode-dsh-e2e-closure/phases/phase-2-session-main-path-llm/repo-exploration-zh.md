# 仓库调研报告 — phase-2-session-main-path-llm（Phase 级调研）

## 1. 任务背景

本 Phase 对「真实功能能力清单」（repo-exploration.md §12）中涉及**真实模型往返**的核心能力建立真机 EDH 驱动 + 截图 + 断言：§12.3 会话/聊天主链路（#13–#21）、§12.8 分叉（#32–#33）、§12.9 Continue（#34–#36）。这是 AC-9「真实 LLM 强制」的核心载体 —— 聊天/流式/Continue/分叉的验证必须使用真实 `DEEPSEEK_API_KEY`，不得以 `dsh.test.answerApproval` / session 回放等注入/模拟作等价验收；无 key 时以 `SKIPPED_NO_CREDENTIALS`（exit 3）fail-closed。

本调研回答四个核心问题：(1) 会话主链路真实调用链；(2) 可复用的 `dsh.test.*` 测试钩子清单及模型往返判定；(3) 分叉与 Continue 的真实入口；(4) 现有 manifest 的「已实现 vs 占位」覆盖状态。

前置 Phase `phase-1-driver-framework-pilot` 已交付：`layer-v-capabilities.json`（41 项清单）、`layer-v-capability-driver/`（`capability-runner.cjs` 纯编排 + `extension.cjs` 宿主绑定）、`run-layer-v-capabilities.sh`（编排脚本）。本 Phase 复用这套骨架，补全 14 项（§12.3 的 9 项 + §12.8 的 2 项 + §12.9 的 3 项）能力的 steps 与 runStep 实现。

## 2. 仓库概览

| 项 | 值 | 证据 |
|----|----|------|
| 目标应用 | `@deepseek-ai/dsh-vscode-dsh`（VS Code 扩展） | `apps/vscode-dsh/package.json:2` |
| 宿主语言 | TypeScript ESM（`"type": "module"`） | `apps/vscode-dsh/package.json:13` |
| 会话运行时 | `IdeSessionHost` 桥接 `dsh --profile ide` 子进程（SDK client） | `apps/vscode-dsh/src/session-host.ts:430` |
| 模型往返载体 | 真实 `DEEPSEEK_API_KEY` 经 credential env bag 传入 runtime | `apps/vscode-dsh/src/extension.ts:2351-2359` |
| 驱动层 | CJS 扩展（`layer-v-capability-driver/`），纯编排在 `capability-runner.cjs` | `apps/vscode-dsh/test-scripts/layer-v-capability-driver/` |
| 真机基座 | `run-layer-v-capabilities.sh` + 共享 `layer-v-runtime.sh` | `apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh:37-44` |

关键模块边界（`apps/vscode-dsh/src/`）：
- `extension.ts` — 生产命令 + `dsh.test.*` 测试钩子注册点（`VSCODE_DSH_TEST` 门控）。
- `conversation-controller.ts` — 会话主链路：`promptActive` / `promptTab` / `continueConversation` / `forkFromClosedTurn` / `panelSnapshot` / 流式 `projectAssistantChunk`。
- `message-store.ts` — 纯消息投影 store（`append` / `patch` / `patchWhere`），流式增量。
- `chat-panel/chat-panel-host.ts` — host↔webview 状态推送（`pushFullState` / `pushAppend` / `pushPatch` / `sendPrompt`）。
- `chat-panel/protocol.ts` — `messages/append` / `messages/patch` / `messages/replace` 协议类型。
- `session-host.ts` — `IdeSessionHost`：spawn `dsh --profile ide` + bridge（`prompt` / `forkSession` / `resumeSession`）。

## 3. 最相关区域

### 3.1 会话/聊天主链路核心文件（回答焦点问题 1）

| 文件:位置 | 内容 | 与本 Phase 的关系 |
|------|------|------|
| `src/extension.ts:509-517` | `dsh.showPanel` → `revealConversationPanel`，返回 `{ok, viewId:'dsh.editorChat', visible, panelOpen}` | 面板打开/建连断言 |
| `src/extension.ts:561-563` | `dsh.startSession` → `orchestrator.request('command-start')` | 建连触发（§12.3 #13–#16 的起点） |
| `src/extension.ts:814-836` | `dsh.promptActiveConversation` → `ensureHostForSend` → `controller.promptActive(body)` | 发送提示生产命令 |
| `src/conversation-controller.ts:1617-1623` | `promptActive(text)` → `promptTab(active.tabId, text)` | 发提示入口（#17） |
| `src/conversation-controller.ts:1632-1651` | `promptTab` → `this.host.prompt(sessionId, blocks)`（真实 SDK prompt）→ `projectUserMessage` | 模型往返发起点 |
| `src/conversation-controller.ts:2253-2309` | `projectAssistantChunk`：text-delta 流式 → 首块 `append`（`streaming:true`）+ 后续 `patch(appendText)` | 流式增量投影（#18/#21） |
| `src/conversation-controller.ts:2197-2247` | `projectAssistantMessage`：完整 assistant turn 落盘 | 最终消息投影 |
| `src/message-store.ts:88-94` | `MessageStore.append` | 消息追加 |
| `src/message-store.ts:103-126` | `MessageStore.patch`（`text` XOR `appendText`，`streaming`/`incomplete` 标志） | 流式增量（#18） |
| `src/message-store.ts:149-171` | `MessageStore.patchWhere` | 批量 patch |
| `src/chat-panel/chat-panel-host.ts:392-496` | `pushFullState`（panel/state + messages/replace + status + tabs） | 全量状态推送（#19） |
| `src/chat-panel/chat-panel-host.ts:563-566` | `pushAppend` → `messages/append` | 单条消息推送 |
| `src/chat-panel/chat-panel-host.ts:575-600` | `pushPatch` → `messages/patch`（拒绝 text+appendText 同框） | 流式增量推送 |
| `src/chat-panel/chat-panel-host.ts:689-731` | `sendPrompt`（Host-gated）→ `deps.acceptSend(trimmed)` | `dsh.test.sendPrompt` 的底层实现 |
| `src/chat-panel/protocol.ts:12` | `PanelMode = 'empty'\|'waiting-host'\|'replay'\|'live'\|'readonly-live'\|'error'` | 状态断言字段 |
| `src/chat-panel/protocol.ts:108-132` | `messages/replace` / `messages/append` / `messages/patch` 协议 | 协议类型（#20） |
| `src/session-host.ts:376-441` | `IdeSessionHost.start`：pre-flight Node → bridge listen → spawn `dsh --profile ide` | 真实 runtime 建连 |
| `src/session-host.ts:430` | `profile: 'ide'`（固定 profile，无需额外配置） | 真实 LLM 前置条件 |

### 3.2 可复用测试钩子（回答焦点问题 2）

全部注册于 `src/extension.ts:1009-1264`，仅当 `shouldRegisterTestHooks`（`src/extension.ts:2294-2297`，`VSCODE_DSH_TEST=1/true` 或注入 vscode）为真。与本 Phase 相关的钩子：

| 命令 | 位置 | 作用 | 返回结构 | 是否真实模型往返 |
|------|------|------|------|:--:|
| `dsh.test.sendPrompt` | `extension.ts:1011-1014` | `panelHost.sendPrompt(text)` | `{ok:true, messageId, sessionId, tabId}` 或 `{ok:false, reason}` | ✅ 是（`acceptSend`→`promptActive`→`host.prompt`） |
| `dsh.test.panelSnapshot` | `extension.ts:1041-1050` | `conversations.panelSnapshot()` | `{mode, sessionId?, tabId?, messages, tabStatus?, index, continue?, ...}` | 否（只读投影，观测用） |
| `dsh.test.getStartState` | `extension.ts:1189-1191` | `orchestrator.getSnapshot()` | `{state, pendingReasons, autoRetryUsed}` | 否 |
| `dsh.test.triggerAutoReady` | `extension.ts:1215-1220` | `autoReady.triggerAutoReady(options)` + `pushFullState` | `{applied, ...}` 或 `{applied:false, reason}` | 否 |
| `dsh.test.simulateStartupOnly` | `extension.ts:1192-1199` | 启动态快照 | `{ok, startState, hostStatus, hostCreateCount, tabs, openTabSet}` | 否 |
| `dsh.test.openPanel` | `extension.ts:1052-1055` | `panelHost.pushFullState()` | `{ok:true, viewId:'dsh.chat'}` | 否（⚠️ 返回 `dsh.chat` 非 `dsh.editorChat`） |
| `dsh.test.continue` | `extension.ts:1148-1166` | `controller.continueConversation(tabId)` | `ContinueConversationResult`（`continued/disabled/hidden/error/missing/host-not-ready`） | ⚠️ 半（resume 本身非生成；续做后发提示才是模型往返） |
| `dsh.test.injectAssistant` | `extension.ts:1077-1089` | `controller.injectAssistantMessage(sessionId, text)` | `{ok, unread}` | ❌ 注入（**AC-9 禁止作等价验收**） |
| `dsh.test.openHistory` | `extension.ts:1056-1075` | `controller.openFromHistory(sessionId, {events})` | `{outcome, ...}` | 否（回放打开，可带注入 events） |
| `dsh.test.listHistory` | `extension.ts:1076` | `listHistoryFromIndex(...)` | `array` | 否 |
| `dsh.test.restoreOpenTabs` | `extension.ts:1140-1147` | `controller.restoreOpenTabSet({eventsBySession})` | `{outcome, ...}` | 否（可注入 events 造 replay Tab） |
| `dsh.test.openSubagent` | `extension.ts:1240-1247` | `controller.openSubagentContext(childSessionId)` | `OpenSubagentResult` | 否（§12.4，本 Phase 不覆盖） |
| `dsh.test.pinSubagent` | `extension.ts:1255-1263` | `controller.pinSubagent(childSessionId)` | `PinSubagentResult` | 否（§12.4，本 Phase 不覆盖） |
| `dsh.test.answerApproval` | `extension.ts:1108-1113` | `host.interactions.resolveApproval(id, outcome)` | `{ok, ...}` | ❌ 注入（**AC-9 明令禁止**作模型往返等价） |

**关键结论**：`dsh.test.sendPrompt` 是唯一「真实模型往返」的生产级钩子（走 `promptActive`→`host.prompt`）。`dsh.test.injectAssistant` / `dsh.test.answerApproval` / `restoreOpenTabs`（带 eventsBySession）只能作辅助（造 replay Tab / 答审批），**不得**作为模型往返等价验收。

### 3.3 分叉与 Continue 的真实入口（回答焦点问题 3）

| 能力 | 真实入口 | 位置 | 是否真实模型往返 |
|------|------|------|:--:|
| 分叉（#32）闭合轮次边界解析 | `resolveClosedTurnBoundary(events, boundary)` | `src/fork/fork-orchestrator.ts:78-179` | 否（纯边界解析） |
| 分叉（#33）从闭合轮分叉 | `controller.forkFromClosedTurn(req)` | `src/conversation-controller.ts:866-942` | ⚠️ 视 intent：`retry`/`edit-resend` 会 `promptTab`（真实模型往返）；`branch` 仅 `invokeFork`（SDK fork，无生成） |
| Continue（#34）能力探测 | `probeContinueCapability(input)` | `src/continue-capability.ts:77-83` | 否（纯判定） |
| Continue（#35）chrome 生成 | `continueChromeFor(gateVerdict, capability, options)` | `src/continue-capability.ts:93-114` | 否（纯判定） |
| Continue（#36）继续会话 | `controller.continueConversation(tabId)` | `src/conversation-controller.ts:715-794` | ⚠️ 半（`host.resumeSession` 恢复 live；后续发提示才是模型往返） |

**⚠️ 分叉入口的关键缺口（本 Phase 必须处理的 GAP）**：`forkFromClosedTurn` **没有**对应的生产命令，也**没有** `dsh.test.fork*` 测试钩子。它只被 `panelHost` 的三个 Webview→Host 消息处理器触发：
- `requestRetry` → `extension.ts:1505-1519`（intent `retry`）
- `requestEditResend` → `extension.ts:1520-1536`（intent `edit-resend`）
- `requestBranch` → `extension.ts:1537-1546`（intent `branch`）

这些是 `panelHost` 的 dep 回调，只对「产品 webview 发来的消息」可达。`layer-v-capability-driver` 是独立扩展，只能经 `vscode.commands.executeCommand` 触达产品，**无法直接驱动 fork**。因此 Phase 2 的 implementer **必须新增一个 `dsh.test.fork*` 测试钩子**（或在既有钩子上扩展），否则 §12.8 两项无法真机驱动。

**Continue 入口的前置约束**：`continueConversation`（`conversation-controller.ts:716-730`）在以下情况直接返回而不 resume：
- `T0B_GATE_VERDICT === 'FAIL'` → `{outcome:'hidden'}`
- active Tab 不存在 → `{outcome:'missing'}`
- `continueChromeForTab` 返回 `visibility: 'hidden'/'disabled'`（live 模式 → `already-live`；`continueSealedSessions` 命中 → `continue-sealed`；host 未连 → `host-not-ready`）→ 相应 outcome
- `host.status !== 'connected'` → `{outcome:'host-not-ready'}`

即 **Continue 只有在 active Tab 处于 `replay` 模式时才有意义**（live 模式返回 `already-live`）。真机下要测 Continue，需先造一个 replay Tab：可经 `dsh.test.openHistory`（带注入 events）或 `dsh.test.restoreOpenTabs`（带 `eventsBySession`），或先跑一轮真实往返再经分叉把父 Tab 置为 replay。这是本 Phase 的一个非平凡前置步骤。

### 3.4 manifest 覆盖状态（回答焦点问题 4）

`apps/vscode-dsh/test-scripts/layer-v-capabilities.json`（41 项）。本 Phase 目标 14 项现状：

| 组 | 能力 | `requiresModel` | 当前 steps 状态 |
|----|------|:--:|------|
| §12.3 session-main-path | `cap-extension-activate` | false | **占位**：`dsh.test.simulateStartupOnly` + 截图，无流式断言 |
| §12.3 | `cap-auto-start-orchestrator` | true | **占位**：`getStartState` wait + 截图 |
| §12.3 | `cap-auto-ready-coordinator` | true | **占位**：`getStartState` + `triggerAutoReady` + 截图 |
| §12.3 | `cap-conversation-controller` | true | **占位**：`getStartState` + `panelSnapshot`（`mode:'live'`）+ 截图 |
| §12.3 | `cap-prompt-active` | true | **占位**：`sendPrompt` + `panelSnapshot`（`mode:'live'`，**弱断言**，未验证回复内容）+ 截图 |
| §12.3 | `cap-message-store-stream-patch` | true | **占位**：`sendPrompt` + `panelSnapshot`（`mode:'live'`，**未断言流式增量**）+ 截图 |
| §12.3 | `cap-push-full-state` | true | **占位**：`openPanel` + `{ok:true}`（弱） |
| §12.3 | `cap-messages-protocol` | true | **占位**：`panelSnapshot`（`mode:'$string'`，**最弱**） |
| §12.3 | `cap-host-send-stream` | true | **占位**：`sendPrompt` + `panelSnapshot`（`mode:'live'`）+ 截图 |
| §12.8 fork | `cap-fork-boundary-parse` | true | **占位**：`sendPrompt` + `panelSnapshot`，**未触发任何 fork** |
| §12.8 | `cap-fork-from-closed-turn` | true | **占位**：`sendPrompt` + `panelSnapshot`，**未触发任何 fork**（缺 `dsh.test.fork*` 钩子） |
| §12.9 continue | `cap-continue-capability-probe` | true | **占位**：`dsh.test.continue` + 截图（无前置 replay Tab 编排） |
| §12.9 | `cap-continue-chrome` | true | **占位**：`panelSnapshot`（`continue:'$object'`）+ 截图 |
| §12.9 | `cap-continue-conversation` | true | **占位**：`dsh.test.continue` + 截图（同上） |

**Phase 1 已打样（非本 Phase 目标，但供参考）**：`react-spa-main`（8 项，`requiresModel:false`）与 `editor-panel`（4 项，`requiresModel:false`）已实现真机 steps（`dsh.showPanel` + assert + screenshot），Phase 1 真机闭环 PASS。

**结论**：14 项目标的 steps 全部是**占位/弱断言**，需要 Phase 2 补强为「marker 驱动的真实往返 + 流式增量断言 + 截图」。其中 §12.8 两项还需先补 `dsh.test.fork*` 钩子。

## 4. 关键入口 / 调用路径

### 4.1 建连 → 就绪 → 发送提示 → 流式呈现 → 完成（§12.3 主链路）

```
dsh.startSession (extension.ts:561)
 └─ orchestrator.request('command-start')  (auto-start-orchestrator)
     └─ createStartHostPort.start (extension.ts:2376)
         └─ new IdeSessionHost(diagnostics).start({cwd, credentials})  (session-host.ts:376)
             └─ spawn `dsh --profile ide`  (session-host.ts:430, profile 硬编码)
                 └─ handshake → host.status = 'connected'
                     └─ bindConversations(new ConversationController(...))  (extension.ts:2423)

dsh.test.sendPrompt(text) (extension.ts:1011)
 └─ panelHost.sendPrompt(text) (chat-panel-host.ts:689)
     └─ deps.acceptSend(trimmed) → controller.promptActive(text) (conversation-controller.ts:1617)
         └─ promptTab(active.tabId, text) (conversation-controller.ts:1632)
             ├─ host.prompt(tab.sessionId, [{type:'text', text}])   ← 真实 SDK prompt（模型往返起点）
             └─ projectUserMessage(...) → messages.append + panelHost.pushAppend  (conversation-controller.ts:2185-2194)

[SDK 流式 text-delta 回调]
 └─ projectAssistantChunk(sessionId, chunk, turn) (conversation-controller.ts:2253)
     ├─ 首块：messages.append(streaming:true) + panelHost.pushAppend  (:2264-2280)
     └─ 后续块：messages.patch(appendText, streaming:true) + panelHost.pushPatch  (:2295-2304)
         └─ MessageStore.patch (message-store.ts:103)  ← text XOR appendText

[观察点]
dsh.test.panelSnapshot() (extension.ts:1041)
 └─ controller.panelSnapshot() (conversation-controller.ts:1688)
     └─ { mode, messages:[{role,text,streaming,incomplete,...}], tabStatus, continue, index }
         → 驱动据此断言：流式中 `streaming:true`、完成后 `text` 含 marker、`streaming` 已清除
```

### 4.2 分叉（§12.8，需补测试钩子）

```
[当前生产可达路径，仅 Webview→Host]
requestBranch/requestRetry/requestEditResend (extension.ts:1537/1505/1520)
 └─ controller.forkFromClosedTurn(req) (conversation-controller.ts:866)
     ├─ 校验父 Tab 存在 + 非 running (:867-885)
     ├─ loadForkEvents → resolveClosedTurnBoundary(events, boundary) (fork-orchestrator.ts:78)
     ├─ intent=retry/edit-resend → invokeFork(parentSessionId, forkOpts)
     │    └─ host.forkSession(parentSessionId, options) (conversation-controller.ts:1101-1107)
     │    └─ applyContinueSwitch + promptTab(childTab, promptText)  ← 真实模型往返（自动重发）
     └─ intent=branch → invokeFork → applyBranchMark（无自动重发，无模型往返）
[缺] 无 dsh.test.fork* 钩子 → 驱动无法触发（GAP，见 §3.3）
```

### 4.3 Continue（§12.9）

```
dsh.test.continue(opts) (extension.ts:1148)
 └─ controller.continueConversation(tabId) (conversation-controller.ts:715)
     ├─ continueChromeForTab 判定（replay 才 enabled；live → already-live）
     ├─ host.resumeSession(resumeSessionId)  ← 真实 SDK resume（恢复 live，非生成）
     └─ registry.setMode(tabId, 'live') + pushFullState
[模型往返点] Continue 后需再 dsh.test.sendPrompt 才能触发真实生成
```

## 5. 可能的影响面

| 目标 | 涉及文件 | 风险 |
|------|------|:--:|
| 补全 14 项能力的 steps 与断言（marker + 流式增量 + 截图） | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json` | 低（改 JSON steps/expect） |
| 实现本批能力 runStep（真实往返断言逻辑，镜像 `layer-v-driver/extension.cjs` runStep3 的 marker 模式） | `apps/vscode-dsh/test-scripts/layer-v-capability-driver/extension.cjs`（或新增 runStep 模块） | 中（需新增 `dsh.test.fork*` 钩子 → 触碰产品 `src/extension.ts`） |
| 新增分叉测试钩子（若 implementer 选择此路径） | `apps/vscode-dsh/src/extension.ts`（`shouldRegisterTestHooks` 块内，`:1009-1264`） | **中高**（本工作流 `ui:false`，但改产品源码需经 implementer 分支 + review） |
| 造 replay Tab 以测 Continue | 驱动层（用 `dsh.test.restoreOpenTabs`/`openHistory` 注入 events，**不新增产品代码**） | 中（编排复杂） |
| 运行产物 | `apps/vscode-dsh/test-artifacts/layer-v-capabilities/`（gitignore，不提交） | 低 |

**重要**：§12.8 分叉的驱动缺口有两条可选路径，需 implementer/spec 决策：
- (a) **新增产品测试钩子** `dsh.test.forkRetry`/`dsh.test.forkBranch`（在 `extension.ts` test-hooks 块内，走 `controller.forkFromClosedTurn`）—— 最直接，但改动产品源码。
- (b) **驱动层模拟 Webview 消息** —— 不可行（独立扩展无法向产品 webview 发消息）。

故路径 (a) 是事实上的唯一可行方案，本报告在 §7 标为 UNKNOWN 待 spec 决策。

## 6. 既有约束 / 约定

- **CJS 驱动 + ESM 产品**：`layer-v-capability-driver/` 必须是 CJS（`"type":"module"` 包内 CJS 是 VS Code 唯一可 `require` 形态）— `package.json:11` + `extension.cjs:25-27`。
- **纯编排分层**：`capability-runner.cjs` 不 import `vscode`、不决定产物路径，只调用注入的 `executeCommand`/`capture`/`journal` 回调；`extension.cjs` 绑定真实 `vscode.commands` 与截图工具 — `capability-runner.cjs:47-48`、`extension.cjs:144-159`。
- **断言扩展位**：AD-4 断言走 `MATCHERS` 可插拔注册表（`capability-runner.cjs:239-265`）；新增 `$selector`/`$visible` 等视觉断言只需加一个 `{name, test}` 条目，`matchesExpect` 不需改。Phase 2 若要「流式增量」断言，可考虑新增 `$streaming`/`$contains` 类 matcher，或直接在 runStep 里 poll `panelSnapshot().messages`。
- **marker 模式（权威先例）**：base driver `runStep3`（`layer-v-driver/extension.cjs:1090-1154`）已证明「发带唯一 marker 的提示 → poll `panelSnapshot()` → 断言 assistant text 含 marker」是真实模型往返的可验收范式（`evidence.model.mode='real'`）。Phase 2 必须镜像此模式，禁止只断言 `mode:'live'`。
- **AC-9 铁律**：`dsh.test.answerApproval` / `dsh.test.injectAssistant` / `restoreOpenTabs`（带 events）注入/回放**仅可作辅助**，不得作模型往返等价验收 — `spec.md:34`。
- **退出码契约**：0=PASS / 1=LINK_FAILURE / 2=SKIPPED_NO_DISPLAY / 3=SKIPPED_NO_CREDENTIALS / 4=HARNESS_ERROR；`requiresModel:true` 无 key → `SKIPPED_NO_CREDENTIALS` 且其优先级高于 PASS — `capability-runner.cjs:66`、`:671-687`。
- **credential 门控**：shell 侧 `HAS_CREDENTIAL` 判 `DEEPSEEK_API_KEY` 非空，写入 plan `hasCredential` — `run-layer-v-capabilities.sh:258-261`；runner 按 `requiresModel && !hasCredential` fail-closed — `capability-runner.cjs:671`。
- **测试钩子门控**：`dsh.test.*` 仅 `VSCODE_DSH_TEST=1/true` 或注入 vscode 时注册 — `extension.ts:2294-2297`。

## 7. 风险 / 未知

| # | 风险/未知 | 确认度 | 说明 |
|---|---|---|---|
| R1 | §12.8 分叉缺测试钩子，真机驱动路径需新增 `dsh.test.fork*` | ❓ UNKNOWN（缺口已确认，解法未定） | `forkFromClosedTurn` 仅经 `panelHost` 的 `requestRetry`/`requestEditResend`/`requestBranch`（Webview→Host）可达；无命令、无 test hook。需 spec/implementer 决策是否在 `extension.ts` 新增 `dsh.test.fork*`。 |
| R2 | Continue 需 replay Tab 前置，真机编排非平凡 | ⚠️ HYPOTHESIS | `continueConversation` 仅对 replay 模式 Tab 有意义。真机需先造 replay Tab（`restoreOpenTabs`/`openHistory` 注入 events），未实测此编排在当前沙箱 HOME 下能否稳定产生 replay Tab。 |
| R3 | 真实 LLM 是否只需 `DEEPSEEK_API_KEY`，无需额外 profile/preset | ⚠️ HYPOTHESIS | 产品硬编码 `profile:'ide'`（`session-host.ts:430`），credential env bag 传入 runtime（`extension.ts:2351-2359`）。但 `ide` profile 内部的模型 provider 配置（base URL、模型名）未在本调研范围内读透，需真机实测确认 key 即可往返。 |
| R4 | 流式增量的真机断言难点 | ⚠️ HYPOTHESIS | `projectAssistantChunk` 在首块即 `append(streaming:true)`，后续 `patch(appendText)`。要断言「流式增量」而非只「最终消息存在」，需在 `sendPrompt` 后**短间隔** poll `panelSnapshot().messages` 观察 `streaming:true` 状态或 `text` 长度增长。但真实模型 token 速率快，可能在首次 poll 前已完成 → 需设计「短轮询捕获 streaming 态」或「断言多块 appendText 累计」策略，存在误判风险。 |
| R5 | `dsh.test.openPanel` 返回 `viewId:'dsh.chat'` 与生产 `dsh.showPanel` 的 `dsh.editorChat` 不一致 | ✅ CONFIRMED | `extension.ts:1054` 返回 `dsh.chat`（历史遗留）；manifest `cap-push-full-state` 只断言 `{ok:true}` 故不冲突，但下游断言若误用 `openPanel` 判 `dsh.editorChat` 会失败。 |
| R6 | 真机闭环时长 | ⚠️ HYPOTHESIS | 14 项能力每项含真实模型往返（`timeoutMs` 240s/300s），单次全量可能远超 Phase 1 的 12 能力时长；建议按 `--capability <id>` 单项复验（S-2，`run-layer-v-capabilities.sh:213-234`）分批跑。 |

## 8. 不确定 / 未核验

| 签名 | 位置 | 状态 |
|------|------|------|
| `IdeSessionHost.start` 的 profile `ide` 是否已配置可用的模型 provider | `session-host.ts:430` | ❓ 未读透（需真机实测 key 是否即往返） |
| `host.prompt` / `host.forkSession` / `host.resumeSession` 的具体桥接实现（SDK 侧） | `session-host.ts`（`IdeSessionHost` 桥方法） | ⚠️ 签名存在（被 controller 调用），未读 SDK 侧函数体 |
| `panelSnapshot().messages` 中 assistant 消息的 `text` 是否在流式期间实时增长 | `conversation-controller.ts:2253-2309` | ✅ 已读：`patch(appendText)` 累加 `text`；但「真机 poll 能否捕获到中间态」未实测 |
| `continueConversation` 的 `resumeSession` 是否触发模型生成 | `conversation-controller.ts:736-737` | ✅ 已读：仅恢复 live，不生成；生成需后续 `sendPrompt` |
| `forkFromClosedTurn` 的 `invokeFork` → `host.forkSession` 是否为纯 SDK 分叉（无生成） | `conversation-controller.ts:1101-1107` | ✅ 已读：`forkSession` 为 SDK fork；`branch` intent 无生成，`retry`/`edit-resend` 经 `promptTab` 有生成 |

## 9. 桩检测与注册表交叉校验

`.specdev/specs/vscode-dsh-e2e-closure/tech-debt-registry.md` 现含 1 条活跃债务（DEBT-1）。

### Registry 校验结果

| Registry ID | 文件:位置 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| DEBT-1 | `layer-v-capability-driver/capability-runner.cjs`（`StageError`/`safeJson`/`pngVerdict`/`sha256Of`/`resolveCaptureTool` 等 13+ 原语） | 已知缺陷：镜像 `layer-v-driver/extension.cjs` 而非 require，语义逐字节一致 | 代码仍为独立第二份拷贝（`capability-runner.cjs:69-475`），未抽共享模块 | ✅ 匹配（目标 Phase phase-5，本 Phase 无需处理） |

### 桩检测小结

- ✅ Confirmed stubs（匹配 registry）：1 个（DEBT-1，非阻塞，目标 phase-5）
- ⚠️ Registry mismatch：0 个
- 🔴 Unregistered stubs：0 个（产品代码无 `@STUB`/空壳/TODO 桩；`MATCHERS` 未知谓词返回恒假是 fail-closed 设计，非桩）

**本 Phase 相关的一个「功能缺口」（非桩，属驱动缺口）**：§12.8 分叉无 `dsh.test.fork*` 测试钩子（`forkFromClosedTurn` 仅经 Webview 消息可达）。这**不是**桩代码，而是「缺少驱动触发面」—— 需 implementer 新增测试钩子，不涉及 `@STUB` 登记（但若实现为临时占位需按规则登记）。

## 10. 推荐阅读

1. ⭐ MUST READ — `apps/vscode-dsh/test-scripts/layer-v-driver/extension.cjs`（`:1090-1154` runStep3 的 marker 真实往返范式 + `panelSnapshot`/`assistantText` 驱动侧助手）
2. ⭐ MUST READ — `apps/vscode-dsh/src/conversation-controller.ts`（`:715-794` continue、`:866-942` fork、`:1617-1651` promptActive/promptTab、`:1688-1750` panelSnapshot、`:2253-2309` 流式）
3. ⭐ MUST READ — `apps/vscode-dsh/src/extension.ts`（`:1009-1264` 全部 test hooks、`:2294-2297` 门控）
4. ⭐ MUST READ — `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`（14 项目标现有占位 steps）
5. 🔷 SHOULD READ — `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts`（`:392-496` pushFullState、`:563-600` pushAppend/pushPatch、`:689-731` sendPrompt）
6. 🔷 SHOULD READ — `apps/vscode-dsh/src/message-store.ts`（`:103-126` patch、`:149-171` patchWhere）
7. 🔷 SHOULD READ — `apps/vscode-dsh/src/session-host.ts`（`:376-441` start、`:430` profile 'ide'）
8. 🔹 OPTIONAL — `apps/vscode-dsh/src/fork/fork-orchestrator.ts` + `src/continue-capability.ts`（边界解析与 Continue chrome 判定）
