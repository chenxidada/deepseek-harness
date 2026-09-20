# 需求文档 — 修复 vscode-dsh-e2e-closure 活跃技术债

> 工作流 slug：`fix-e2e-closure-debts`
> 本文件由 requirement-analyst 产出，是所有下游工作（plan-generator / implementer / reviewer / verifier）的验收契约基础。

## 产品目标

把上一个工作流 `vscode-dsh-e2e-closure` 在 `.specdev/specs/vscode-dsh-e2e-closure/tech-debt-registry.md` 中登记的 **8 条活跃债务**（DEBT-2 / DEBT-3 / DEBT-7 / DEBT-8 / DEBT-9 / DEBT-10 / DEBT-11 / DEBT-12）逐条修复：让「未闭环」的能力真正闭环，让「误报」的产品行为正确，让「过时」的脚本清理，让「串行污染」的全链入口可靠。

## 问题陈述

上一个工作流的定位是「诚实登记缺口、不在本 feature 回归补齐」，因此把 8 项达不成闭环的缺口如实登记为活跃债务、交给后续 feature。本工作流正是那个「后续 feature」——它必须把这些债务从「已登记」推进到「已解决」：

- 部分债务是**验证基建缺口**（缺测试可达性 / 缺流式增量可观测 / 缺 webview 探测通道 / 缺真实模型委托 / 缺 per-capability 状态隔离）；
- 部分是**测试数据修正**（`requiresModel` 标记与步骤语义不一致）；
- 部分是需要清理的**过时脚本**（引用已不存在的测试文件）；
- **一条是产品代码 bug**（DEBT-9：selection-ask 防泄漏检查用裸子串误判合法路径）。

## 目标终态

1. 8 条活跃债务全部「已解决」：每一项都有「修复 + 真机/静态证据 + 结论」，结论明确为「闭环通过」或「行为正确」或「清理完成」。
2. 对 DEBT-9（产品 bug），修复后 `cap-selection-ask` 能直接以 `package.json` 为探针文件真机闭环，不再需要改用 `src/index.ts` 规避。
3. 对验证基建缺口类债务（DEBT-2/3/7/10/12），修复后全链入口 `run-vscode-dsh-e2e-closure.sh` 一键跑通 41 项，exit code 反映真实结论，不再因串行状态污染整体 exit 1。
4. 对 DEBT-11（过时脚本），清理后既有回归测试保持全绿（`vitest run apps/vscode-dsh/tests` 与既有真机冒烟脚本）。
5. 修复过程诚实登记：凡无法在本工作流内完成的缺口，如实保留/新增为债务并说明原因，不得放宽断言或改探针规避。

## 目标用户

- **vscode-dsh 维护者 / 贡献者**：需要一份可靠的一键真机闭环验证入口（41 项能力全部可跑通、结论可信），而不是一个串行跑就状态污染、部分项被误判未闭环的脆弱入口。
- **发布/验收流程**：发布前需要「每一项能力都有可信的真机证据」，不再有「面板打开即算验证通过」的弱证据。

## 核心场景

1. **S-1 修复产品 bug**：维护者对 `package.json` 发起选区提问，`runAskAboutSelection` 不再返回 `path-unrepresentable`，而是正常返回 `{ok:true, path}` 并触发模型往返。
2. **S-2 修复未闭环能力**：维护者运行全链入口，`cap-fork-from-closed-turn` 的 `child-replied`、`cap-message-store-stream-patch` 的 `streamed-message`、subagent 两项、history/streaming 两项都能产生真实闭环证据。
3. **S-3 清理过时脚本**：维护者删除/清理 `run-chat-ready-regression.sh` 的过时引用后，`pnpm exec vitest run apps/vscode-dsh/tests` 与 `scripts/check-test-scripts-syntax.sh` 仍通过。
4. **S-4 一键验证**：维护者运行 `run-vscode-dsh-e2e-closure.sh`，41 项能力串行跑完后整体结论可信，exit code 反映真实状态，无串行状态污染。

## 预期范围

**范围内（8 条活跃债务，逐条修复）：**

