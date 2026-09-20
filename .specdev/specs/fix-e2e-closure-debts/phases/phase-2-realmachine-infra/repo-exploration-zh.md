# 仓库调研报告 — Phase 2：真机基建（phase-2-realmachine-infra）

## 1. 任务背景

本 Phase 在 vscode-dsh 分层 V e2e 测试框架中修复 5 条需真实 LLM 往返 + 真机的基建缺口债务：

- **DEBT-2** — fork `emptySeed` 分叉子会话因 shadow preset 的自主编排 persona 自启动，`retry` 提示词排入自主 loop 之后而非触发首轮（`cap-fork-from-closed-turn` 的 `child-replied` 真机超时）。
- **DEBT-3** — `cap-message-store-stream-patch` #18 流式增量观测（`requireIncrement:true, intervalMs:150`）跨运行波动。
- **DEBT-7** — 9 项 webview 内部能力缺少 host 侧渲染探测通道（`data-testid` + `probe/render-state` 帧 + `dsh.test.queryWebviewRenderState`）。
- **DEBT-10** — ① `cap-open-subagent-context` / `cap-pin-subagent-tab` 的 `requiresModel` 置 false；② 新增 `cap-delegate-subagent-model` 走真实模型委托链路。
- **DEBT-12** — 全链入口每项能力前后调用 `dsh.test.resetToIdle` 复位（orchestrator 回 idle + 清 readonly-live）。

三点前置条件（R5/R3/R4）必须在写 manifest 前核实，结论见 §4 与 §7/§8。

## 2. 仓库概览

- **语言/栈**：TypeScript（ESM，`"type": "module"`），strict `noImplicitAny`；pnpm workspaces；Node `^22.19 || >=24`。
- **相关顶层区域**：
  - `apps/vscode-dsh/` — VS Code 扩展 host + React webview + 分层 V 测试框架（`test-scripts/`）。
  - `packages/sdk/server/` — 会话 fork / seed 逻辑（`server.ts`）。
  - `packages/subagent/` — subagent 能力 seam（`tool-subagent`、`subagent-spawn-in-process`、`subagent-fork-in-process`）。
  - `packages/preset/` / `packages/specdev/specdev-presets/` — agent presets。
  - `packages/bundle/base/`、`packages/bundle/sdk-app/` — 插件组合包 patch 层。

## 3. 最相关区域

| 债务 | 区域 | 文件（👁 = 手动探索） |
|---|---|---|
| DEBT-2 | fork emptySeed + shadow preset | `packages/sdk/server/src/server.ts`、`apps/vscode-dsh/src/conversation-controller.ts`、`apps/vscode-dsh/test-scripts/layer-v-shadow-preset.sh`、`apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh` |
| DEBT-3 | 流式增量观测 | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`、`apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs` |
| DEBT-7 | webview 渲染探测 | `apps/vscode-dsh/webview/src/probes.ts`、`.../App.tsx`、`.../components/{TabChrome,Composer,DeleteConfirmModal}.tsx`、`apps/vscode-dsh/src/chat-panel/{protocol.ts,chat-panel-host.ts,editor-chat-panel.ts}`、`.../webview/src/{bridge/message-bridge.ts,store/chat-ui-store.ts,main.tsx}` |
| DEBT-10 | subagent 真实委托 | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`、`apps/vscode-dsh/src/extension.ts`、`packages/specdev/specdev-presets/presets/specdev-orchestrator/agent.cordis.yml`、`packages/bundle/base/cordis.patch.yml`、`packages/subagent/tool-subagent/src/index.ts` |
| DEBT-12 | 每项能力复位 | `apps/vscode-dsh/src/extension.ts`、`apps/vscode-dsh/src/auto-start-orchestrator.ts`、`apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs`、`apps/vscode-dsh/test-scripts/run-vscode-dsh-e2e-closure.sh`、`apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh` |

## 4. 关键入口 / 调用链

### ① DEBT-10 — 真实委托可达性（R5）

```
父会话 preset：specdev-orchestrator
  packages/specdev/specdev-presets/presets/specdev-orchestrator/agent.cordis.yml
    :4  - id: persona
    :23 - id: tool-fs-search
    :28 - id: orchestrator-tool-policy   ← 无 tool-subagent 行
  packages/specdev/specdev-presets/src/tool-policy.ts:21 ORCHESTRATOR_ALLOW = read/read_image/grep/glob/bash
    → 父 preset 未挂载 tool-subagent，且其策略把工具限制为 read/grep/glob/bash

subagents capability provider（base bundle）：
  packages/bundle/base/cordis.patch.yml
    :337-340 subagent-spawn-in-process  (providerName: spawn)
    :342-345 subagent-fork-in-process   (providerName: fork)
    :355-360 tool-subagent              (provider: spawn,  toolName: subagent, backgroundMode: continuable)
    :368-373 tool-subagent-fork         (provider: fork,   toolName: subagent_fork)

e2e host 启动：dsh --profile ide（apps/vscode-dsh/src/session-host.ts:430）
  profile patch 层（run-layer-v-capabilities.sh:280-291）只 patch agent-presets：
    default: specdev-orchestrator; roots: [shadow root, shipped presets root]
  → preset 文件本身不含 tool-subagent / subagents provider 行
```

