# Connectivity Review — phase-2-session-main-path-llm

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
PASS

## 端到端路径追踪

### Path 1: 会话/聊天主链路（§12.3，真实模型往返）

```
Entry: dsh.test.sendPrompt(text)                    extension.ts:1012
  → panelHost.sendPrompt(text)                     chat-panel-host.ts:689
    → deps.acceptSend(trimmed)                     ✅ 正确调用
      → controller.promptActive(text)              conversation-controller.ts:1617
        → promptTab(active.tabId, text)            conversation-controller.ts:1632
          → host.prompt(sessionId, blocks)          ✅ 真实 SDK prompt（模型往返起点）
            → bridge session/prompt → server.prompt → agent.followup(message)   server.ts:200
          → projectUserMessage(...)                 ✅ user bubble 投影

[SDK 流式通知]
session.event → host.onNotification               conversation-controller.ts:287（构造时订阅）
  → onSdkNotification → record.type==='assistant/chunk'  conversation-controller.ts:2656
    → projectAssistantChunk                        conversation-controller.ts:2253
      → messages.patch(appendText, streaming)      message-store.ts:103
      → panelHost.pushPatch                        chat-panel-host.ts:575

[观察点]
dsh.test.panelSnapshot() → controller.panelSnapshot()  extension.ts:1042 / conversation-controller.ts:1688
  → projection.messages（同一 MessageStore）         ✅ 驱动可观测流式 + 最终文本
Exit: 驱动 poll 到 messages 含真实 marker 回复
```
**判定**: ✅ 数据路径完整，起点到终点连通。`sendPrompt` → `host.prompt` → 流式 `assistant/chunk` → `MessageStore.patch` → `panelSnapshot().messages` 无断点。

### Path 2: 分叉链路（§12.8，经新增 `dsh.test.fork*` 钩子）

```
Entry: dsh.test.forkRetry({turn:1})               extension.ts:1189
  → parseForkTestRequest('retry', ...)            extension.ts:2631
  → controller.forkFromClosedTurn(req)            conversation-controller.ts:866
    → loadForkEvents + resolveClosedTurnBoundary   ✅ 边界解析（turn 1，无 prior）
    → invokeFork(parentSessionId, {emptySeed:true}) conversation-controller.ts:1096
      → host.forkSession(parentSessionId, options)  session-host.ts:524（bridge session/fork）
        → ide-bridge handleFork                    ide-bridge/index.ts:600
          → sdkSessionFork.forkSession              session-fork.ts / index.ts:117-120
            → server.forkSession                    server.ts:283
              → this.sessions.get(parentSessionId)  ✅ 改后取 SessionRecord.handle.agent
              → createForkedSession(parent, parentAgent, ...) server.ts:309
                → agents.create({ meta.agentPreset: parentPreset, setup: composeFrom })
                → this.sessions.set(childSessionId, rec) ✅ 子会话登记，后续 prompt 可达
    → applyContinueSwitch → promptTab(childTab, promptText) ✅ retry 自动重发（真实往返）
Exit: fork-retry 返回 { ok, presentation:'continue-switch', childSessionId, promptText }
```
**判定**: ✅ 分叉链路连通（`fork-retry` 真机 PASS）。`forkSession` 从 `this.ctx.sessions` 切到 `this.sessions` 是 server **内部**取值源变更，上游 `invokeFork` 经 Host bridge 而非直接调用 SDK 方法，不受影响；`composeFrom`/`composedPreset` 用法与 `subagent/src/child-agent.ts:144,204` 的权威范式逐字一致；`agentPresets` 服务契约（`composeFrom(agentCtx, parentCtx)` / `composedPreset(agentCtx)`）在 `preset/agent-presets/src/index.ts:455,475` 真实存在且签名一致。

### Path 3: Continue 链路（§12.9）