| DEBT | 修复性质 | 主分类 |
|------|---------|--------|
| DEBT-2 | fork emptySeed 分叉子会话因 shadow preset 自主编排自启动，retry 提示词非首轮触发 → 子会话无首轮 assistant 回复，`cap-fork-from-closed-turn` 未闭环 | 验证基建缺口（测试可达性） |
| DEBT-3 | `cap-message-store-stream-patch` #18 流式增量 150ms 轮询跨 run 波动，偶发捕获不到中间态 | 验证基建缺口（时序敏感） |
| DEBT-7 | 9 项 webview 内部 React 组件 host 侧无渲染探测通道，仅有 `panelOpen:true` 弱证据 | 验证基建缺口（可观测性） |
| DEBT-8 | `cap-history-panel` / `cap-message-list-streaming` 需模型往返才可观测，却标 `requiresModel:false` | 测试数据修正（manifest） |
| DEBT-9 | **产品 bug**：`selection-ask.ts:182` 防泄漏用裸子串 `includes(languageId)`，`package.json`(languageId=json) 被误判泄漏 | 产品代码 bug（改 `src/`） |
| DEBT-10 | subagent 两项用 `injectSubagent` 测试注入驱动，非真实模型委托，AC-9 不满足 | 验证基建缺口 + 测试数据修正 |
| DEBT-11 | `run-chat-ready-regression.sh` 引用 10 个已归并不存在的测试文件，被 4 处守卫引用 | 清理（删文件 + 改引用） |
| DEBT-12 | 全链入口缺 per-capability 状态隔离，idle 初始态断言失败 + readonly-live 污染 13 项 | 验证基建缺口 + 测试数据修正 |

**范围内的交付物类型：**

- 产品代码修复（`apps/vscode-dsh/src/`，仅 DEBT-9 及 DEBT-7 可能新增的测试专用探测 hook）；
- 验证基础设施（`apps/vscode-dsh/test-scripts/`：capability-runner / 全链入口 / 回归脚本）；
- 测试数据（`apps/vscode-dsh/test-scripts/layer-v-capabilities.json`）；
- 清理（删除过时脚本 + 更新 4 处守卫引用）。

## ⚠️ 与上游工作流的范围差异（关键声明）

上游工作流 `vscode-dsh-e2e-closure` 的 `design.md` 明确约定「不新增产品功能、不修改产品代码（`src/` / `webview/src/` 保持不动）」（见上游 `design.md:38` 及「架构摘要」）。**本工作流与该约定存在关键差异，必须显式声明**：

1. **DEBT-9 是产品代码 bug**，其根因在 `apps/vscode-dsh/src/code-context/selection-ask.ts:182` 的防泄漏检查，修复**必须**修改产品代码。上游 Phase 3 真机已取证确认这是真实产品缺陷（上游 `design.md` 设计修订记录 #5），当时因受「不改产品代码」范围约束而仅以「换探针文件」规避、登记为债务。**本工作流授权修改产品代码修复该 bug。**
2. **DEBT-7 可能需要新增「测试专用」的 host 侧探测 hook**（如 webview 内 `data-testid` + `panelSnapshot` 扩展渲染状态，或截图断言原语），这类 hook 若落在产品源码，必须**由 `VSCODE_DSH_TEST=1` 门控**（与既有 `dsh.test.*` 测试钩子一致，仅测试模式注册），不改变生产行为——这**不属于**「修改产品业务逻辑」。
3. 除此之外，本工作流**不引入**新的产品业务逻辑变更（含 agent-loop / 功能行为）。

> 此声明供 `reviewer-design` 对照：修复 DEBT-9 改 `src/`、修复 DEBT-7 新增门控测试 hook，均**属于本工作流授权范围**，不得判为越界。

## UI 相关性（存在界面时必填）

- **ui_relevant**: `false`
- **判定理由**：本工作流是**纯后端 + 验证基建 + 一个产品 bug 修复**。唯一的产品代码改动是 `selection-ask.ts` 的防泄漏判断逻辑（字符串/词边界判定），不新增、不修改任何 UI 视图文件（HTML / CSS / JSX / TSX），不改页面、路由、组件、样式、主题、布局、响应式、暗色模式、动效。DEBT-7 即便新增 webview 内 `data-testid`，也是**测试探测通道**（不影响视觉呈现），不改变界面「长什么样」。截图仍是**验证证据**，不是「被设计的界面」。
- **涉及页面数**：0
- **前端技术栈**：不适用

## 功能区域

### 功能区域 1：产品代码 bug 修复（DEBT-9）

修复 `selection-ask.ts` 的防泄漏检查误报。

### 功能区域 2：验证基建缺口（DEBT-2 / DEBT-3 / DEBT-7 / DEBT-10 / DEBT-12）

补测试可达性、流式增量可观测、webview 探测通道、真实模型委托、per-capability 状态隔离。

### 功能区域 3：测试数据修正（DEBT-8 / DEBT-10 / DEBT-12 的 manifest 部分）

修正 `layer-v-capabilities.json` 中 `requiresModel` 标记与步骤/断言语义不一致的项。

