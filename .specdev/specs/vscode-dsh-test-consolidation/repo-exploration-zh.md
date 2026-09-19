# 仓库调研报告 — Workflow 级调研（vscode-dsh-test-consolidation）

> 模式：**workflow 级**（`current_phase` 为空）。本报告是 `plan-generator` 写 `design.md`「现状依据」的事实来源，不是某个 Phase 的实施范围。
> 确认度约定：✅ CONFIRMED（已读代码/实测）· ⚠️ HYPOTHESIS（签名存在未读体）· ❓ UNKNOWN（未验证）。凡「⚠️/❓」级别断言**不得**作为设计依据。

## 1. 任务上下文

本工作流 `vscode-dsh-test-consolidation` 只做**测试资产重组**，不改产品代码（`apps/vscode-dsh/src/**`、`webview/**`、`packages/**` 均禁改，`requirements.md:39-40`）。目标是把 `apps/vscode-dsh/tests/` 下 61 个按 Phase/feature/spike/verifier 碎片化命名的 spec 文件，重组为按**能力域**命名的 `cap-<domain>.spec.ts|tsx` 活文件；引入全局唯一 `CAP-<DOMAIN>-<NNN>` 断言编号 + keep/drop 台账；把 `test-scripts/` 纳入同一套域清单并消除 `DEBT-1` 的镜像双拷贝；使 tests 目录进入 lint program（oxlint 归零）并在唯一权威解释器 Node 24.3.0 下全绿。

本次调研要回答的事实问题（供 design.md「现状依据」）：
1. tests 目录真实文件清单 + 每个文件的 SUT 指向（能力域划分的事实基础）；
2. `src/` 能力模块边界与 tests 的对应关系（验证「9 个左右能力域」的假设）；
3. `tests/tsconfig.json` 现状 `include` 白名单内容与头部注释理由；
4. `test-scripts/` 目录结构与 `DEBT-1` 镜像原语的真实重复位置；
5. 既有门禁/脚本体系（`run-gates.ts`、`package.json`）中与 tests / test-scripts 相关的入口；
6. Node 环境（`engines.node`、本机默认解释器、权威解释器路径）；
7. `verifier-phase1/`、`verifier-phase2/` 四个文件的被测对象。

## 2. 仓库概览

- **语言/框架**：TypeScript（`strict: true`）+ React 18（webview 侧）。`apps/vscode-dsh` 是 VS Code 扩展 host（`"type": "module"`，ESM），`apps/vscode-dsh/package.json:13`。
- **包管理**：pnpm workspaces；本 app 为 `@deepseek-ai/dsh-vscode-dsh`（`package.json:2`），私有。
- **测试框架**：Vitest `^4.1.8`（`apps/vscode-dsh/package.json:237`）；webview 断言用 `@testing-library/react`（`tests/layer-a-rtl/editor-chat-shell.spec.tsx:9`）。
- **目录结构（本工作流触及面）**：
  - `apps/vscode-dsh/tests/`：61 个 spec（`.spec.ts` 54 + `.spec.tsx` 7，实测 `find` 计数）＋ 3 个 helper（`spike-attribution-helpers.ts`、`spike-t0a-replay-hydrator.ts`、`spike-t0b-continue-helpers.ts`）＋ `fixtures/`（`fake-sdk-runtime.mjs`、`screenshots/README.md`）＋ `tsconfig.json` ＋ 2 个 `.tsbuildinfo` 残留。
  - `apps/vscode-dsh/src/`：见 §3（约 55 个 `.ts` 文件，6 个子目录 + 25 个顶层模块文件）。
  - `apps/vscode-dsh/webview/src/`：React SPA（`App.tsx`、`bridge/`、`components/`、`store/`、`styles/`、`utils/`）。
  - `apps/vscode-dsh/test-scripts/`：4 类资产（见 §4）。
- **CI/门禁**：`scripts/run-gates.ts`（1575 行）定义 gate 图；`scripts/run-oxlint.ts` 是 oxlint CLI 包装；`scripts/check-test-scripts-syntax.sh` 是 `.sh` 语法门禁。

## 3. 最相关区域

### 3.1 tests 目录 SUT 映射（能力域划分的事实基础）

以下按被测对象（SUT）归类 61 个 spec。来源：👁 逐文件 `import` 语句 grep（`from '../src/...'` / `'../../src/...'` / `'../../webview/src/...'`）。

**A. test-scripts 自身 tester（SUT = test-scripts 资产，非 src）** — 8 个文件：