```
Entry: dsh.test.continue(opts)                    extension.ts:1149
  → controller.continueConversation(tabId)        conversation-controller.ts:715
    → continueChromeForTab（replay 才 enabled）
    → host.resumeSession(resumeSessionId)          session-host.ts:638（bridge session/resume）
      → ide-bridge handleResume → sdkSessionResume.resumeSession → server.resumeSession  server.ts:258
    → registry.setMode(tabId, 'live') + pushFullState ✅ 恢复 live
  → 再 dsh.test.sendPrompt → promptTab → host.prompt ✅ 真实往返（cap-continue-conversation 第二轮）
```
**判定**: ✅ Continue 链路连通。造 replay Tab 由驱动 `replay` 步经 `dsh.test.closeConversation` + `dsh.test.openHistory(sessionId)` 完成（`capability-runner.cjs:707-751`），`openHistory` → `openFromHistory` → `readSessionLog` 走**真实 session log**（非注入 events），符合 AC-9「注入仅作辅助造状态」。

### Path 4: 凭证门控 fail-closed（无 key → exit 3）

```
Entry: DEEPSEEK_API_KEY 空
  → run-layer-v-capabilities.sh: HAS_CREDENTIAL="false"  run-layer-v-capabilities.sh:322-325
    → write_plan: hasCredential=false                  run-layer-v-capabilities.sh:144
      → driver readPlan → runManifest(hasCredential:false) extension.cjs:156
        → cap.requiresModel===true && !hasCredential → 记 SKIPPED_NO_CREDENTIALS，不执行  capability-runner.cjs:847-863
          → overallConclusion: SKIPPED_NO_CREDENTIALS 优先级 > PASS  capability-runner.cjs:66
Exit: status.conclusion=SKIPPED_NO_CREDENTIALS → shell set_conclusion 3 → exit 3
```
**判定**: ✅ 凭证门控端到端连通。无 key 时 `requiresModel` 能力确实不被执行（`continue` 跳过 runCapability），且 `SKIPPED_NO_CREDENTIALS` 在 `CONCLUSION_PRECEDENCE` 中高于 `PASS`，不会被打码成 PASS。

### Path 5: 退出码契约（driver 各层一致）