### 功能区域 4：过时脚本清理（DEBT-11）

清理 `run-chat-ready-regression.sh` 及其 4 处守卫引用。

### 功能区域 5：回归护栏（贯穿全部）

不破坏既有回归，修复后全链入口可靠。

## 验收标准（EARS 格式）

### 范围授权

- **AC-1**（普遍型）：系统 **必须** 将「修复产品代码 bug（DEBT-9）」与「为 webview 探测/测试可达性新增由 `VSCODE_DSH_TEST=1` 门控的测试专用 hook」视为本工作流授权范围内的合法改动，**不得** 判为越界；除此之外 **不得** 引入新的产品业务逻辑变更（含 agent-loop / 功能行为）。

### 功能区域 1：产品代码 bug 修复（DEBT-9）

- **AC-2**（不期望行为型）：**如果** 用户对「languageId 恰好是文件路径子串」的文件（如 `package.json` 的 languageId 为 `json`）发起选区提问，**那么** `runAskAboutSelection` 的防泄漏检查 **必须不** 将其误判为 languageId 泄漏；判定 **必须** 基于 languageId 是否作为**完整 token** 泄漏进 pointerText（按词边界 / `/` 分隔符判断），**而非** 裸子串 `includes(languageId)`。

- **AC-3**（事件驱动型）：**当** `cap-selection-ask` 以探针文件 `apps/vscode-dsh/package.json` 驱动时，`ask-about-selection` 步 **必须** 返回 `{ok:true, path:"apps/vscode-dsh/package.json"}`，**而非** `{ok:false, reason:"path-unrepresentable"}`；系统 **必须** 不再需要改用 `src/index.ts` 规避。

### 功能区域 2：验证基建缺口

- **AC-4**（DEBT-2，事件驱动型）：**当** `cap-fork-from-closed-turn` 的 `fork-retry` 步通过 `forkRetry({turn:1})` 派生 emptySeed 子会话时，系统 **必须** 使该子会话以 retry 提示词作为**首轮触发输入**完成一次真实模型往返（回显 marker），且 `child-replied` 步 **必须** 断言到子会话首轮 assistant 回复（`$assistantClosed:LAYER-V-CAP-33-OK`）；**不得** 因 shadow preset 自主编排自启动而致子会话无首轮 assistant 回复。

- **AC-5**（DEBT-3，状态驱动型）：**在** `cap-message-store-stream-patch`（#18）流式响应进行**期间**，系统 **必须** 能以稳定捕获中间态的方式（调整轮询粒度，或改用更稳健的分段指令）观测到流式增量，使 `streamed-message` 步的 `requireIncrement:true` 断言在完整 run 中稳定通过（`sawStreaming`/`sawGrowth` 为 true），**不再** 跨 run 波动。

- **AC-6**（DEBT-7，普遍型）：系统 **必须** 对 host 侧无渲染探测通道的 9 项 webview 内部组件（`cap-react-spa-root` / `cap-tab-chrome` / `cap-composer` / `cap-delete-confirm-modal` / `cap-chat-ui-store` / `cap-message-bridge` / `cap-editor-panel-viewtype` / `cap-react-spa-html-builder` / `cap-webview-html-injection`）做**二选一**处理——要么为其补充 host 侧渲染探测通道（webview 内 `data-testid` + `panelSnapshot` 扩展渲染状态，使 `concreteAssertion` 可判定）并真机闭环；要么如实登记为「未闭环」并保留在 registry（**不得** 作为 feature UI PASS 证据）。无论哪种，都 **不得** 仅以 `panelOpen:true` 弱证据记为验证通过。

- **AC-7**（DEBT-10，普遍型）：系统 **必须** 对 `cap-open-subagent-context` 与 `cap-pin-subagent-tab` 两项 subagent 能力做**二选一**处理——要么改用真实模型委托路径（父会话 `sendPrompt` 触发 Task 工具委托子 Agent → 断言子会话 assistant 回复）验证闭环；要么将两项 `requiresModel` 置为 false 并相应收窄 AC-9 适用范围。无论哪种，都 **不得** 以 `injectSubagent` 测试注入作为真实模型往返的等价闭环证据。

- **AC-8**（DEBT-12，状态驱动型）：**在** `run-vscode-dsh-e2e-closure.sh` 全链串行运行**期间**，系统 **必须** 在 capability 之间做状态隔离，使 `cap-extension-activate` 与 `cap-test-hooks` 的 idle 初始态断言 **不** 因前序 webview/panel 能力把 orchestrator 推进 `started` 而失败；且 `cap-open-subagent-context` 的 `openSubagent` 切换到 `readonly-live` 子 context 后 **必须** 复位，使后续能力 **不再** 返回 `{ok:false, reason:"readonly-live"}`。

