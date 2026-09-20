# 架构设计（中文版）— 修复 vscode-dsh-e2e-closure 活跃技术债

> 工作流 slug：`fix-e2e-closure-debts`
> 本文件为 `design.md` 的中文版本，内容一致；不一致时以 `design.md` 为准。
> 目标：把上游工作流 `vscode-dsh-e2e-closure` 在 `.specdev/specs/vscode-dsh-e2e-closure/tech-debt-registry.md` 登记的 8 条活跃债务（DEBT-2 / DEBT-3 / DEBT-7 / DEBT-8 / DEBT-9 / DEBT-10 / DEBT-11 / DEBT-12）逐条**真修**（不再以「规避/收窄/改断言」收场）。

## 范围覆盖

本设计覆盖本工作流全部 2 个 Phase（`phase-1-deterministic-fixes` → `phase-2-realmachine-infra`），对应 `phase-plan.md` 中的 DAG。核心交付物是把 8 条债务从「已登记」推进到「已解决」——每条都有「真修 + 真机/静态证据 + 结论」，结论明确为「闭环通过」或「行为正确」或「清理完成」。三条曾被「二选一」回避的债务（DEBT-7 / DEBT-10 / DEBT-12）本设计一律走**真修**分支：DEBT-7 补 webview 渲染探测通道、DEBT-10 两步（修正标记 + 新增真实模型委托 capability）、DEBT-12 复用 host + 真实复位（不改断言语义）。凡真修确实做不动的缺口才按 AC-13 如实登记（诚实登记是兜底，不是默认路径）。

## 现状依据

> 本节是 `pipeline-gate.sh` 在 `hg2=passed` 时程序化校验的必填章节（L1–L5）。每条证据都是「本设计依赖的现状事实」，形如 `` `路径:行号` ``，路径真实存在、行号不越界。全部断言均已读函数体/配置实际值确认为 ✅ CONFIRMED（本轮 plan-generator 直接读取源码核实；未核实项已显式降级为风险 R5/R6，不作为设计依据）。

| 事实（本设计依赖的现状） | 证据 |
|------|------|
| DEBT-9 防泄漏检查用裸子串 `pointerText.includes(doc.languageId)`，`package.json`(languageId=json) 被误判 | `apps/vscode-dsh/src/code-context/selection-ask.ts:182` |
| DEBT-9 当前探针文件是 `src/index.ts`（languageId=typescript 规避子串冲突），非 `package.json` | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json:412` |
| DEBT-8 `cap-history-panel` 标 `requiresModel:false` 且步骤无模型往返 | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json:40` |
| DEBT-8 `cap-message-list-streaming` 标 `requiresModel:false` 且步骤无模型往返 | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json:53` |
| DEBT-8 历史闭环已有可参照范式：`cap-history-list` 用 `sendPrompt`→`listHistory` 断言 `firstUserPreview`（`requiresModel:true`） | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json:649` |
| DEBT-11 过时脚本引用 10 个已被归并为 `cap-*.spec.ts` 的不存在测试文件 | `apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh:26` |
| DEBT-11 守卫① `cap-test-harness.spec.ts` 的 existsSync 断言 | `apps/vscode-dsh/tests/cap-test-harness.spec.ts:1403` |
| DEBT-11 守卫② `check-test-scripts-syntax.sh` pinned 扫描清单 | `scripts/check-test-scripts-syntax.sh:27` |
| DEBT-11 守卫③ `capability-domains.json` 域声明（:20 与 :657 两处） | `apps/vscode-dsh/tests/capability-domains.json:20` |
| DEBT-11 守卫④ README 与 README.zh 的回归命令示例 | `apps/vscode-dsh/README.md:22` |
| DEBT-2 `forkFromClosedTurn` 对 turn 1（无 prior 边界）走 `emptySeed:true` | `apps/vscode-dsh/src/conversation-controller.ts:901` |
| DEBT-2 emptySeed 分叉后自动重发 retry 提示词（`promptTab`） | `apps/vscode-dsh/src/conversation-controller.ts:917` |
| DEBT-2 SDK `forkSeedFromParent` 对 `emptySeed` 返回空 seed | `packages/sdk/server/src/server.ts:517` |
| DEBT-2 子会话 `createForkedSession` 继承父会话 `agentPreset` | `packages/sdk/server/src/server.ts:482` |
| DEBT-2 测试环境挂载 `specdev-orchestrator`（自主编排 persona）shadow preset | `apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh:81` |
| DEBT-3 #18 流式步 `requireIncrement=true`、`intervalMs=150` | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json:271` |
| DEBT-3 `requireIncrement` 增量门控（未捕获增量即 `record.ok=false`） | `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs:575` |
| DEBT-7 `panelSnapshot` 返回 host 侧状态，不含 webview 内部 DOM/testid | `apps/vscode-dsh/src/conversation-controller.ts:1688` |
| DEBT-7 webview SPA 入口挂载 `mountDshProbes()` + `createMessageBridge()` | `apps/vscode-dsh/webview/src/main.tsx:7` |
| DEBT-7 App 根已带 `data-testid="editor-chat-root"` 与 `data-mode` | `apps/vscode-dsh/webview/src/App.tsx:64` |
| DEBT-7 webview 侧已有 `window.__dshProbes` 探针面（`getFollowState`/`getActiveTabId`/`getComposerState`/`queryMessages`/`getStreaming`/`getStatusText`） | `apps/vscode-dsh/webview/src/probes.ts:12` |
| DEBT-7 host↔webview 协议：`WebviewToHostMessage` 帧类型定义 | `apps/vscode-dsh/src/chat-panel/protocol.ts:240` |
| DEBT-7 `ChatPanelHost.attach()` 订阅 webview 消息 → `onWebviewMessage()` 分发 | `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts:347` |
| DEBT-7 9 项 webview 能力当前仅 `dsh.showPanel` + `panelOpen:true`/`viewId` 弱证据 | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json:7` |
| DEBT-10 subagent 两项用 `dsh.test.injectSubagent` 测试注入驱动，非真实模型委托 | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json:346` |
| DEBT-10 `dsh.test.injectSubagent` → `applyTestSubagentNotification` 测试注入路径 | `apps/vscode-dsh/src/extension.ts:1315` |
| DEBT-10 `openSubagentContext` 把 tab 切到 `readonly-live`/`replay` | `apps/vscode-dsh/src/conversation-controller.ts:1788` |
| DEBT-10 模型委托工具 `tool-subagent`（`name='tool-subagent'`，模型侧 `toolName` 默认 `subagent`） | `packages/subagent/tool-subagent/src/index.ts:43` |
| DEBT-10 `tool-subagent` 的运行经 `runtimeCtx.subagents.start()` 启动子 Agent 运行 | `packages/subagent/tool-subagent/src/index.ts:556` |
| DEBT-10 真实委托后 `onSubagentStarted` 置 `childRunState` + `index.upsertSession` 子会话入索引 | `apps/vscode-dsh/src/conversation-controller.ts:1988` |
| DEBT-10 子会话消息可经 `resolvePanelProjection` 的 `messages: this.messages.get(contextId)` 投影观测 | `apps/vscode-dsh/src/conversation-controller.ts:1899` |
| DEBT-12 全链基座「launch one real Extension Development Host … walk the selected capabilities」单一 host 串行 | `apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh:10` |
| DEBT-12 `cap-extension-activate` 硬编码 `startState:"idle"` 初始态断言 | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json:179` |
| DEBT-12 `cap-test-hooks` 硬编码 `state:"idle"` 初始态断言 | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json:725` |
| DEBT-12 orchestrator 有 `onUserStop()`：回 `idle` + 清 pending + 清 autoRetryUsed | `apps/vscode-dsh/src/auto-start-orchestrator.ts:195` |
| DEBT-12 orchestrator 状态机 `getStartState`（`idle`/`started`/`failed`/`disconnected`） | `apps/vscode-dsh/src/auto-start-orchestrator.ts:143` |
| DEBT-12 `navBack()` 清 `contextSessionId` 回父 Tab 流 | `apps/vscode-dsh/src/conversation-controller.ts:1803` |
| DEBT-12 `dsh.test.navBack` / `dsh.test.closeConversation` 测试钩子已存在 | `apps/vscode-dsh/src/extension.ts:1299` |
| DEBT-12 `sendPrompt` 门控对 `readonly-live` reject | `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts:701` |
| 测试 hook 门控：`dsh.test.*` 仅注册在 `shouldRegisterTestHooks` 分支内 | `apps/vscode-dsh/src/extension.ts:1012` |
| 闭环判定三轴 `assessClosedLoop` 与弱证据分类 `classifyAssertionStrength`（已存在，本次复用不重做） | `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs:417` |