| spec 文件 | SUT（路径证据） |
|---|---|
| `artifact-index.spec.ts` | `test-scripts/layer-v-support/artifact-index.cjs`（`require` 于 `tests/artifact-index.spec.ts:43`） |
| `display-evidence.spec.ts` | `layer-v-support/display-evidence.cjs`（`:41`） |
| `display-evidence-shell.spec.ts` | `display-evidence-shell.sh` + `run-layer-v-smoke.sh` + `display-evidence.cjs`（`:34-39`） |
| `build-freshness.spec.ts` | `layer-v-support/build-freshness.cjs` + `run-layer-v-smoke.sh` + `tsdown.config.ts`（`:69-80`） |
| `sandbox-clean-state.spec.ts` | `layer-v-driver/sandbox-clean-state.cjs`（`:56`） |
| `chat-ready-regression.spec.ts` | `test-scripts/run-chat-ready-regression.sh`（`:30`） |
| `layer-v-capabilities-phase3.spec.ts` | `test-scripts/layer-v-capabilities.json`（manifest 反桩契约，`:14-48`） |
| `layer-v-capability-runner.spec.ts` | `layer-v-capability-driver/capability-runner.cjs`（`:28`） |

**B. session/host 生命周期**：

| spec 文件 | SUT |
|---|---|
| `session-host.spec.ts` | `session-host.ts`、`auto-start-orchestrator.ts`、`env.ts`、`host-diagnostics.ts`、`redact.ts`（`session-host.spec.ts:11-15`） |
| `session-host-preflight.spec.ts` | `session-host.ts` + `@deepseek-ai/dsh-sdk-client`（`:19-20`） |
| `node-env-guard.spec.ts` | `node-env-guard.ts`、`session-host.ts`、`extension.ts`（`:25-27`） |
| `host-diagnostics.spec.ts` | `host-diagnostics.ts`、`auto-start-orchestrator.ts`、`connection-ui.ts`、`interaction-coordinator.ts`、`session-host.ts`、`extension.ts`（`:24-38`） |
| `layer-v-inject-disconnect.spec.ts` | `auto-start-orchestrator.ts`、`host-diagnostics.ts`、`session-host.ts`（`:39-41`） |
| `phase1-auto-start.spec.ts` | `session-host.ts`、`extension.ts`（`:7,14`） |
| `phase2-auto-ready.spec.ts` | `session-host.ts`、`extension.ts`、`extension-index.ts`、`conversation-controller.ts`、`auto-ready-coordinator.ts`（`:6-18`） |

**C. conversation / multi-tab / history / timeline**：

| spec 文件 | SUT |
|---|---|
| `conversation-registry.spec.ts` | `conversation-registry.ts`、`conversation-tab-bar.ts`（`:7-8`） |
| `multi-tab-session.integration.spec.ts` / `multi-tab-dispose.e2e.spec.ts` | `conversation-controller.ts`、`session-host.ts`（`:11-12`） |
| `panel-close-delete.e2e.spec.ts` | `conversation-controller.ts`、`session-host.ts`、`change/snapshot-store.ts`、`extension-index.ts`（`:10-13`） |
| `phase2-multitab-history-replay.spec.ts` | `conversation-controller.ts`、`chat-panel/index.ts`、`session-host.ts`、`interaction-coordinator.ts`、`replay-hydrator.ts`、`extension-index.ts`、`history-view.ts`、`extension.ts`（`:6-24`） |
| `phase2-history-delete-host.spec.ts` | `extension-index.ts`、`chat-panel/protocol.ts`（`:5-6`） |
| `timeline-projector.spec.ts` | `timeline-store.ts`（`:6`） |
| `timeline-diff.e2e.spec.ts` | `extension.ts`、`session-host.ts`、`conversation-controller.ts`、`timeline-view.ts`、`diff-entry.ts`（`:10-14`） |
| `timeline-diff.integration.spec.ts` | `conversation-controller.ts`、`session-host.ts`、`diff-entry.ts`（`:11-13`） |
| `spike-attribution-snapshot.spec.ts` | `timeline-store.ts` + `spike-attribution-helpers.ts`（`:11,20`） |

**D. chat-panel / render / message（宿主侧 UI 底盘）**：