### ② DEBT-7 — host↔webview 渲染探测（R3）

```
Webview 启动：
  apps/vscode-dsh/webview/src/main.tsx → mountDshProbes() + createMessageBridge() → <App/>
  apps/vscode-dsh/webview/src/probes.ts:27 mountDshProbes() → window.__dshProbes
  apps/vscode-dsh/webview/src/probes.ts:12-19 DshProbes（6 个信号）：
    getFollowState / getActiveTabId / getComposerState / queryMessages / getStreaming / getStatusText

协议：
  apps/vscode-dsh/src/chat-panel/protocol.ts:58  HostToWebviewMessage 联合类型（panel/state :60、messages/replace :109、messages/append :114、messages/patch :123、status/set :134）
  apps/vscode-dsh/src/chat-panel/protocol.ts:240 WebviewToHostMessage 联合类型（ready :241、composer/send :242）
  apps/vscode-dsh/src/chat-panel/protocol.ts:301 parseWebviewToHostMessage(value)
  → 当前两个联合类型均无 probe/render-state 帧

Host 分发：
  apps/vscode-dsh/src/chat-panel/chat-panel-host.ts:353  void this.onWebviewMessage(message)   ← 订阅分发
  apps/vscode-dsh/src/chat-panel/chat-panel-host.ts:741  private async onWebviewMessage(...)    ← 逐类型 switch
  apps/vscode-dsh/src/chat-panel/chat-panel-host.ts:994  private post(message: HostToWebviewMessage)  ← host→webview 推送
```

### ③ DEBT-12 — 复位命令接入点（R4）

```
测试钩子门控：
  apps/vscode-dsh/src/extension.ts:1012   if (shouldRegisterTestHooks(vscodeArg)) {
  apps/vscode-dsh/src/extension.ts:2575   function shouldRegisterTestHooks() { env VSCODE_DSH_TEST === '1'/'true' }
  已有钩子：dsh.test.sendPrompt :1014 / closeConversation :1026 / switchConversation :1093 / navBack :1299
  → dsh.test.resetToIdle 与 dsh.test.queryWebviewRenderState 尚未注册

Orchestrator 复位：
  apps/vscode-dsh/src/auto-start-orchestrator.ts:195 onUserStop(): void
    :196 generation += 1; :197 state = 'idle'; :198 pending.length = 0; :199 autoRetryUsed = false
  getSnapshot() :131 / getStartState() :143 / request() :152

能力遍历循环：
  apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs:717 runManifest(manifest, host, options)
    :724 for (const cap of selected) { ... :750 await runCapability(cap, host, options) }
  apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs:501 runCapability(cap, host, opts)
    :507 for (let index...) 遍历 cap.steps
  全链入口：run-vscode-dsh-e2e-closure.sh:237 run_batch → :255 bash run-layer-v-capabilities.sh
  → dsh.test.resetToIdle 应接入 runManifest 循环（runCapability 前/后），而非逐 step 循环
```

## 5. 影响面

| 变更 | 文件 | 风险 |
|---|---|---|
| 为测试 fork 子会话挂非自主编排 preset | `run-layer-v-capabilities.sh`、`layer-v-shadow-preset.sh`、新 preset 行 | 🟡 MEDIUM — 仅测试框架配置 |
| 调 #18 stream `intervalMs` / 提示词 | `layer-v-capabilities.json`（单步） | 🟢 LOW |
| `probe/render-state` 帧 + `queryWebviewRenderState` + probes | `protocol.ts`、`chat-panel-host.ts`、`probes.ts`、`extension.ts` | 🔴 HIGH — 协议变更 + host/webview 双侧 |
| `requiresModel:false` + `cap-delegate-subagent-model` | `layer-v-capabilities.json` | 🟡 MEDIUM — 依赖 R5 |
| `dsh.test.resetToIdle` + 遍历循环复位 | `extension.ts`、`capability-runner.cjs` | 🟡 MEDIUM |

## 6. 既有约束 / 约定

- 测试钩子由 `shouldRegisterTestHooks` 门控（`extension.ts:1012` / `:2575`，env `VSCODE_DSH_TEST`）—— 新增 `dsh.test.*` 命令必须注册在该分支内。
- fail-closed：`capability-runner.cjs` 对 `requiresModel && !hasCredential` 判为 `SKIPPED_NO_CREDENTIALS`（`:731-748`）；stream 步受 `requireIncrement` 门控（`:575-576`）。
- Host 拥有决策状态；webview 可持可探测的展示状态（`chat-panel-host.ts:3`）。
- Preset patch 会替换整块 `config`；root 顺序是 load-bearing（`run-layer-v-capabilities.sh:273-278`）。
- 禁止硬编码可调参数 — 部署相关选择均为 config 字段（`AGENTS.md`）。

## 7. 风险 / 未知