> 补充说明（非证据，供决策）：8 条债务的「当前行为 / 预期行为 / 位置」权威定义在上游 `.specdev/specs/vscode-dsh-e2e-closure/tech-debt-registry.md:26-33`。本工作流尚未把这些条目复制到自己的 `tech-debt-registry.md` 活跃表（当前为空 sentinel），implementer 需按上游 registry 为需求源，并在本工作流首次登记时迁移条目。

## 架构摘要

本工作流以「改动确定性 + 是否需真机」两分为 2 个 Phase。Phase 1 收敛 3 条确定性债务（DEBT-9 产品 bug、DEBT-8 manifest 修正、DEBT-11 过时脚本清理），改动面清晰、可静态/单测/轻量真机直接验证；Phase 2 收敛 5 条需真实 LLM 往返 + 真机的基建缺口债务（DEBT-2/3/7/10/12），其中 DEBT-12（per-capability 状态隔离）依赖 manifest 落定，放 Phase 2 最后。

**产品代码改动面**（相比上一版明显扩大，均属 AC-1 授权范围）：
- DEBT-9：`selection-ask.ts` 防泄漏判定（唯一「产品逻辑」改动）。
- DEBT-7：`webview/src/probes.ts` + `chat-panel/protocol.ts` + `chat-panel-host.ts` + `extension.ts`（新增 `VSCODE_DSH_TEST=1` 门控的渲染探测命令）——补 host 侧渲染探测通道，不改变任何界面视觉。
- DEBT-10：`extension.ts`（新增门控的 `dsh.test.listChildren` 观测命令）+ 新增一条 manifest capability。
- DEBT-12：`extension.ts`（新增门控的 `dsh.test.resetToIdle` 复位命令）+ 全链驱动加每项能力前后复位。

其余改动落在验证基础设施（`test-scripts/` / `tests/`）与测试数据（`layer-v-capabilities.json`）。所有新增 `dsh.test.*` 命令均注册在 `shouldRegisterTestHooks` 分支内（`extension.ts:1012`），`VSCODE_DSH_TEST=1` 门控，不改变生产行为。

## 核心实体 / 数据模型

本工作流不新增业务数据模型。涉及的「数据形态」变更：

1. **manifest 字段修正（`layer-v-capabilities.json`）**：`requiresModel` 布尔标记与步骤语义对齐（DEBT-8 置 true、DEBT-10 置 false），DEBT-9 探针文件参数、DEBT-3 流式步参数，DEBT-7 的 9 项弱证据断言升级为渲染状态 concreteAssertion，DEBT-10 新增一条真实委托 capability，DEBT-12 加复位步。
2. **host↔webview 协议扩展（DEBT-7）**：新增一条 `probe/render-state` 帧（webview→host），承载 webview 内部渲染状态（`data-testid` 集合 + `__dshProbes` 关键信号）。
3. **防泄漏判定函数（DEBT-9）**：新增纯函数「languageId 是否作为完整 token 泄漏进 pointerText」，替代裸子串 `includes`。