| spec 文件 | SUT |
|---|---|
| `chat-ux-activity-stream.spec.ts` | `conversation-controller.ts`、`chat-panel/index.ts`、`session-host.ts`、`replay-hydrator.ts`（`:7-14`） |
| `chat-ux-fork-retry-branch.spec.ts` | 同上 + `replay-hydrator.ts`（`:8-15`） |
| `chat-ux-refs-changes-diff.spec.ts` | `chat-panel/index.ts`、`conversation-controller.ts`、`timeline-store.ts`、`replay-hydrator.ts`、`diff-entry.ts`、`render/ref-cards.ts`、`render/change-diff-dom.ts`、`render/activity-dom.ts`（`:7-18`） |
| `chat-ux-session-search.spec.ts` | `conversation-controller.ts`、`chat-panel/index.ts`、`change/index.ts`、`search/index.ts`、`session-host.ts`、`replay-hydrator.ts`（`:11-23`） |
| `chat-ux-streaming-cancel-follow.spec.ts` | `conversation-controller.ts`、`chat-panel/index.ts`、`session-host.ts`、`replay-hydrator.ts`（`:7-14`） |
| `editor-chat-panel.lifecycle.spec.ts` | `conversation-registry.ts`、`message-store.ts`、`chat-panel/index.ts`、`session-host.ts`、`extension.ts`（`:9-23`） |
| `message-store-index.spec.ts` | `message-store.ts`、`extension-index.ts`（`:6-7`） |
| `panel-l2-l3-protocol.spec.ts` | `conversation-controller.ts`（`:6`） |
| `phase2-change-list-display.spec.ts` | `chat-panel/index.ts`、`conversation-controller.ts`、`change/index.ts`、`session-host.ts`、`extension.ts`（`:15-24`） |
| `phase3-chat-ui-chassis.spec.ts` | `chat-panel/index.ts`、`markdown/safe-markdown.ts`、`conversation-tab-bar.ts`、`conversation-registry.ts`、`conversation-controller.ts`、`conversation-titles.ts`、`extension-index.ts`、`history-view.ts`、`session-host.ts`、`extension.ts`（`:16-36`） |
| `phase3-restart-continue.spec.ts` | `conversation-controller.ts`、`chat-panel/index.ts`、`session-host.ts`、`interaction-coordinator.ts`、`replay-hydrator.ts`、`diff-entry.ts`、`extension-index.ts`、`restore-planner.ts`、`continue-capability.ts`、`extension.ts`（`:6-36`） |
| `phase3-review-revert-replay.spec.ts` | `chat-panel/index.ts`、`conversation-controller.ts`、`change/index.ts`、`session-host.ts`、`extension-index.ts`、`extension.ts`（`:15-33`） |
| `phase4-new-conversation-chrome.spec.ts` | `session-host.ts`、`extension.ts`、`chat-panel/index.ts`、`conversation-controller.ts`（`:6-20`） |
| `phase4-subagent-enter-pin.spec.ts` | `conversation-controller.ts`、`chat-panel/index.ts`、`session-host.ts`、`interaction-coordinator.ts`（`:7-14`） |
| `phase5-should-polish.spec.ts` | `chat-panel/index.ts`、`markdown/safe-markdown.ts`、`continue-capability.ts`、`conversation-tab-bar.ts`、`conversation-registry.ts`、`conversation-controller.ts`、`timeline-store.ts`、`session-host.ts`、`extension.ts`（`:13-31`） |

**E. interaction（审批/交互）**：

| spec 文件 | SUT |
|---|---|
| `interaction-approval-resolution.spec.ts` | `interaction-coordinator.ts`（`:12`） |
| `interaction-fail-closed.e2e.spec.ts` | `conversation-controller.ts`、`session-host.ts`（`:10-11`） |
| `interaction-fail-closed.integration.spec.ts` | `conversation-controller.ts`、`interaction-coordinator.ts`、`conversation-registry.ts`、`session-host.ts`（`:9-12`） |
| `replaceability-interaction-ui.spec.ts` | `conversation-controller.ts`、`interaction-coordinator.ts`、`session-host.ts`（`:12-14`） |
| `gap-005-009-debt-fix.spec.ts` | `extension.ts`、`conversation-controller.ts`、`interaction-coordinator.ts`、`interaction-ui.ts`、`session-host.ts`（`:10-18`） |
| `gap-003-004-debt-fix.spec.ts` | `conversation-controller.ts`、`conversation-tab-bar.ts`、`conversation-registry.ts`、`session-host.ts`（`:7-13`） |

**F. code-context（@path / 选区提问）**：

| spec 文件 | SUT |
|---|---|
| `phase1-code-context.spec.ts` | `conversation-controller.ts`、`chat-panel/index.ts`、`session-host.ts`、`code-context/index.ts`（`:16-35`） |

**G. layer-a（宿主侧 render 原语，非 webview）** — 5 个文件：

