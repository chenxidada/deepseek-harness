# Phase 2: 真机基建缺口（DEBT-2 / DEBT-3 / DEBT-7 / DEBT-10 / DEBT-12）

## 目标

修复五条需真实 LLM 往返 + 真机的基建缺口债务：
- **DEBT-2**：fork emptySeed 分叉子会话因 shadow preset 自主编排自启动致 retry 提示词非首轮触发，修复测试可达性使子会话直接以 retry 提示词完成首轮真实模型往返。
- **DEBT-3**：`cap-message-store-stream-patch` #18 流式增量跨 run 波动，修复流式增量可观测使其稳定捕获中间态。
- **DEBT-7**：为 9 项 webview 内部组件补 host 侧渲染探测通道（**真修**：webview 内 `data-testid` + 扩展 `panelSnapshot`/协议返回渲染状态，manifest 弱证据升级为 concreteAssertion，真机闭环）。
- **DEBT-10**：subagent 真修两步——① 修正 `cap-open-subagent-context`/`cap-pin-subagent-tab` 的 `requiresModel` 为 `false`（UI 机制误标）；② 新增一条走真实模型委托链路的 capability（父 `sendPrompt` → 模型用 `subagent` 工具委托子 Agent → 断言子会话 assistant 回复）。
- **DEBT-12**：全链入口做 per-capability 状态隔离（**真修：复用 host + 真实复位，断言保持原语义**）——每项能力结束→复位到干净初始态，使 41 项可一键跑通、exit code 反映真实结论。

## 前置条件

- 依赖 spec：`../requirements.md`（AC-1/4/5/6/7/8/9/12/13）、`../design.md`（§实现方案 DEBT-2/3/7/10/12、§权衡/替代方案）、`../repo-exploration.md`（§4/§5，workflow 级）。
- 依赖 Phase：`phase-1-deterministic-fixes`（manifest 确定性部分已落定：DEBT-8 `requiresModel:true`、DEBT-9 探针文件已改回 `package.json`）。
- 债务需求源：`.specdev/specs/vscode-dsh-e2e-closure/tech-debt-registry.md:26-33`。
- 前置动作：Phase Entry Gate 读取 `tech-debt-registry.md`，确认继承债务（DEBT-2/3/7/10/12 均为 🟡 非阻塞，无 🔴 阻塞项）。
- phase 级 code-explorer 必须额外核实（设计 R5/R3 要求，未核实不得写 manifest）：
  1. 父会话 agent preset 是否挂载 `tool-subagent` 及 `subagents` provider 名（DEBT-10 第二步可达性）。
  2. 9 项 webview 能力到 `__dshProbes` 信号 / `data-testid` 的具体映射（DEBT-7 渲染状态表）。
  3. `dsh.test.resetToIdle` 复位命令在 `capability-runner.cjs` 每项能力前后的接入点（DEBT-12）。

## 验收标准