- **AC-9**（DEBT-12，普遍型）：系统 **必须** 使 `run-vscode-dsh-e2e-closure.sh` 成为可靠的一键验证入口——串行跑完 41 项后，exit code 反映真实结论，**不得** 因串行状态污染而整体 exit 1。

### 功能区域 3：测试数据修正

- **AC-10**（DEBT-8，事件驱动型）：**当** `cap-history-panel` 与 `cap-message-list-streaming` 被驱动时，系统 **必须** 通过真实模型往返获得可断言结果（`cap-history-panel` 用 `sendPrompt`→`listHistory` 断言 `firstUserPreview`；`cap-message-list-streaming` 用 `$assistantContains` 流式断言），且这两项 manifest 的 `requiresModel` 字段 **必须** 与实际驱动方式一致（需模型往返则置为 true）；**不得** 在 `requiresModel:false` 且无模型往返的情况下声称闭环。

### 功能区域 4：过时脚本清理

- **AC-11**（DEBT-11，普遍型）：系统 **必须** 清理过时的 `run-chat-ready-regression.sh`，使其 **不再** 引用 10 个已被归并为 `cap-*.spec.ts` 的不存在测试文件，并同步更新其 4 处守卫引用（`cap-test-harness.spec.ts` 的 CAP-TEST-HARNESS-083 existsSync 断言、`scripts/check-test-scripts-syntax.sh` pinned、`tests/capability-domains.json`、`apps/vscode-dsh/README.md` 及 `README.zh.md`），使守卫 **不再** 依赖已不存在的文件；清理后既有回归 **必须** 保持通过。

### 功能区域 5：回归护栏

- **AC-12**（普遍型）：系统 **必须不** 破坏既有回归——`pnpm exec vitest run apps/vscode-dsh/tests` 与既有真机冒烟/回归脚本在交付后 **必须** 保持全部通过。

- **AC-13**（不期望行为型）：**如果** 某项债务的修复需要新增测试钩子/探测通道而无法在本工作流内完成，**那么** 系统 **必须** 如实登记为新的（或保留的）债务并说明缺口原因，**不得** 通过放宽断言、反复重试、删除 manifest 项或改探针文件规避的方式使验证「通过」。

## 不在范围内（明确排除）

- ❌ 不新增产品功能、不修改产品业务逻辑（含 agent-loop）；唯一的 `src/` 改动是 DEBT-9 的防泄漏判断修复，以及 DEBT-7 可能新增的 `VSCODE_DSH_TEST=1` 门控测试 hook。
- ❌ 不做 L2/L3 协议层单元测试（由 `vscode-dsh-test-consolidation` 归并的 `cap-*.spec.ts` 负责）。
- ❌ 不重新设计 41 项能力清单（清单以 `layer-v-capabilities.json` 现状为准，只修正与债务相关的项）。
- ❌ 不新增/修改任何 UI 视图文件、页面、组件、样式、主题、布局、响应式（`ui_relevant: false`）。
- ❌ 不修改退出码契约（0=PASS / 1=LINK_FAILURE / 2=SKIPPED_NO_DISPLAY / 3=SKIPPED_NO_CREDENTIALS / 4=HARNESS_ERROR）。
- ❌ 不重做 `assessClosedLoop` / `classifyAssertionStrength` 的既有语义（除非某条债务的修复确需调整，且调整后有 fixture 锁定）。

## 约束

- **宪法 §1.2 / §1.3**：每个 Phase 至少 1 个集成测试 + 至少 1 个端到端验证场景；本工作流以真机（层 V）为主。
- **诚实登记**：延续上游 AC-14/AC-15 原则——修复失败/无法完成必须如实登记，不得重试取巧、放宽断言、改探针规避。
- **真实 LLM 强制**：涉及模型往返的债务（DEBT-2/3/8/10）验证必须使用真实 `DEEPSEEK_API_KEY`；注入/模拟不作为等价验收。
- **测试 hook 门控**：DEBT-7 若新增 host 侧探测 hook 落在产品源码，必须 `VSCODE_DSH_TEST=1` 门控，不改变生产行为。
- **文件归属**：验证基建改动落 `apps/vscode-dsh/test-scripts/`；不得把 phase 临时验证脚本写入 `apps/vscode-dsh/tests/`。

## 开放问题

无。以下决策点均已在上游 registry 的「预期行为」字段给出二选一/判定依据，本工作流沿用：