| spec 文件 | SUT |
|---|---|
| `layer-a/activity-stream.spec.ts` | `chat-panel/render/activity-dom.ts`、`message-dom.ts`、`probes.ts`、`activity-types.ts`（`:13-16`） |
| `layer-a/foundation-render-probe.spec.ts` | `render/follow-state.ts`、`message-dom.ts`、`sync-chrome.ts`、`probes.ts`、`chat-panel-provider.ts`（`:16-31`） |
| `layer-a/protocol-decision-smoke.spec.ts` | `chat-panel/index.ts`、`conversation-controller.ts`、`session-host.ts`（`:10-12`） |
| `layer-a/refs-changes-diff.spec.ts` | `code-context/at-path.ts`、`chat-panel-provider.ts`、`chat-panel/protocol.ts`、`render/activity-dom.ts`、`render/change-diff-dom.ts`、`render/ref-cards.ts`（`:10-23`） |
| `layer-a/streaming-cancel-follow.spec.ts` | `render/follow-state.ts`、`message-dom.ts`、`sync-chrome.ts`、`probes.ts`（`:10-19`） |

**H. layer-a-rtl（webview React SPA，.tsx）** — 2 个文件：

| spec 文件 | SUT |
|---|---|
| `layer-a-rtl/editor-chat-phase2.spec.tsx` | `webview/src/App.tsx`、`bridge/message-bridge.ts`、`store/chat-ui-store.ts`、`webview/src/probes.ts`（`:10-17`） |
| `layer-a-rtl/editor-chat-shell.spec.tsx` | 同上（`:10-16`） |

**I. spike（跨 harness 包，SUT 在 packages/）** — 2 个文件：

| spec 文件 | SUT |
|---|---|
| `spike-t0a-replay-rebuild.spec.ts` | `@deepseek-ai/dsh-llm`、`dsh-session`、`dsh-session-persistence-jsonl`、`dsh-session-query` + `spike-t0a-replay-hydrator.ts`（`:10-31`） |
| `spike-t0b-continue-capability.spec.ts` | `dsh-llm`、`dsh-system-prompt`、`dsh-tools`、`dsh-agent`、`dsh-agent-loop`、`dsh-session-projection`、`dsh-session-query`（`:10-28`） |

**J. verifier 文件（4 个，被测对象见 §7）**。

### 3.2 src 模块边界（能力域划分对照）

`apps/vscode-dsh/src/` 结构（👁 `find` 实测）：

**顶层模块文件（25 个）**：`extension.ts`（主入口）、`session-host.ts`、`conversation-controller.ts`、`conversation-registry.ts`、`conversation-tab-bar.ts`、`conversation-titles.ts`、`message-store.ts`、`replay-hydrator.ts`、`timeline-store.ts`、`timeline-view.ts`、`history-view.ts`、`diff-entry.ts`、`auto-start-orchestrator.ts`、`auto-ready-coordinator.ts`、`continue-capability.ts`、`interaction-coordinator.ts`、`interaction-ui.ts`、`host-diagnostics.ts`、`node-env-guard.ts`、`connection-ui.ts`、`env.ts`、`redact.ts`、`restore-planner.ts`、`extension-index.ts`、`index.ts`。

**子目录（6 个）**：
- `change/`（8 文件）：`change-attributor`、`change-ignore`、`change-index`、`change-store`、`index`、`revert`、`snapshot-store`、`types`
- `chat-panel/`（9 + render/7 文件）：`chat-panel-host`、`chat-panel-provider`、`editor-chat-panel`、`composer-keydown`、`protocol`、`probes`、`activity-types`、`index` + `render/{activity-dom, change-diff-dom, follow-state, message-dom, ref-cards, sync-chrome, index}`
- `code-context/`（6）：`at-path`、`open-reference`、`ref-read-coverage`、`selection-ask`、`selection-meta`、`index`
- `fork/`（1）：`fork-orchestrator`
- `markdown/`（1）：`safe-markdown`
- `search/`（3）：`session-search`、`path-session-index`、`index`

**与 `layer-v-capabilities.json` 的 12 个 `group` 对照**（👁 读 `layer-v-capabilities.json:6-722`）：
`react-spa-main`(8)、`editor-panel`(4)、`session-main-path`(9)、`subagent`(2)、`code-context`(3)、`change-list`(3)、`search`(2)、`fork`(2)、`continue`(3)、`history`(2)、`interaction`(2)、`test-hooks`(1)，共 41 条 capability。

> ⚠️ **关键张力（进 §7 Risks）**：需求假设「9 个左右能力域」（`requirements.md:176` R-7 也承认「域划分由文件内容推断，未必等于产品能力边界」），但 manifest 已有 **12 个 group**，`src/` 自然聚类约 **8-10 个**。AC-19 只要求「每个 `group` 映射到某个域 id」即允许**多对一**（12 group → N domain）。「9 个左右」是一个待 plan-generator 用本节事实定稿的**假设**，不是已确认事实。