| AC | 内容摘要 |
|----|---------|
| AC-1 | 范围授权：DEBT-7/10/12 新增的 `dsh.test.*` 命令必须 `VSCODE_DSH_TEST=1` 门控、注册在 `shouldRegisterTestHooks` 分支内；不得引入新产品业务逻辑变更（`data-testid`/探测帧属测试探测通道，不改界面视觉） |
| AC-4 | DEBT-2：`cap-fork-from-closed-turn` 的 `fork-retry` 派生 emptySeed 子会话，以 retry 提示词作首轮触发完成真实模型往返，`child-replied` 断言子会话首轮 `$assistantClosed:LAYER-V-CAP-33-OK` |
| AC-5 | DEBT-3：`cap-message-store-stream-patch` #18 流式响应期间稳定捕获增量，`streamed-message` 步 `requireIncrement:true` 稳定通过（`sawStreaming`/`sawGrowth` true），不再跨 run 波动 |
| AC-6 | DEBT-7（真修）：9 项 webview 组件通过 host 侧渲染探测通道获得 concreteAssertion（`dsh.test.queryWebviewRenderState` 返回 `renderState.*`/`testIds`），真机 `closedLoop.closed=true`；不得仅以 `panelOpen:true`/`viewId` 弱证据记 PASS |
| AC-7 | DEBT-10（真修两步）：① `cap-open-subagent-context`/`cap-pin-subagent-tab` 的 `requiresModel` 置 `false`（UI 机制修正标记）；② 新增 `cap-delegate-subagent-model` 走真实模型委托，断言子会话产生 assistant 回复；不得以 `injectSubagent` 注入作为真实模型往返等价闭环证据 |
| AC-8 | DEBT-12（真修）：`cap-extension-activate`/`cap-test-hooks` 的 `idle` 初始态断言**保持原语义**，经每项能力前后复位（orchestrator 回 idle）在干净初始态下通过；subagent 能力后用后复位（关 tab + 切回 live），后续能力不再返回 `{ok:false, reason:"readonly-live"}` |
| AC-9 | DEBT-12：`run-vscode-dsh-e2e-closure.sh` 一键串行跑完 41 项，exit code 反映真实结论，不因串行状态污染整体 exit 1 |
| AC-12 | 回归护栏：既有回归（vitest + 冒烟脚本）保持通过 |
| AC-13 | 诚实登记：真修确实做不动的缺口（DEBT-2/3/7/10/12 中个别项）如实登记，不放宽断言/重试/删 manifest 项/改探针规避 |

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-1 | 静态检查 | `git diff` 审查本 Phase：确认新增 `dsh.test.queryWebviewRenderState`/`dsh.test.listChildren`/`dsh.test.resetToIdle` 均注册在 `shouldRegisterTestHooks` 分支内（`extension.ts:1012`）；`git diff --name-only \| grep packages/core/agent-loop` 为空 | 新增命令均 `VSCODE_DSH_TEST=1` 门控；`probes.ts`/`protocol.ts` 改动仅为探测面/探测帧，无 agent-loop / 无业务逻辑变更 |
| AC-4 | 运行时（真机 + key，单能力） | `LAYER_V_CAPABILITY_ONLY="cap-fork-from-closed-turn" DEEPSEEK_API_KEY=<key> bash apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh` | `fork-retry` 步派生 emptySeed 子会话（`breadcrumb.parentSessionId` 存在）；`child-replied` 步断言 `$assistantClosed:LAYER-V-CAP-33-OK` 通过；`conclusion=PASS` + `closedLoop.closed=true` |
| AC-5 | 运行时（真机 + key，单能力） | 单跑 `LAYER_V_CAPABILITY_ONLY="cap-message-store-stream-patch"`（带 key），观察 `streamed-message` 步 | `requireIncrement:true` 通过，`sawStreaming`/`sawGrowth` 均为 true；连续 2 次 run 均稳定通过（消跨 run 波动） |
| AC-6 | 静态检查 | 检查 9 项 webview 能力（`cap-react-spa-root`/`cap-tab-chrome`/`cap-composer`/`cap-delete-confirm-modal`/`cap-chat-ui-store`/`cap-message-bridge`/`cap-editor-panel-viewtype`/`cap-react-spa-html-builder`/`cap-webview-html-injection`）的断言已从 `panelOpen:true`/`viewId` 升级为 `dsh.test.queryWebviewRenderState` 的 concreteAssertion（`renderState.*`/`testIds`） | 9 项均有 `actualTrigger` + `concreteAssertion`，无仅 `panelOpen:true` 记 PASS 的弱证据 |
| AC-6 | 运行时（真机，nonmodel 批） | 全链或单批跑 9 项 webview 能力 | 9 项 `conclusion=PASS` + `closedLoop.closed=true`（`actualTrigger`/`concreteAssertion`/`realScreenshot` 三齐）；个别「非 React 节点」确无可靠渲染信号时，该项按 AC-13 如实登记为「该项缺口」，不冒充闭环 |
| AC-7 | 静态检查 | 检查 `cap-open-subagent-context`（:338）与 `cap-pin-subagent-tab`（:357）的 `requiresModel` 均为 `false`；新增 `cap-delegate-subagent-model` 存在且 `requiresModel:true`、steps 含 `sendPrompt` → 等待子会话 → 断言子会话 assistant 回复 | 两项 `requiresModel:false`（UI 机制修正）；新增 capability 走真实委托链路，`injectSubagent` 不再声称真实模型往返闭环 |
| AC-7 | 运行时（真机 + key，单能力） | 单跑 `LAYER_V_CAPABILITY_ONLY="cap-delegate-subagent-model"`（带 key） | 父会话 `sendPrompt` 后模型调用 `subagent` 工具真实委托子 Agent；`dsh.test.listChildren` 断言存在子会话且其 assistant 消息含 `LAYER-V-CAP-XX-OK`（`$assistantContains`）；`conclusion=PASS` + `closedLoop.closed=true` |
| AC-7 | 运行时（真机，nonmodel 批） | 全链或单批跑 subagent 两项（修正后归 nonmodel 批，无需 key） | 两项步骤通过（`readonly-live`/`tabId`/`tabStatus` UI 机制验证成立），但结论不标「真实 LLM 往返」 |
| AC-8 | 运行时（真机，nonmodel 批） | 跑 nonmodel 批，观察 `cap-extension-activate`（:179）与 `cap-test-hooks`（:725） | 两项的 `idle` 断言**保持原语义**，经每项能力前后 `dsh.test.resetToIdle` 复位后在干净初始态下通过，不再因前序 `dsh.showPanel` 推进 orchestrator `started` 而 LINK_FAILURE |
| AC-8 | 运行时（真机 + key，model 批） | 跑 model 批，观察 `cap-open-subagent-context` 之后的 13 项能力 | 13 项 `sendPrompt` 不再返回 `{ok:false, reason:"readonly-live"}`；subagent 后用后复位（`navBack` + 关子 tab + `resetToIdle`）生效 |
| AC-9 | 运行时（真机 + key，全链） | `DEEPSEEK_API_KEY=<key> bash apps/vscode-dsh/test-scripts/run-vscode-dsh-e2e-closure.sh` | 41 项串行跑完，`aggregate conclusion=PASS`（exit 0）；无串行状态污染导致的整体 exit 1 |
| AC-9 | 运行时（负向，无 key） | `env -u DEEPSEEK_API_KEY` 跑全链 | model 批 `SKIPPED_NO_CREDENTIALS`（exit 3），nonmodel 批正常；聚合 exit 3 而非 1 |
| AC-12 | 回归验证 | `pnpm exec vitest run apps/vscode-dsh/tests` | 既有回归全绿 |
| AC-13 | 运行时 + 审查 | DEBT-2/3/7/10/12 若真机仍无法达成（R1/R2/R3/R5/R4），如实登记残留债务（保留或新增条目 + 缺口原因），不得放宽 `requireIncrement`/`$assistantClosed`/渲染断言、不得改探针规避、不得以 `requiresModel` 收窄冒充闭环 | registry 有残留条目 + 原因；无取巧 |