无新增 JSON schema（`probe/render-state` 属既有协议文件内新增联合成员，不引入新文件/新 schema 文件）、无改动 `closedLoop` / `classifyAssertionStrength` / 退出码契约（0/1/2/3/4 保持冻结）。

## API 域

本工作流无网络 API、无 HTTP 端点；「接口」指脚本/模块/命令之间的契约。本次要动的契约面：

| 契约 | 位置 | 变更 |
|---|---|---|
| `runAskAboutSelection` 防泄漏判定 | `apps/vscode-dsh/src/code-context/selection-ask.ts:182` | 裸子串 `includes(languageId)` → 完整 token 判定（DEBT-9） |
| `cap-selection-ask` 探针文件参数 | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json:412-413` | `src/index.ts` → `apps/vscode-dsh/package.json`（DEBT-9 闭环） |
| `cap-history-panel` / `cap-message-list-streaming` 的 `requiresModel` + steps | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json:40/53` | `false`→`true` + 补 `sendPrompt`/`listHistory`/`$assistantContains` 断言（DEBT-8） |
| `WebviewToHostMessage` 协议 | `apps/vscode-dsh/src/chat-panel/protocol.ts:240` | 新增 `{ type: 'probe/render-state'; testIds: string[]; renderState: ... }` 帧 + 解析分支（DEBT-7） |
| `DshProbes`（webview 侧） | `apps/vscode-dsh/webview/src/probes.ts:12` | 新增 `queryTestIds()` / `getRenderState()`（DEBT-7） |
| `ChatPanelHost` 渲染状态缓存 | `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts:741` | `onWebviewMessage` 处理 `probe/render-state` 并缓存 `lastRenderState`（DEBT-7） |
| `dsh.test.queryWebviewRenderState` | `apps/vscode-dsh/src/extension.ts`（`shouldRegisterTestHooks` 分支） | 新增门控命令：host→webview 发 `probe/query-render-state` 请求，等 webview 回 `probe/render-state` 后 resolve（DEBT-7） |
| `cap-open-subagent-context` / `cap-pin-subagent-tab` 的 `requiresModel` | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json:334/353` | `true`→`false`，保留 `injectSubagent` UI 机制验证，不再声称真实模型往返（DEBT-10 第一步） |
| 新增 `cap-delegate-subagent-model` | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`（subagent 组） | 新增 `requiresModel:true` capability：父 `sendPrompt` → 模型用 `subagent` 工具真实委托 → 断言子会话 assistant 回复（DEBT-10 第二步） |
| `dsh.test.listChildren` | `apps/vscode-dsh/src/extension.ts`（`shouldRegisterTestHooks` 分支） | 新增门控命令：列出父会话子会话 + hydrated 消息，供真实委托断言（DEBT-10 第二步） |
| `dsh.test.resetToIdle` | `apps/vscode-dsh/src/extension.ts`（`shouldRegisterTestHooks` 分支） | 新增门控命令：`orchestrator.onUserStop()` + 清 `contextSessionId`/关子 tab（DEBT-12） |
| `cap-message-store-stream-patch` #18 流式步 | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json:271` | 调 `intervalMs` / 分段指令，使增量稳定可捕获（DEBT-3） |
| `cap-extension-activate` / `cap-test-hooks` 断言 | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json:179/725` | **保持 `idle` 原语义不变**；改为前置复位步保证其运行在干净初始态（DEBT-12） |
| 全链入口复位动作 | `apps/vscode-dsh/test-scripts/run-vscode-dsh-e2e-closure.sh` + `run-layer-v-capabilities.sh` + `capability-runner.cjs` | 每项能力结束→复位到干净初始态（DEBT-12） |
| `run-chat-ready-regression.sh` + 4 处守卫 | `apps/vscode-dsh/test-scripts/` / `tests/` / `scripts/` / `README*.md` | 删除脚本 + 更新守卫（DEBT-11） |

> 复用不重做：`assessClosedLoop` / `classifyAssertionStrength` / `$contains:` / `$assistantContains:` / `$assistantClosed:` 断言原语、退出码契约、`dsh.test.*` 门控框架、`onUserStop` / `navBack` / `closeConversation` 既有控制器方法全部保持不变。

## UI / Design System

**`ui_relevant: false` —— 本工作流无 UI 变更。**

判定理由（与 `requirements.md` §UI 相关性一致）：本工作流是纯后端 + 验证基建 + 一个产品 bug 修复。唯一「产品逻辑」改动是 `selection-ask.ts` 的防泄漏判断（字符串/词边界判定）。DEBT-7 真修会**触碰 `webview/src/` 组件与 `chat-panel/` 协议文件**，但仅新增 `data-testid`（已存在）+ `probe/render-state` 测试探测帧——这些是**测试探测通道**（`VSCODE_DSH_TEST=1` 门控，`data-testid` 属性本身无视觉影响），不改变任何页面、路由、组件、样式、主题、布局、响应式、暗色模式、动效，不改界面「长什么样」。截图始终是**验证证据**，不是「被设计的界面」。因此不产出 `design-system/`、不产出 `visual-baseline.md`、不经过 HG-1.5。

> 边界声明（供 reviewer-design 对照）：DEBT-7 对 `webview/src/probes.ts` / `chat-panel/protocol.ts` / `chat-panel-host.ts` / `extension.ts` 的改动，是「为 webview 内部组件补 host 侧渲染探测通道」的测试基建，落在 AC-1 明示授权的「`VSCODE_DSH_TEST=1` 门控测试专用 hook」范围内，**不是** UI 设计变更，`ui` 字段仍为 `false`。

## 实现方案

### 逐条债务修复方案

#### DEBT-9（Phase 1）—— 产品 bug：防泄漏词边界判定

**根因**：`selection-ask.ts:182` 的 `pointerText.includes(doc.languageId)` 用裸子串匹配。`pointerText` 是 `@apps/vscode-dsh/package.json 的 1-2 行`，`package.json` 的文件名含子串 `json`（languageId），被误判为「languageId 泄漏」→ 返回 `path-unrepresentable`。

**修复算法**：把「是否包含 languageId 子串」改为「languageId 是否作为**完整 token** 泄漏进 pointerText」。完整 token 的边界定义为：languageId 在 pointerText 中出现的每个位置，其前一个字符与后一个字符**都不**是「路径 token 字符」（字母 / 数字 / `.` / `-` / `_`），即两侧必须是 `/`、空白、`@`、引号或字符串首尾。`package.json` 中的 `json` 前邻 `.`（属路径 token 字符）→ 不是完整 token → 不判泄漏；`@foo/json 的…` 中 `json` 前邻 `/` 后邻空格 → 完整 token → 判泄漏。

**骨架**（新辅助函数，替换 :182 的判定）：

```typescript
// 语言 id 作为完整 token 泄漏：两侧均非「路径 token 字符」（字母/数字/./-/_）
function isLanguageIdTokenLeaked(pointerText: string, languageId: string): boolean {
  if (languageId === '') return false
  let idx = pointerText.indexOf(languageId)
  while (idx !== -1) {
    const before = idx > 0 ? pointerText[idx - 1] : undefined
    const after = idx + languageId.length < pointerText.length
      ? pointerText[idx + languageId.length]
      : undefined
    const isPathTokenChar = (ch?: string) =>
      ch !== undefined && /[A-Za-z0-9._-]/.test(ch)
    if (!isPathTokenChar(before) && !isPathTokenChar(after)) return true
    idx = pointerText.indexOf(languageId, idx + 1)
  }
  return false
}
// 替换 :182：if (doc.languageId !== undefined && isLanguageIdTokenLeaked(pointerText, doc.languageId))
```

**配套**：把 `cap-selection-ask` 的探针文件从 `src/index.ts` 改回 `apps/vscode-dsh/package.json`（`layer-v-capabilities.json:412-413`），使 AC-3 直接真机闭环。

#### DEBT-8（Phase 1）—— manifest 修正：requiresModel 与步骤语义对齐

`cap-history-panel`（:40）与 `cap-message-list-streaming`（:53）的 `requiresModel` 置为 `true`，并补足真机步骤：
- `cap-history-panel`：`reveal-editor-panel` → `open-activity-bar` → `fire-conversation-visible` → `host-started` → `new-conversation` → `sendPrompt` → `assistant-replied` → `listHistory` 断言 `firstUserPreview`（参照 `cap-history-list` :649 的既有范式）→ `screenshot`。
- `cap-message-list-streaming`：同上，末步用 `$assistantContains:LAYER-V-CAP-XX-OK` 流式断言（参照 `cap-message-store-stream-patch` :270 的流式指令）。

#### DEBT-11（Phase 1）—— 清理过时脚本 + 4 处守卫

删除 `apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh`，同步更新 4 处守卫，使其不再依赖已不存在的文件：
1. `apps/vscode-dsh/tests/cap-test-harness.spec.ts:1403` — 删除/改写 CAP-TEST-HARNESS-083 对脚本的 `existsSync` 断言（改为断言「脚本已删除」或移除该断言项，具体以 phase 级 code-explorer 精确定位为准）。
2. `scripts/check-test-scripts-syntax.sh:27` — 从 pinned 扫描清单移除该脚本。
3. `apps/vscode-dsh/tests/capability-domains.json:20` / `:657` — 从域清单移除该脚本条目。
4. `apps/vscode-dsh/README.md:22` / `README.zh.md:22` — 移除回归命令示例中对脚本的引用（或替换为 `pnpm exec vitest run apps/vscode-dsh/tests`）。

**护栏**：清理后 `pnpm exec vitest run apps/vscode-dsh/tests` 与 `scripts/check-test-scripts-syntax.sh` 必须保持通过（AC-11/AC-12）。

#### DEBT-2（Phase 2）—— fork emptySeed 自启动致子会话无首轮回复

**根因**：测试环境挂载 `specdev-orchestrator` shadow preset（`run-layer-v-capabilities.sh:81`），`createForkedSession` 继承父 `agentPreset`（`server.ts:482`），emptySeed 子会话（seed=[]，`server.ts:517`）因此带上「自主编排」persona，在收到 retry 提示词之前自启动「无任务 → 检查活跃工作流 → 继续 SpecDev」loop，retry 提示词沦为排队输入，`child-replied` 步（`$assistantClosed:LAYER-V-CAP-33-OK`）300s 超时。

**默认修复方向**：在**测试环境**为 fork 子会话挂载**非自主编排的 shadow preset**（或空 preset），使子会话直接以 retry 提示词作为首轮触发输入，完成一次真实模型往返（回显 marker）。实现落点在 `run-layer-v-capabilities.sh` / `layer-v-shadow-preset.sh` 的测试 harness 侧，**不改产品/SDK 分叉语义**。

**取舍（R1 已预判）**：若「非自主编排 preset」不足以阻断自启动，备选「调整 fork retry 触发时序」或「测试环境对 fork 组单独换 preset 派生路径」。**兜底**：无法在本工作流内达成时按 AC-13 如实登记，不重试取巧。

#### DEBT-3（Phase 2）—— 流式增量可观测稳定性

**根因**：#18 的流式响应在完整 run 中偶发快到 150ms 轮询无法捕获中间态。`requireIncrement:true` 机制本身正确（真实捕获了无增量）。

**默认修复方向**：调低 `intervalMs`（如 150→50ms）**并/或**把流式指令改为更多、更长的分段，以「在真机上稳定捕获增量」为验收（R2）。落点仅在 `layer-v-capabilities.json:271` 的 stream 步（含 prompt args）。**兜底**：真机上仍偶发失败时按 AC-13 如实登记，不放宽 `requireIncrement`。

#### DEBT-7（Phase 2）—— webview 内部组件渲染探测通道（**真修**）

**真修目标**：为 9 项 webview 内部组件补 host 侧渲染探测通道，使 `concreteAssertion` 可判定，manifest 把 `panelOpen:true`/`viewId` 弱证据升级为渲染状态断言，真机闭环。

**现状可复用资产**（已核实）：webview SPA 入口 `main.tsx:7` 已挂载 `mountDshProbes()` 与 `createMessageBridge()`；`probes.ts:12` 已有 `window.__dshProbes`（getFollowState/getActiveTabId/getComposerState/queryMessages/getStreaming/getStatusText）；App 根已有 `data-testid="editor-chat-root"`（`App.tsx:64`），TabChrome/Composer/DeleteConfirmModal/HistoryPanel/MessageList 等组件均已带 `data-testid`；host↔webview 协议在 `protocol.ts`（`WebviewToHostMessage`/`HostToWebviewMessage`），`ChatPanelHost.attach()`（`chat-panel-host.ts:347`）已订阅 webview 消息并分发到 `onWebviewMessage()`（`:741`）。

**修复设计（三处改动 + 一处 manifest 升级）**：

1. **webview 侧扩展探测面**（`apps/vscode-dsh/webview/src/probes.ts`）：`DshProbes` 新增 `queryTestIds(): string[]`（读当前 DOM 中存在的 `data-testid` 集合）与 `getRenderState()`（把 9 项能力映射为布尔：`reactSpaRoot`/`tabChrome`/`composer`/`deleteConfirmModal`/`chatUiStore`/`messageBridge`/`editorPanelViewtype`/`reactSpaHtmlBuilder`/`webviewHtmlInjection`，其中 React 节点看 DOM testid、store/bridge/viewtype/html-builder/injection 看 `__dshProbes` 信号 + App root 挂载 + host 帧已送达）。不改任何视觉。

2. **协议侧新增帧**（`apps/vscode-dsh/src/chat-panel/protocol.ts`）：`WebviewToHostMessage` 新增 `{ type: 'probe/render-state'; testIds: string[]; renderState: Record<string, boolean> }`，并在 `parseWebviewToHostMessage` 补解析分支；`HostToWebviewMessage` 新增 `{ type: 'probe/query-render-state' }` 请求帧。

3. **host 侧接收 + 门控探测命令**（`apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` + `apps/vscode-dsh/src/extension.ts`）：
   - `ChatPanelHost.onWebviewMessage` 处理 `probe/render-state`，缓存 `lastRenderState`（`chat-panel-host.ts:741` 分发处新增分支）。
   - `extension.ts` 在 `shouldRegisterTestHooks` 分支（`:1012`）新增 `dsh.test.queryWebviewRenderState`：host 向 webview 发 `probe/query-render-state`，等待 webview 回 `probe/render-state`（超时 fail-closed），resolve 返回 `{ testIds, renderState }`。该命令 `VSCODE_DSH_TEST=1` 门控，生产不注册。

4. **manifest 升级**（`layer-v-capabilities.json` 9 项）：把 `panelOpen:true`/`viewId` 弱证据替换为 `dsh.test.queryWebviewRenderState` 的 concreteAssertion，如 `expect: { "renderState.reactSpaRoot": true }` / `expect: { testIds: "$contains:editor-chat-root" }`。9 项 id 位置：`cap-react-spa-root`:7、`cap-tab-chrome`:23、`cap-composer`:62、`cap-delete-confirm-modal`:75、`cap-chat-ui-store`:88、`cap-message-bridge`:101、`cap-editor-panel-viewtype`:114、`cap-react-spa-html-builder`:127、`cap-webview-html-injection`:159。

**不违反 `ui_relevant:false`**：`data-testid` 与 `probe/render-state` 帧是测试探测通道（`VSCODE_DSH_TEST=1` 门控），不改界面视觉，不新增/修改任何「被设计」的视图文件语义。

#### DEBT-10（Phase 2）—— subagent 真实模型委托（**真修，两步**）

**第一步（修正标记）**：`cap-open-subagent-context`（:334）与 `cap-pin-subagent-tab`（:353）的 `requiresModel` 由 `true`→`false`。这两项本质是「打开子会话上下文 / 钉住 Tab」的 **UI 机制**，其步骤用 `injectSubagent`（`applyTestSubagentNotification`）构造子会话存在性并断言 `readonly-live`/`tabId`/`tabStatus`，**本就不需要模型往返**——标 `true` 是标错了。修正后这两项归 nonmodel 批，结论不再声称「真实 LLM 往返」，`injectSubagent` 仍用于验证 UI 机制本身。

**第二步（补覆盖缺口，新增真实委托 capability）**：新增 `cap-delegate-subagent-model`（`group: subagent`，`requiresModel: true`），走产品已有真实委托链路：父会话 `sendPrompt` 用指令让模型调用 `subagent` 工具（`tool-subagent`，`packages/subagent/tool-subagent/src/index.ts:43`，模型侧 `toolName` 默认 `subagent`）委托子 Agent → 断言子会话产生 assistant 回复。步骤骨架：
- `reveal-editor-panel` → `open-activity-bar` → `fire-conversation-visible` → `host-started` → `new-conversation`。
- `sendPrompt`（指令：请调用 subagent 工具把「回显 LAYER-V-CAP-XX-OK」委托给子 Agent，不要在本会话直接回复）。
- 等待真实委托：`onSubagentStarted`（`conversation-controller.ts:1988`）会把子会话 `upsertSession` 入索引 → 父会话 messages 出现 `kind:'subagent'` card。
- 断言子会话 assistant 回复：新增门控命令 `dsh.test.listChildren`（列出父会话子会话 + hydrated 消息），断言存在子会话且其 assistant 消息含 `LAYER-V-CAP-XX-OK`（`$assistantContains`）。
- `screenshot`。

**为什么这是「产品已有能力」而非新功能**：`tool-subagent` 及其 `ctx.subagents.start()` 委托执行、`subagent.started/finished` 时间线事件、`onSubagentStarted/Finished` 控制器处理、子会话消息投影全部已存在（见「现状依据」DEBT-10 各证据行）。本步只是在验证层「真实走一遍这条链路并断言结果」，不新增任何产品委托逻辑。

**风险 R5（真修可能做不动，非默认）**：模型是否在简单指令下可靠调用 `subagent` 工具，取决于父会话 agent preset 是否挂载 `tool-subagent` 且 `subagents` provider 可用——此接线本计划未逐行核实（phase 级 code-explorer 必须确认 preset 挂载点与 provider 名）。若真机上模型不委托 / 无可用 provider，按 AC-13 如实登记「真实委托在本工作流内不可达」及原因，**不回退到 `requiresModel` 收窄冒充闭环**。

#### DEBT-12（Phase 2）—— per-capability 状态隔离（**真修：复用 host + 真实复位，断言保持原语义**）

**真修目标**：让「每项能力结束→复位到干净初始态」成为全链入口的固定动作，两类污染各用真实复位修复，**不改断言**。

- **污染①（idle 初始态）**：`cap-extension-activate`（:179）与 `cap-test-hooks`（:725）的 `startState:"idle"`/`state:"idle"` 断言**保持原语义不变**——它们验证的是「扩展激活时 orchestrator 确实 idle」这一真实语义。修复动作是：新增门控命令 `dsh.test.resetToIdle`（调用 `orchestrator?.onUserStop()`，`auto-start-orchestrator.ts:195` 会回 `idle` + 清 pending + 清 autoRetryUsed），全链驱动在**每项能力开始前/结束后**执行复位，使 idle 断言能力运行在干净初始态下。orchestrator 复位后，需要 `started` 的能力（如 `cap-auto-start-orchestrator`）会经自身步骤（`fireConversationVisibility` → request start）重新推进到 `started`，不受复位影响。

- **污染②（readonly-live）**：subagent 能力结束后加复位步——复用 `dsh.test.navBack`（`extension.ts:1299`，清 `contextSessionId` 回父 Tab 流，`conversation-controller.ts:1803`）+ 关闭钉住的子 tab（复用 `dsh.test.closeConversation`/`switchConversation`），使后续能力的 `dsh.test.sendPrompt` 不再因 `readonly-live` 被 reject（`chat-panel-host.ts:701` 门控）。

- **实现落点**：`extension.ts` 新增门控命令 `dsh.test.resetToIdle`（`VSCODE_DSH_TEST=1` 门控，生产不注册）；`conversation-controller.ts` 复用 `navBack`/`closeConversation`（或新增一个组合复位方法 `resetForTest()` 把「清所有 tab 的 contextSessionId + 关子 tab」收口）；全链驱动（`capability-runner.cjs` 的 runCapability 前后，或 `run-vscode-dsh-e2e-closure.sh`/`run-layer-v-capabilities.sh` 的 walk 循环）在每项能力结束后调用复位。

- **全链终验**：`run-vscode-dsh-e2e-closure.sh` 一键跑 41 项后 exit code 反映真实结论（AC-9）。R4 警告的「未枚举污染类」以「每项能力结束后统一复位到干净初始态」双向兜底，而不是改断言逃避验证。

### 文件产出计划

**Phase 1（确定性修复）**

```
apps/vscode-dsh/src/code-context/selection-ask.ts        # 修改：DEBT-9 防泄漏词边界判定（唯一 src/ 产品逻辑改动）
apps/vscode-dsh/test-scripts/layer-v-capabilities.json   # 修改：DEBT-9 探针文件 + DEBT-8 requiresModel/steps
apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh # 删除：DEBT-11
apps/vscode-dsh/tests/cap-test-harness.spec.ts            # 修改：DEBT-11 守卫①
scripts/check-test-scripts-syntax.sh                      # 修改：DEBT-11 守卫②
apps/vscode-dsh/tests/capability-domains.json             # 修改：DEBT-11 守卫③
apps/vscode-dsh/README.md / README.zh.md                  # 修改：DEBT-11 守卫④
apps/vscode-dsh/tests/（如已有 selection-ask 单测文件）     # 修改/新增：DEBT-9 单元测试（词边界正反例）
```

**Phase 2（真机基建缺口，含 webview 探测通道 + 真实委托 + 复位）**

```
apps/vscode-dsh/webview/src/probes.ts                    # 修改：DEBT-7 扩展 __dshProbes（queryTestIds/getRenderState）
apps/vscode-dsh/src/chat-panel/protocol.ts               # 修改：DEBT-7 新增 probe/query-render-state + probe/render-state 帧
apps/vscode-dsh/src/chat-panel/chat-panel-host.ts        # 修改：DEBT-7 onWebviewMessage 缓存 lastRenderState
apps/vscode-dsh/src/extension.ts                          # 修改：DEBT-7 queryWebviewRenderState + DEBT-10 listChildren + DEBT-12 resetToIdle（均 VSCODE_DSH_TEST=1 门控）
apps/vscode-dsh/src/conversation-controller.ts            # 修改（如需）：DEBT-12 resetForTest() 组合复位方法
apps/vscode-dsh/test-scripts/layer-v-capabilities.json   # 修改：DEBT-2/3/7/10/12 的 manifest（fork 步 / stream 步 / 9 项渲染断言 / subagent requiresModel + 新增 delegate capability / 复位步）
apps/vscode-dsh/test-scripts/layer-v-shadow-preset.sh     # 修改（如需）：DEBT-2 非自主编排 fork preset
apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh  # 修改：DEBT-2 host 编排 / DEBT-12 复位
apps/vscode-dsh/test-scripts/run-vscode-dsh-e2e-closure.sh # 修改：DEBT-12 全链每项能力前后复位
apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs # 修改（如需）：DEBT-12 每项能力前后复位钩子
```

## Phase DAG 依赖

```
phase-1-deterministic-fixes  ──►  phase-2-realmachine-infra
```

- `phase-2-realmachine-infra` 依赖 `phase-1-deterministic-fixes`：① DEBT-12 的「全链一键跑通 41 项」验收依赖其余 manifest 相关债务（DEBT-8/10 的 `requiresModel` 已落定，DEBT-9 的探针文件已改回 `package.json`）先行稳定；② DEBT-7/8/10/12 均改 `layer-v-capabilities.json`，Phase 2 依赖 Phase 1 先把 manifest 的确定性部分（DEBT-8 的 `requiresModel:true`、DEBT-9 探针）落定，避免跨 Phase 并行写同一文件冲突。

## 外部依赖

- 无新增 npm 依赖、无新增基础设施。
- 复用：`Xvfb` + `code` CLI + `ffmpeg`（截图）+ 真实 `DEEPSEEK_API_KEY`（Phase 2 的 DEBT-2/3/8/10 真机往返）。
- 真机验证入口复用 `run-layer-v-capabilities.sh` / `run-vscode-dsh-e2e-closure.sh`（假设 A1：Xvfb + code CLI + key 已就绪）。

## 高风险子系统

1. **DEBT-2 修复面（R1，🔴）**：fork emptySeed 自启动涉及 SDK 分叉语义与 shadow preset 自主编排。修复是否成立取决于「非自主编排 preset」能否真正阻断自启动；若不能，需在「测试环境禁用自主编排」与「调整 fork retry 时序」之间取舍，甚至可能需要触碰 `server.ts` 的 preset 继承语义（超范围）。缓解：phase 级 code-explorer 精确定位 `agent.cordis.yml` 的自主编排配置与 `createForkedSession` 继承链后，再定最小改动；无法达成则 AC-13 如实登记。
2. **DEBT-3 时序抖动（R2）**：流式节奏受模型生成速度影响，调 `intervalMs` 可能引入新波动。缓解：以「真机上稳定捕获增量」为唯一验收，不追求固定间隔值；失败不放宽 `requireIncrement`，如实登记。
3. **DEBT-7 探测通道（R3，🔴）**：需跨 host↔webview 边界新增 `probe/render-state` 异步 round-trip（host 发 query → webview 回 render-state），`dsh.test.queryWebviewRenderState` 必须正确处理「webview 未就绪/超时」的 fail-closed。缓解：复用既有 `__dshProbes` + `data-testid`（大部分组件已就绪），只补 store/bridge/viewtype/html-builder/injection 这几项的信号映射；探测命令 `VSCODE_DSH_TEST=1` 门控、超时 fail-closed、不改视觉。9 项中个别「非 React 节点」若确无可靠渲染信号，按 AC-13 如实登记该项缺口（诚实登记兜底，非默认）。
4. **DEBT-12 隔离覆盖面（R4，🔴）**：串行状态污染可能不止 registry 已列两类。缓解：每项能力结束后统一复位到干净初始态（orchestrator 回 idle + 清 context + 关子 tab）双向兜底，并以全链一键跑通 41 项为终验；仍有残留污染则 AC-13 如实登记，不整 exit 1 交差。
5. **DEBT-10 真实委托可达性（R5，🔴，新增）**：模型是否在简单指令下可靠调用 `subagent` 工具，取决于父会话 agent preset 是否挂载 `tool-subagent` 且 `subagents` provider 可用。**此接线本计划未逐行核实**（未把 preset 挂载点/ provider 名写入现状依据）。缓解：phase 级 code-explorer 必须确认 preset 挂载点与 provider 名后再写 manifest；若真机上模型不委托/无可用 provider，按 AC-13 如实登记，不回退到「`requiresModel` 收窄冒充闭环」。
6. **DEBT-11 守卫删除的连锁破坏**：删除脚本若漏改任一守卫，会导致 `cap-test-harness.spec.ts` / `check-test-scripts-syntax.sh` 失败。缓解：phase 级 code-explorer 穷尽 4 处守卫（含可能遗漏的第 5+ 处），清理后立即跑 `vitest run apps/vscode-dsh/tests` + `check-test-scripts-syntax.sh` 回归护栏。

## 权衡/替代方案

| 决策 | 选定 | 替代方案 | 为什么选 |
|---|---|---|---|
| DEBT-9 判定算法 | 完整 token 判定（两侧均非路径 token 字符） | ① 直接删除防泄漏检查；② 用正则 `\b` 词边界 | `\b` 会把 `.` 当词边界，`package.json` 中的 `json` 仍误判；删除检查则丢失防泄漏保护。完整 token 判定既消误报又保留防护 |
| DEBT-7 二选一 | **真修：补 webview 渲染探测通道** | 保留未闭环（如实登记） | 保留未闭环等于没修债务。补探测通道可复用既有 `__dshProbes` + `data-testid`（大部分组件已就绪），只新增一条 `probe/render-state` 帧 + 一个门控探测命令，侵入可控、不改视觉、`VSCODE_DSH_TEST=1` 门控不违反 `ui_relevant:false`。个别非 React 节点确无可靠信号时按 AC-13 登记该项（诚实兜底，非默认） |
| DEBT-10 二选一 | **真修两步：修正 requiresModel + 新增真实委托 capability** | 仅 `requiresModel` 收窄 false | 仅收窄会漏掉「模型真实委托子 Agent」这一产品能力的覆盖缺口。两步既修正了「UI 机制误标 true」的标记错误，又新增 `cap-delegate-subagent-model` 走真实委托链路（`tool-subagent` → `ctx.subagents.start()`）补上覆盖。委托链路是产品已有能力，非新功能；真机不可达时按 AC-13 登记，不回退收窄冒充 |
| DEBT-12 隔离方案 | **真修：复用 host + 每项能力后真实复位（断言保持原语义）** | per-capability 独立 host；或断言去初始态化 | per-capability 独立 host 需 41 次 Extension Development Host 启动（每次 10–30s，全链耗时不可接受）且改 `launch_host` 契约；「断言去初始态化」是改断言逃避验证。复用 host + `onUserStop()`（orchestrator 回 idle）+ `navBack()`/`closeConversation`（清 readonly-live）真实复位，既保留 idle 断言的真实语义，又以「每项能力结束→复位干净态」修复串行污染 |
| DEBT-2 修法 | 测试环境挂非自主编排 shadow preset | 调整 fork retry 触发时序 / 改 SDK preset 继承 | 根因是测试环境的自主编排 persona 抢先启动；在测试 harness 侧换 preset 是唯一不改产品/SDK 的修法（保留 `emptySeed` + 自动重发 retry 的产品语义不动） |

## 验收标准验证方案

> 逐 Phase 的详细验证策略（每 AC 的验证类型/方法/预期）在 `phases/<phase-id>/spec.md`。下表是整体 AC → Phase 归属概览，供 reviewer/verifier 建立全局视角。

| AC | 归属 Phase | 验证类型 | 一句话验证思路 |
|----|:--:|---|------|
| AC-1 | P1 + P2 | 静态检查 + 审查 | 唯一 `src/` 产品逻辑改动是 `selection-ask.ts` 防泄漏；DEBT-7/10/12 新增的 `dsh.test.*` 命令均 `VSCODE_DSH_TEST=1` 门控、注册在 `shouldRegisterTestHooks` 分支内 |
| AC-2 | P1 | 单测 + 运行时 | 词边界判定：`package.json`(json) 不误判，`@foo/json`(json) 仍判泄漏；`typescript` 无子串冲突正常通过 |
| AC-3 | P1 | 运行时（真机 + key） | `cap-selection-ask` 以 `package.json` 探针 → `ask-about-selection` 返回 `{ok:true, path}` |
| AC-4 | P2 | 运行时（真机 + key） | `cap-fork-from-closed-turn` 的 `child-replied` 断言子会话首轮 `$assistantClosed:LAYER-V-CAP-33-OK` |
| AC-5 | P2 | 运行时（真机 + key） | #18 `streamed-message` 的 `requireIncrement:true` 稳定通过（`sawStreaming`/`sawGrowth` true） |
| AC-6 | P2 | 静态检查 + 运行时（真机） | 9 项 webview 组件：`dsh.test.queryWebviewRenderState` 断言 `renderState.*`/`testIds` 为 concreteAssertion，真机 `closedLoop.closed=true`（真修） |
| AC-7 | P2 | 静态检查 + 运行时（真机） | subagent 两步：两项 `requiresModel:false`（修正标记）+ 新增 `cap-delegate-subagent-model` 真实委托断言子会话 assistant 回复（真修） |
| AC-8 | P2 | 运行时（真机） | `cap-extension-activate`/`cap-test-hooks` 保持 idle 断言原语义，经每项能力前后复位在干净初始态下通过；subagent 后用后复位，后续能力不再 `readonly-live` 失败 |
| AC-9 | P2 | 运行时（真机 + key） | `run-vscode-dsh-e2e-closure.sh` 串行跑完 41 项，exit code 反映真实结论 |
| AC-10 | P1 | 静态检查 + 运行时（真机 + key） | `cap-history-panel`/`cap-message-list-streaming` `requiresModel:true` + 真实模型往返断言 |
| AC-11 | P1 | 静态检查 + 回归验证 | 删除 `run-chat-ready-regression.sh` + 改 4 处守卫；`vitest` + `check-test-scripts-syntax.sh` 通过 |
| AC-12 | P1 + P2 | 回归验证 | `pnpm exec vitest run apps/vscode-dsh/tests` 与既有真机冒烟脚本保持全绿 |
| AC-13 | P1 + P2 | 运行时 + 审查 | 真修确实做不动的缺口（DEBT-2/3/7/10/12 中个别项）如实登记，不放宽断言 / 不重试取巧 / 不改探针规避（兜底，非默认路径） |

## 设计修订记录

| # | 日期 | 原设计章节 | 修改为 | 批准人 | 偏差来源 |
|---|------|-----------|--------|--------|---------|
| 1 | 2026-09-20 | DEBT-7 二选一默认「保留未闭环」；DEBT-10 二选一默认「requiresModel 收窄 false」；DEBT-12 默认「断言去初始态化」 | 三处均改**真修**：DEBT-7 补 webview 渲染探测通道；DEBT-10 两步（修正标记 + 新增真实委托 capability）；DEBT-12 复用 host + 真实复位（断言保持原语义） | — | 用户否定上一版（三处「规避/收窄/改断言」等于没修债务，要求真修） |

## 建议的下一步

HG-2 用户确认方案后，进入 `phase-1-deterministic-fixes`：先委托 code-explorer（phase 级）对 `selection-ask.ts` / `run-chat-ready-regression.sh` 的 4 处守卫 / `cap-test-harness.spec.ts` 的改动面做实施级调研，再创建 `impl-phase-1-deterministic-fixes` 分支，委托 implementer。同时按上游 `.specdev/specs/vscode-dsh-e2e-closure/tech-debt-registry.md:26-33` 把 8 条债务迁移登记到本工作流 `tech-debt-registry.md` 活跃表（Phase Entry 决策）。Phase 2 前，phase 级 code-explorer 必须额外核实：① DEBT-10 的父会话 agent preset 是否挂载 `tool-subagent` 及 provider 名（R5）；② DEBT-7 的 9 项能力到 webview 信号的具体映射；③ DEBT-12 的复位命令在 `capability-runner.cjs` 的接入点。