## 4. 关键入口 / 调用路径

**路径 1：单元/集成测试 → src 模块（vitest 直接 import）**

```
vitest run apps/vscode-dsh/tests/<spec>.spec.ts
  └─ import { X } from '../src/<module>.ts'   (e.g. session-host.spec.ts:11-15)
       └─ 断言导出的宿主类/函数行为（无 Extension Host）
```

**路径 2：smoke 链路（test-scripts → 真实 Extension Development Host）**

```
bash apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh
  └─ 启动 Extension Development Host（--extensionDevelopmentPath 指向 test-scripts/layer-v-driver）
       └─ require('layer-v-driver/extension.cjs')   (2441 行，in-host 半)
            ├─ 读 layer-v-plan.json → 驱动 dsh.* 命令 → 采集 panelSnapshot
            └─ 写 layer-v-status.json / journal / screenshots → shell 读回判退出码
```

**路径 3：capability 编排链路（manifest → 纯 runner → 薄 binder）**

```
bash apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh
  └─ write_plan → Host 加载 test-scripts/layer-v-capability-driver/extension.cjs (226 行, 薄)
       └─ require('./capability-runner.cjs')   (911 行, 纯编排，依赖无关)
            └─ 读 layer-v-capabilities.json (41 条 capability / 12 group)
                 → selectCapabilities → runCapability → overallConclusion
                 → 写 layer-v-capabilities-status.json（conclusion + verdict list）
```

> verifier 的端到端复验可复用路径 2/3（无凭证环境跑 `run-layer-v-smoke.sh` 与 `run-layer-v-capabilities.sh`，退出码与整合前一致，AC-23）。

## 5. 影响面

| 面 | 内容 | 风险 |
|---|---|---|
| `apps/vscode-dsh/tests/*.spec.ts|tsx`（61 文件 + 3 helper + fixtures） | 重命名/归并为 `cap-<domain>.spec.ts|tsx`；逐用例编号 `CAP-*`；keep/drop 筛选 | 高：R-1 hook/fixture 作用域污染；R-4 `.tsx`(jsdom) 与 `.ts`(node) 混文件 |
| `apps/vscode-dsh/tests/tsconfig.json` | `include` 白名单（12 文件）→ glob 全目录 | 中：触发 203 条真实 lint（AC-16 基线）需在测试资产内修 |
| `apps/vscode-dsh/tests/capability-domains.json`（新增） | 域清单 + `absorbed` + `entryAssertions` + `verifierSources` | 中：AC-2 双向差集必须为空 |
| `apps/vscode-dsh/tests/assertion-map.md`（新增） | keep/drop 台账（每行 K/D 码 + 所指对象） | 高：AC-9 逐声明行双向差集；AC-27 依据路径 L4/L5 校验 |
| `apps/vscode-dsh/test-scripts/**` | 分层（入口/共享原语/清单数据/支撑）；抽 `layer-v-support/` 共享原语 | 高：消除 DEBT-1 双拷贝但**不改可执行结论**（AC-23） |
| `tech-debt-registry.md`（本工作流） | 关闭 `DEBT-1@e2e-closure`；登记 `DEBT-4/5` 不关闭；DEBT-019 tests 段口径 | 低 |
| **不改** `src/**`、`webview/**`、`packages/**`、`.oxlintrc*.json`、`scripts/run-gates.ts`、`constitution.md` | AC-24 / AC-5 / 需求排除项 | 高（一旦误改即 AC-24 违反） |

**注意**：`layer-a/foundation-render-probe.spec.ts`、`layer-a/refs-changes-diff.spec.ts`、`phase1-code-context.spec.ts`、`phase3-restart-continue.spec.ts`、`phase3-review-revert-replay.spec.ts`、`phase5-should-polish.spec.ts` 仍 import/调用**已废弃**的 `buildThinChatHtml`（标记「fixture-only」于 `src/chat-panel/chat-panel-provider.ts:7`，定义 `:190`）。AC-24 补充条款允许「把 spec 对已废弃接口的调用改为引用替代实现」属测试资产变更，不属改生产代码——plan-generator 需在 design.md 明确这 6 处调用何去何从（其中 `foundation-render-probe.spec.ts:194` 已是 `it.skip(... [legacy fixture])`）。

## 6. 既有约束 / 约定

> 本节是 `design.md`「现状依据」的直接来源。每条标注 `路径:行号`。