- DEBT-7 二选一（补探测通道 vs 保留未闭环）→ AC-6
- DEBT-10 二选一（真实委托 vs `requiresModel:false` 收窄 AC-9）→ AC-7
- DEBT-3 修法（调轮询粒度 vs 换分段指令）→ AC-5（实现方式交由 plan-generator 定，验收以「稳定捕获增量」为准）

## 风险/假设

- **假设 A1**：Xvfb + `code` CLI + 真实 `DEEPSEEK_API_KEY` 已就绪，可直接复用 `run-layer-v-smoke.sh` / `run-vscode-dsh-e2e-closure.sh` 基座。
- **假设 A2**：`selection-ask.ts:182` 的防泄漏检查是唯一误报点，修复后可完整闭环，无需改动 selection body 拼装逻辑（若真机发现更多误报，按 AC-13 如实登记）。

- **风险 R1（DEBT-2 修复面较大）**：fork emptySeed 自启动涉及 sdk-server 分叉语义与测试环境 shadow preset 配置，修复可能需要在「测试环境禁用自主编排 preset」与「调整 fork retry 触发时序」之间取舍；若无法在本工作流内达成，按 AC-13 如实登记。
- **风险 R2（DEBT-3 时序抖动）**：流式响应节奏受模型生成速度影响，调大轮询粒度可能引入新波动；需在真机上以「稳定捕获增量」为准，不追求固定间隔值。
- **风险 R3（DEBT-7 探测通道侵入）**：为 webview 内部组件补 `data-testid` 需触碰 `webview/src/` 组件源码，若判定侵入过大，选择「保留未闭环」分支（AC-6 已允许）。
- **风险 R4（DEBT-12 状态隔离覆盖面）**：串行状态污染可能不止 registry 已列的两类，修复后需以全链一键跑通为准。

## 债务验收独立性与依赖关系（供 plan-generator 拆分 DAG）

| DEBT | 可独立验收 | 依赖关系 | 建议 |
|------|:--:|---------|------|
| DEBT-2 | ✅ 独立 | 无（真机带 key 单独驱动 `cap-fork-from-closed-turn`） | 单 Phase，真机 |
| DEBT-3 | ✅ 独立 | 无 | 单 Phase，真机 |
| DEBT-7 | ✅ 独立 | 无（二选一，均可独立判定） | 单 Phase，静态 + 真机 |
| DEBT-8 | ✅ 独立 | 无（仅改 manifest + 真机带 key） | 单 Phase，真机 |
| DEBT-9 | ✅ 独立 | 无（唯一纯 `src/` 改动） | 单 Phase，静态 + 真机 |
| DEBT-10 | ✅ 独立 | 无 | 单 Phase，真机 |
| DEBT-11 | ✅ 独立 | 无（清理 + 改守卫，跑回归护栏） | 单 Phase，静态 + 回归 |
| DEBT-12 | ⚠️ 依赖 manifest 稳定 | 与 DEBT-7/8/10 同改 `layer-v-capabilities.json`，存在文件冲突面；其「全链一键跑通」验收依赖其余 manifest 相关债务已落定 | **放最后**，依赖 DEBT-7/8/10 |

- 无逻辑依赖的债务（DEBT-2/3/7/8/9/10/11）彼此可并行；但 DEBT-7/8/10 与 DEBT-12 共享 `layer-v-capabilities.json` 文件，需避免并行写冲突（plan-generator 需在 DAG 中显式串行化 manifest 写入，或按分组隔离）。
- DEBT-9 是唯一纯 `src/` 改动，与其他债务无文件冲突，可最先或并行处理。

## 建议的 Phase 拆分方向

> 仅供 plan-generator 参考，非权威拆分。按「改动确定性 + 是否需真机」两分，收敛为 2 个 Phase。

1. **Phase 1 — 确定性修复（DEBT-9 / DEBT-8 / DEBT-11）**：产品 bug 修复（`selection-ask.ts` 防泄漏词边界判定）+ manifest `requiresModel` 修正 + 过时脚本清理（删脚本 + 改 4 处守卫）。共同点：改动面清晰、可静态/单测直接验证；DEBT-9 仅需一个 `package.json` 探针的真机闭环（轻量）。
2. **Phase 2 — 真机基建缺口（DEBT-2 / DEBT-3 / DEBT-7 / DEBT-10 / DEBT-12）**：测试可达性 / 流式增量可观测 / webview 探测通道 / 真实模型委托 / per-capability 状态隔离。共同点：均需真实 LLM 往返 + 真机，改动面较大；DEBT-12 依赖 manifest 落定，放 Phase 2 最后（正好 Phase 1 已改完 manifest）。