> 说明：DEBT-7/DEBT-10 均取**真修分支**，其验证以「静态检查（concreteAssertion 升级到位 / `requiresModel` 修正 + 新增 capability）为主 + 运行时真机闭环为辅」；DEBT-2/3/12 是真正需要真机 + key 驱动的工程修复，其中 DEBT-12 以「断言保持原语义 + 复位生效」为验收核心。

## 约束（来自 design.md）

1. DEBT-2 修法：在测试环境为 fork 子会话挂非自主编排 shadow preset，**不改产品/SDK 分叉语义**（`emptySeed` + 自动重发 retry 的产品行为保持不动）；无法达成则 AC-13 登记（R1）。
2. DEBT-3 修法：调 `intervalMs` / 换更稳健分段指令，以「真机上稳定捕获增量」为验收，不追求固定间隔；失败不放宽 `requireIncrement`（R2）。
3. DEBT-7 **真修**：复用既有 `__dshProbes` + `data-testid`，新增 `probe/render-state` 探测帧 + `dsh.test.queryWebviewRenderState` 门控命令，把 9 项弱证据升级为渲染状态 concreteAssertion；探测通道 `VSCODE_DSH_TEST=1` 门控、超时 fail-closed、不改界面视觉（R3）。个别「非 React 节点」确无可靠渲染信号时按 AC-13 登记该项缺口（诚实兜底，非默认）。
4. DEBT-10 **真修两步**：① `cap-open-subagent-context`/`cap-pin-subagent-tab` 的 `requiresModel` 置 `false`（UI 机制修正标记，`injectSubagent` 仍用于验证 UI 机制）；② 新增 `cap-delegate-subagent-model` 走真实委托链路（`tool-subagent` → `ctx.subagents.start()`），真机不可达时按 AC-13 登记，**不回退到 `requiresModel` 收窄冒充闭环**（R5）。
5. DEBT-12 **真修**：复用 host + 真实复位，**断言保持原语义**（`idle` 断言仍验证「扩展激活时 orchestrator 确实 idle」）。污染① 每项能力前后 `dsh.test.resetToIdle`（`onUserStop()` 回 idle）复位；污染② subagent 后 `navBack` + 关子 tab + 复位切回 live。不改成 per-capability 独立 host；全链一键跑通为终验（R4）。
6. 不改退出码契约、不改 `closedLoop`/`classifyAssertionStrength`/断言原语；验证基建改动落 `test-scripts/`，临时脚本不落 `tests/`。

## 产出清单

```
apps/vscode-dsh/test-scripts/layer-v-capabilities.json        # 修改：DEBT-2/3/7/10/12 的 manifest（fork 步 / stream 步 / 9 项渲染断言 / subagent requiresModel + 新增 delegate capability / 复位步）
apps/vscode-dsh/webview/src/probes.ts                          # 修改：DEBT-7 扩展 __dshProbes（queryTestIds/getRenderState）
apps/vscode-dsh/src/chat-panel/protocol.ts                     # 修改：DEBT-7 新增 probe/query-render-state + probe/render-state 帧
apps/vscode-dsh/src/chat-panel/chat-panel-host.ts              # 修改：DEBT-7 onWebviewMessage 缓存 lastRenderState
apps/vscode-dsh/src/extension.ts                               # 修改：DEBT-7 queryWebviewRenderState + DEBT-10 listChildren + DEBT-12 resetToIdle（均 VSCODE_DSH_TEST=1 门控）
apps/vscode-dsh/src/conversation-controller.ts                 # 修改（如需）：DEBT-12 resetForTest() 组合复位方法
apps/vscode-dsh/test-scripts/layer-v-shadow-preset.sh          # 修改（如需）：DEBT-2 非自主编排 fork preset
apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh       # 修改（如需）：DEBT-2 host 编排 / DEBT-12 复位
apps/vscode-dsh/test-scripts/run-vscode-dsh-e2e-closure.sh     # 修改：DEBT-12 全链每项能力前后复位
apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs # 修改（如需）：DEBT-12 每项能力前后复位钩子
.specdev/specs/fix-e2e-closure-debts/tech-debt-registry.md     # DEBT-2/3/7/10/12 已解决回填 / 残留登记（AC-13）
```