1. **测试编号现状混乱，无统一约定**：全树 `describe` 标题混用 `VP-*`、`phase-N`、`verifier ...`、`Spike ...`、`layer-B ...`、`test:*`、`the shell consumer ...`、`Timeline`、`R1.3` 等（👁 grep 全树 describe 标题），**无任何 `cap:` 前缀域约定**。整合必须建立新约定（AC-3 `describe('cap:<domain> — ')`）。

2. **tsconfig program 契约（DEBT-019 成因）**：`tests/tsconfig.json:2-14` 头部注释声明——该 tsconfig 是「给 `include` 内 spec 一个 program 以清除 `no-unsafe-*` 诊断」的私有 lint 契约，非全目录声明。`include` 白名单 12 文件（`tests/tsconfig.json:36-49`）。注释声称：12 文件 `tsc --noEmit` = **171** error，全目录 probe = **460** error（`:8-13`）；「目录过大不可作为 program」是刻意不纳入其余文件的理由（`:8`）；未匹配文件落入仓库级债务 `DEBT-019`（`:14`）。AC-17 要求更新此注释（不再陈述「目录过大不可作为 program」）。

3. **ESM + `"type": "module"`**：spec 是 ESM（`.ts` 相对导入必须带 `.ts` 后缀，见 `session-host.spec.ts:11` `from '../src/auto-start-orchestrator.ts'`）。test-scripts 的 `.cjs` 是纯 CommonJS 无 npm 依赖（`layer-v-capability-driver/extension.cjs:26-33` 注释：「app 是 `type:module`，CJS 是 VS Code 唯一能 `require` 的形状」）。

4. **镜像原语语义重复是既有债务（DEBT-1）**：见 §9 表——`layer-v-driver/extension.cjs` 与 `layer-v-capability-driver/capability-runner.cjs` 各持一份语义等价原语，未 `require` 复用。AD-2 机制（「不改既有文件」）导致镜像（`e2e-closure/tech-debt-registry.md:26`）。

5. **门禁体系**：
   - `check:test-scripts-syntax` = `bash scripts/check-test-scripts-syntax.sh`（`package.json:67`），挂在 `ciSharedStaticGates()`（`scripts/run-gates.ts:312`），故 `ci-primary`/`ci-linux-primary`/`ci-static`/`check-all` 都会跑它。该脚本 pin 3 个 shell 资产 + glob 发现 `.sh`（`check-test-scripts-syntax.sh:24-28`），用 `bash -n` 校验。
   - lint 入口 = `lint:contracts-ready` = `tsx scripts/run-oxlint.ts .`（`package.json:32`），跑全仓；`run-oxlint.ts:5` 指向 `node_modules/oxlint/bin/oxlint`。**tests 目录当前不在任何独立 lint gate 里**，只随全仓 `oxlint .` 走仓库级基线（DEBT-019）。
   - `.oxlintrc.json` 有 `apps/vscode-dsh/test-scripts/**/*.cjs` 的 override（语法/语义规则，`.oxlintrc.json` 约 `:341-342` 起），针对 `*.cjs` 无 TS program。

6. **测试策略约定（仓库级 AGENTS.md）**：`test:coverage` 是 CI 覆盖率门禁，对象是 `packages/*/*/src`（`AGENTS.md` 命令表）；`apps/vscode-dsh/tests` **不在** `test:coverage` 对象内。`vitest run apps/vscode-dsh/tests` 是显式路径口径（AC-14）。

7. **运行环境铁律**：所有判定命令须写 `env PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" <cmd>`（`requirements.md:163`）。本机默认 node 被 `~/.bashrc:151` 写死 v20.16.0（不满足 `engines`），是环境陷阱。

## 7. 风险 / 未知