- **① R5（DEBT-10 可达性）— ✅ CONFIRMED**：`specdev-orchestrator` preset 仅挂载 `persona` + `tool-fs-search` + `orchestrator-tool-policy`，**未**挂载 `tool-subagent`；`subagents` provider 为 `spawn`（`subagent-spawn-in-process`）与 `fork`（`subagent-fork-in-process`），来自 base bundle。⚠️ HYPOTHESIS（端到端未核验）：这些 base bundle 行在运行时是否叠加进 `ide` profile 的父会话（profile patch 只动 `agent-presets`）。→ DEBT-10 第②步必须给测试父 preset 加 `tool-subagent` 行，或确认 base bundle 已叠加；否则 AC-13 无法针对可达工具书写。
- **② R3（DEBT-7 映射）— ✅ CONFIRMED**：9 项能力中 4 项指向已带 `data-testid` 的 React DOM 节点；5 项指向 store/bridge/viewtype/html-builder/injection 面，当前既无 DOM testid 也无 `__dshProbes` 信号。`__dshProbes` 现有 6 信号，缺 `queryTestIds()` / `getRenderState()`；协议无 `probe/render-state` 帧。
- **③ R4（DEBT-12 接入点）— ✅ CONFIRMED**：`shouldRegisterTestHooks` 在 `extension.ts:1012`/`:2575`；`onUserStop()` 在 `auto-start-orchestrator.ts:195`（回 idle + 清 pending + 重置 autoRetryUsed）；能力遍历循环为 `capability-runner.cjs:724` 的 `runManifest`；已有 `navBack`/`closeConversation`/`switchConversation` 钩子在 `extension.ts:1299`/`:1026`/`:1093`。

## 8. 未确证 / 未核验

| 函数 | 签名已确认 | 行为未核验 |
|---|---|---|
| `ide` profile 下 `specdev-orchestrator` 运行时工具集 | ✅ | ❓ base bundle 的 `tool-subagent`/`subagents` 行是否真的挂载进父会话（R5 ⚠️） |
| `chat-panel-host.ts:994 post()` 新 `probe/query-render-state` 帧推送路径 | ✅ 签名存在（`private post`） | ❓ 当前无公开方法从 host→webview 发任意帧；需新增公开 query 方法 |
| `capability-runner.cjs runManifest` 复位缝 | ✅ 循环在 `:724` | ❓ 复位命令尚不存在；插入点为设计，未实现 |

## 9. 桩检测 & Registry 交叉校验

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| DEBT-2 | `server.ts:513 forkSeedFromParent`（emptySeed→`seed:[]` 于 `:517-518`）+ `conversation-controller.ts:866 forkFromClosedTurn`（retry `:898-924`） | 空种子分叉 + shadow preset 自启动 | `emptySeed` 返回空 seed（`server.ts:517-518`）；shadow preset 删 `orchestrator-tool-policy` 后仍保留 `persona`（自编排） | ✅ 匹配 |
| DEBT-3 | `layer-v-capabilities.json:269/282` #18 stream `requireIncrement:true, intervalMs:150` | 流式增量跨 run 波动 | `:282` 步骤确为 `requireIncrement:true, intervalMs:150`；`capability-runner.cjs:575-576` 增量门控真实存在 | ✅ 匹配 |
| DEBT-7 | `probes.ts`（6 信号）+ 9 项能力 | 缺 host 侧渲染探测 | `probes.ts:12-19` 仅 6 信号，无 `queryTestIds`/`getRenderState`；`protocol.ts:58/240` 无 `probe/render-state` | ✅ 匹配（缺口仍在） |
| DEBT-10 | `layer-v-capabilities.json:345/364`（两项 `requiresModel:true`）+ `extension.ts:1315 injectSubagent` | 测试注入而非真实模型委托 | `:349/368` 仍 `requiresModel:true`；步骤 `:357/376` 用 `dsh.test.injectSubagent`；无 `cap-delegate-subagent-model` | ✅ 匹配 |
| DEBT-12 | `run-vscode-dsh-e2e-closure.sh:237 run_batch` | 串行状态污染 | `capability-runner.cjs:724` 循环无 per-capability reset；`extension.ts` 无 `dsh.test.resetToIdle` | ✅ 匹配 |

### 桩检测小结

- ✅ 确认桩：0（5 条债务为「功能缺失/已知缺陷」类缺口，非空壳桩）
- ⚠️ Registry 不一致：0
- 🔴 未注册桩：0

## 10. 推荐下一步阅读

1. ⭐ 必读 — `.specdev/specs/fix-e2e-closure-debts/phases/phase-2-realmachine-infra/spec.md`（AC 与前置条件 R3/R4/R5）
2. ⭐ 必读 — `apps/vscode-dsh/src/chat-panel/protocol.ts` + `chat-panel-host.ts`（DEBT-7 帧扩展）
3. 🔷 应读 — `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs`（DEBT-3/12 门控与 walk 循环）
4. 🔷 应读 — `packages/specdev/specdev-presets/presets/specdev-orchestrator/agent.cordis.yml` + `packages/bundle/base/cordis.patch.yml`（DEBT-10 R5）
5. 🔹 可选 — `apps/vscode-dsh/src/auto-start-orchestrator.ts`（DEBT-12 `onUserStop`）