```
capability-runner.cjs 结论（HARNESS_ERROR/LINK_FAILURE/SKIPPED_NO_CREDENTIALS/PASS）
  → extension.cjs status.conclusion（原样透传） extension.cjs:160
  → shell 读 status.conclusion → case 映射 run-layer-v-capabilities.sh:361-377
    PASS→0 / LINK_FAILURE→1 / SKIPPED_NO_DISPLAY→2 / SKIPPED_NO_CREDENTIALS→3 / HARNESS_ERROR→4
  → set_conclusion + exit_now → exit ${EXIT_CODE}  layer-v-runtime.sh:51-53,102-104
```
**判定**: ✅ 退出码在 `capability-runner.cjs` → `extension.cjs` → shell 三层一致传递，0/1/2/3/4 映射无偏移，`CONCLUSION_PRECEDENCE` 的「worst-first、不降级」语义在 shell 侧按单一 `driver_conclusion` 精确映射。

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `dsh.test.forkRetry/Branch/EditResend` | 驱动 manifest steps | ✅ | `controller.forkFromClosedTurn` | ✅ |
| `parseForkTestRequest()` | 三个 fork 测试钩子 | ✅ | `forkFromClosedTurn(req)` | ✅ |
| `forkFromClosedTurn()` | `requestRetry/EditResend/Branch`（生产）+ `dsh.test.fork*`（测试） | ✅ | `invokeFork` → `host.forkSession` | ✅ |
| `host.forkSession()` | `conversation-controller.invokeFork` | ✅ | ide-bridge `handleFork` | ✅ |
| `server.forkSession()` | ide-bridge `sdkSessionFork`（经服务） | ✅ | `createForkedSession` → `ctx.agents.create` | ✅ |
| `createForkedSession()` | `server.forkSession` | ✅ | `presets.composeFrom` / `agents.create` | ✅ |
| `$assistantClosed` matcher | `matchesExpect`（wait 步） | ✅ | `assistantText` + `assistantStreamingActive` | ✅ |
| `replay` step（造 replay Tab） | manifest continue 能力 | ✅ | `dsh.test.closeConversation` + `dsh.test.openHistory` | ✅ |
| `dsh.test.continue` | manifest | ✅ | `continueConversation` → `host.resumeSession` | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| controller → host.forkSession | `(parentSessionId, options?: {boundarySeq?, emptySeed?, childSessionId?}): Promise<string>` | `session-host.ts:524` 同签名 | ✅ |
| session-host → bridge frame | `session/fork` 携带 `parentSessionId` + 可选 `emptySeed/boundarySeq/childSessionId` | `ide-bridge/types.ts:214-224` frame 定义一致 | ✅ |
| ide-bridge → sdkSessionFork | `SdkSessionForkOptions`（boundarySeq/emptySeed/childSessionId） | `session-fork.ts:11-24` 一致 | ✅ |
| server → agentPresets | `composedPreset(agentCtx): string \| undefined`；`composeFrom(agentCtx, parentCtx): string \| undefined` | `preset/agent-presets/src/index.ts:455,475` 一致 | ✅ |
| server → agents.create | `meta.agentPreset?` + `setup(agentCtx)` | `CreateAgentOptions`（`core/agent/src/index.ts:71-126`）一致 | ✅ |
| controller → host.resumeSession | `(sessionId): Promise<void>` | `session-host.ts:638` 一致 | ✅ |
| runner 结论 → shell exit | `PASS/LINK_FAILURE/SKIPPED_NO_DISPLAY/SKIPPED_NO_CREDENTIALS/HARNESS_ERROR` → 0/1/2/3/4 | `run-layer-v-capabilities.sh:361-377` 映射一致 | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `dsh.test.sendPrompt/panelSnapshot/continue/openHistory/restoreOpenTabs` 等测试钩子 | 既有产品（usable-loop） | 已实现，`VSCODE_DSH_TEST` 门控，本 Phase 未改签名 | ✅ |
| `controller.forkFromClosedTurn` / `continueConversation` / `promptActive` | 既有产品（chat-ux） | 已实现、冻结，本 Phase 未改 | ✅ |
| `host.forkSession` / `host.resumeSession` bridge | 既有产品（AD-CUX-5 / GAP-001） | 已实现，本 Phase 未改 | ✅ |
| `sdkSessionFork` / `sdkSessionResume` 服务 | 既有 SDK server | 已实现 | ✅ |
| `packages/sdk/server` 的 `forkSession`（本 Phase 修改） | 本 Phase（产品代码改动，用户确认保留） | 内部取值源 `ctx.sessions`→`this.sessions`，**对外服务签名未变** | ✅ |
| 层 V 驱动基座 `capability-runner.cjs` / `run-layer-v-capabilities.sh` | phase-1-driver-framework-pilot | 已交付，本 Phase 增量扩展（+matcher / +凭证门控） | ✅ |

## 关键发现

### 🔴 Must-Fix
- 无。

### 🟡 Should-Fix
- 无。

### 🟢 Observations
- **`cap-fork-from-closed-turn` 的 `child-replied` 超时（#33，DEBT-2）不是连通性断裂。** 分叉链路本身完整接通：`fork-retry` 步真机 PASS（`childSessionId` + `promptText` 均返回），子会话经 `emptySeed` 派生、登记进 `this.sessions`、且发生了真实模型往返（自主 SpecDev 编排的 14+ 工具调用）。超时根因是「emptySeed 分叉 + shadow preset `specdev-orchestrator` 自主编排语义」导致 retry 提示词成为排队中的后续输入而非首轮触发输入 —— 属**产品级行为**，非数据路径断点，已登记 DEBT-2（目标 phase-5）并由用户接受推后。连接性判定不受其影响。
- **`server.ts` 改动对外零涟漪。** `forkSession` 的调用方（`ide-bridge handleFork` → `sdkSessionFork` 服务）只消费其公开签名 `(parentSessionId, options?) => Promise<string>`，内部从 `this.ctx.sessions` 切到 `this.sessions` 不改变该签名，也不影响 `conversation-controller.invokeFork`（其经 `host.forkSession` 桥接，从不直连 SDK server）。子会话创建后写入同一 `this.sessions` Map，后续 `prompt` 与 `cancel/dispose/resume` 均经同一 Map 索引，无「写后即弃」。
- **`presets` 类型在 `server.ts` 为局部结构断言**（`composeFrom`/`composedPreset` 而非 `mount`），`createSession` 与 `createForkedSession` 各断言了各自需要的面。这是类型层面的窄化，运行时契约（`preset/agent-presets` 服务同时提供两者）一致，不影响连通。