| # | 风险/未知 | 确认度 | 说明 / 证据 |
|---|---|---|---|
| R-1 | **「9 个左右能力域」与真实边界张力** | ✅ CONFIRMED（事实） | manifest 有 12 group（`layer-v-capabilities.json:6-722`），src 自然聚类 8-10（§3.2），61 spec 的 SUT 覆盖约 10 类（§3.1）。「9 个左右」是需求侧假设，AC-19 允许多对一映射，域数由 plan-generator 定稿。 |
| R-2 | **DEBT-1 镜像「逐字节一致」描述不精确** | ✅ CONFIRMED | `captureScreenshot` 签名不一致：`layer-v-driver/extension.cjs:809` = `(capture, fileName)` 2 参 vs `capability-runner.cjs:563` = `(capture, fileName, artifactDir)` 3 参。故是**语义镜像 + 局部签名漂移**，非逐字节一致。AC-20 要求「定义处数各为 1」的判定不受此影响，但「逐字节」措辞需在 design.md 校正。 |
| R-3 | **镜像原语集合 > AC-20 基线 9 项** | ✅ CONFIRMED | 除基线 9 项（`StageError`/`linkFailure`/`harnessError`/`skipNoCredentials`/`safeJson`/`pngVerdict`/`sha256Of`/`resolveCaptureTool`/`captureScreenshot`），另有 `sleep`/`nowIso`/`truncate`/`unwrap`/`poll`/`assistantText`/`runCapture`/`outputFreeTemplateViolation`/`probeScreenSize` + 常量 `OVERSIZED_CAPTURE_AREA` 也重复（§9 表）。实现阶段须全量重算（需求已声明「不得直接采信」AC-20）。 |
| R-4 | **oxlint「1184→203」基线未独立复测** | ❓ UNKNOWN | 需求 AC-16 给出现状 1184 / 仅 glob 203（`requirements.md:116`）。本调研未跑 `tsx scripts/run-oxlint.ts apps/vscode-dsh/tests`（需 build 前置、耗时、且类型感知规则依赖 program）。design.md 引用该基线时应标注「来源 = requirements.md AC-16，Phase 0 复测留档」。 |
| R-5 | **fixture/hook 作用域污染（合并风险）** | ⚠️ HYPOTHESIS | 合并 61 文件到 ~9-12 域文件时，`beforeEach`/`vi.mock`/`vi.resetAllMocks` 作用域可能互相污染（需求 R-1）。本调研未逐文件核对 hook 依赖清单——plan-generator 应把「每文件 hook/fixture 依赖清单」作为 Phase 0/1 前置产出。 |
| R-6 | **`buildThinChatHtml` 已废弃但 6 文件仍调用** | ✅ CONFIRMED | 见 §5 注意项；`chat-panel-provider.ts:7` 声明「fixture-only as of Phase 2 (AD-ECP-8 / DEBT-ECP-001)」。 |
| R-7 | **`.tsx`(jsdom) 与 `.ts`(node) 是否可同文件** | ❓ UNKNOWN | 需求 R-4 假设 `// @vitest-environment jsdom` 按文件生效。本调研未验证合并后混合环境的可行性；plan-generator 需在 design.md 明确「域含 webview RTL 时拆 `.tsx`」策略。 |
| R-8 | **集成基线分支非 `main`** | ✅ CONFIRMED | 仓库无 `main`，集成分支是 `new/vscode-dsh`（`requirements.md:162`）。`spec-workflow.mdc` 的 `git checkout main` 与仓库不符，本工作流 Phase 分支须用 `new/vscode-dsh`。 |

## 8. 不确定 / 未核验

| 函数/资产 | 位置 | 说明 | 确认度 |
|---|---|---|---|
| `captureScreenshot`（两版） | `layer-v-driver/extension.cjs:809` / `capability-runner.cjs:563` | 签名与 `ARTIFACT_DIR` 来源不同（`__dirname`-derived vs `plan.artifactDir`）；未逐行比对函数体是否语义等价 | ⚠️ HYPOTHESIS |
| `poll` / `pollForStream` | `extension.cjs:245` / `capability-runner.cjs:151,187` | runner 多一个 `pollForStream`（流式增量）；是否与 extension.cjs 的 `poll` 语义等价未核 | ⚠️ HYPOTHESIS |
| `runManifest` | `capability-runner.cjs:833` | 纯编排入口，签名存在；未跑真机链路验证其结论聚合行为 | ⚠️ HYPOTHESIS |
| `layer-v-capabilities.json` 41 条 capability 的 `requiresModel` 覆盖 | `layer-v-capabilities.json` | DEBT-4/5 登记 8 条从未真机执行（`e2e-closure/tech-debt-registry.md:29-30`）；其余条目真机结论未在本调研复验 | ⚠️ HYPOTHESIS |
| `buildThinChatHtml` 替代实现名 | `chat-panel/chat-panel-provider.ts:190` | 需求 AC-24 提到「替代实现」但未点名；实际 SPA HTML 构建器是 `buildEditorChatSpaHtml`（`editor-chat-panel.ts:116` 证据在 `layer-v-capabilities.json:132`） | ⚠️ HYPOTHESIS |

## 9. 桩检测 & Registry 交叉校验

本工作流 registry（`vscode-dsh-test-consolidation/tech-debt-registry.md`）**活跃债务为空**（`:26` 仅 `—` 占位），已解决为空。跨工作流引用 `e2e-closure/tech-debt-registry.md` 有 `DEBT-1`~`DEBT-5`。

### Registry 校验结果

| Registry ID | 文件:符号 | Registry 状态 | 代码实际状态 | 判定 |
|---|---|---|---|---|
| `DEBT-1@vscode-dsh-e2e-closure` | `capability-runner.cjs` vs `layer-v-driver/extension.cjs`（镜像原语） | 活跃，🟡非阻塞（`:26`） | 镜像原语**仍在**，两处各持一份（见下表） | ✅ 匹配 |
| `DEBT-4@…` | `layer-v-capabilities.json`（change-list 3 项） | 活跃，🔴阻塞（`:29`） | 从未真机执行，取证文件数为 0 | ✅ 匹配（不关闭，AC 范围外） |
| `DEBT-5@…` | `layer-v-capabilities.json`（code-context 3 + interaction 2 项） | 活跃，🔴阻塞（`:30`） | 从未真机执行 | ✅ 匹配（不关闭，AC 范围外） |

### DEBT-1 镜像原语定义位置逐项对照（👁 grep 实测）

| 原语 | `layer-v-driver/extension.cjs` | `capability-runner.cjs` | 逐字节一致？ |
|---|---|---|---|
| `OVERSIZED_CAPTURE_AREA` 常量 | `:59` | `:57` | 值一致 `'4096x2160'` |
| `StageError`（class） | `:97` | `:69` | 需逐行比对 |
| `linkFailure` | `:111` | `:83` | 需逐行比对 |
| `harnessError` | `:112` | `:84` | 需逐行比对 |
| `skipNoCredentials` | `:114` | `:85` | 需逐行比对 |
| `sleep` | `:116` | `:87` | 需逐行比对 |
| `nowIso` | `:120` | `:91` | 需逐行比对 |
| `truncate` | `:124` | `:95` | 需逐行比对 |
| `safeJson` | `:139` | `:105` | 需逐行比对 |
| `unwrap` | `:173` | `:136` | 需逐行比对 |
| `poll` | `:245` | `:151` | 需逐行比对（runner 另有 `pollForStream:187`） |
| `assistantText` | `:519` | `:256` | 需逐行比对 |
| `pngVerdict` | `:550` | `:418` | 需逐行比对 |
| `sha256Of` | `:564` | `:432` | 需逐行比对 |
| `runCapture` | `:695` | `:440` | 需逐行比对 |
| `outputFreeTemplateViolation` | `:688` | `:455` | 需逐行比对 |
| `probeScreenSize` | `:660` | `:463` | 需逐行比对 |
| `resolveCaptureTool` | `:727` | `:490` | 需逐行比对 |
| `captureScreenshot` | `:809` | `:563` | 🔴 **签名不同**：2 参 vs 3 参 |

### Stub Detection 小结

- ✅ **已确认桩**：0 个（本工作流范围内未发现 `(void)`/空壳/`return []` 型桩；tests 内 `it.skip` 属已声明跳过，非桩）。
- ⚠️ **Registry 不一致**：1 处——`DEBT-1` 描述「语义逐字节一致」与实际「语义镜像 + `captureScreenshot` 签名漂移」不符（§7 R-2）。
- 🔴 **未注册桩**：0 个（未发现未登记桩）。
- 🟡 **需关注**：`foundation-render-probe.spec.ts:194` 的 `it.skip(... [legacy fixture])`（对已废弃 `buildThinChatHtml` 的残留，AC-24 允许测试资产内改引用）。

## 10. 推荐下一步阅读

1. ⭐ **必读** — `.specdev/specs/vscode-dsh-test-consolidation/requirements.md`（29 条 AC + F1-F8 + R-1~R-8）
2. ⭐ **必读** — `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`（41 capability / 12 group，域映射的事实锚点）
3. ⭐ **必读** — `.specdev/specs/vscode-dsh-e2e-closure/tech-debt-registry.md`（DEBT-1/4/5 精确语义）
4. 🔷 **应读** — `apps/vscode-dsh/tests/tsconfig.json`（白名单 + DEBT-019 成因注释）
5. 🔷 **应读** — `apps/vscode-dsh/test-scripts/layer-v-driver/extension.cjs` 与 `layer-v-capability-driver/capability-runner.cjs`（镜像原语两侧，DEBT-1 消除的写面）
6. 🔷 **应读** — `scripts/run-gates.ts:230-343`（gate 图；`check:test-scripts-syntax` 挂载点）
7. 🔹 **可选** — `scripts/check-test-scripts-syntax.sh`、`scripts/run-oxlint.ts`（既有门禁实现）
8. 🔹 **可选** — `apps/vscode-dsh/tests/verifier-phase1/layer-b-lifecycle.spec.ts` 与 `verifier-phase2/layer-b-host.spec.ts`（verifier 独立性现状，判断「流程化」后去留）
