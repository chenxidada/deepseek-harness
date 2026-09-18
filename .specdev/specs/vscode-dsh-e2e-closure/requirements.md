# 需求文档 — vscode-dsh 完整能力链真机端到端闭环验证

> 工作流 slug：`vscode-dsh-e2e-closure`
> 本文件由 requirement-analyst 产出，是所有下游工作（plan-generator / implementer / reviewer / verifier）的验收契约基础。

## 产品目标

为 vscode-dsh 的**完整能力链**建立**真机端到端闭环验证**，复用 usable-loop 已建立的层 V 真机冒烟闭环（Xvfb + `code` CLI + 截图），补齐此前因「无真机 Extension Development Host（EDH）」而停在 PARTIAL / BLOCKED 的能力链功能，使**当前代码真实实现的每一项功能能力**都有一份可追溯的真机证据；同时清除遗留的 mock 与过时用例/验证产物，并处理审计遗留偏差。

## 问题陈述

六个能力链工作流（ide / conversation-ui / chat-ready / code-context-diff / chat-ux / editor-chat-panel）各自完成了产品功能实现，但存在三类问题：

1. **部分能力链功能从未在真机 EDH 中端到端跑通**：`vscode-dsh-editor-chat-panel` 两个 Phase 的 verifier 判决均为 PARTIAL，根因是「层 V 真机视觉验证从未执行」（当时 `BLOCKED_NO_HOST`：无 `code`/`cursor` CLI、无 DISPLAY）；usable-loop 已建立的层 V 冒烟闭环（`run-layer-v-smoke.sh` + `layer-v-driver/extension.cjs`）只覆盖 usable-loop 自己的功能（Node 环境预检、fail-loud 诊断），未覆盖能力链的产品功能。
2. **历史 spec 与当前代码已漂移**：六个 feature 文档声明的功能中，很多已被后续工作流推翻或成为历史遗留（例如 conversation-ui 的 thin HTML 面板已被 editor-chat-panel 的 React SPA 取代、呈现层换过两轮；审计报告明确指出 thin HTML 已自我声明 fixture-only、非生产路径）。若按六个 feature 文档的历史声明设计闭环覆盖，会为已废弃路径建立无意义的验证。
3. **审计遗留偏差**：`apps/vscode-dsh/lib/` 的 19 个陈旧 hash chunk（约 8MB）会被打进 .vsix；`vendor/cordis/src/fiber.ts:147` 的 `const enum FiberState` 债从未登记进 `tech-debt-registry.md`（registry 当前为空）。

## 目标终态

1. 当前代码**真实实现**的每一项功能能力（由 workflow 级 code-explorer 调研产出清单），都有**真机 EDH 操作序列 + 截图 + 断言**证据，且断言可独立判定 ✅ / ❌。
2. `vscode-dsh-editor-chat-panel` 的「层 V 真机视觉验证从未执行」根因被消除（有截图证据 + 视觉断言）。
3. 审计遗留偏差 5（lib 陈旧 chunk）与偏差 6（FiberState 债）被**实际修复**（而非仅登记）。
4. 遗留的 mock 测试用例、过时用例、过时验证产物被清除，工作区不残留「已废弃生产路径对应的 mock/测试/验证产物」。
5. 全链路回归保持全绿（`vitest run apps/vscode-dsh/tests` 与 `run-chat-ready-regression.sh` 不被破坏）。

## 目标用户

- **vscode-dsh 维护者 / 贡献者**：需要一份可重复运行的真机闭环，判断当前代码真实实现的能力是否在真机 Extension Development Host 中真正可用，而非只在协议层/单元层通过。
- **发布/验收流程**：发布前需要真机证据，替代「DOM 存在 / HTTP 200」这类弱证据。

## 核心场景

1. **S-1 全链闭环**：维护者运行一条真机闭环命令，按「当前代码真实功能能力清单」逐一在真机 EDH 中被驱动、截图、断言，产出一份机器可读的状态记录 + 截图证据，可直接判断哪些能力真机可用。
2. **S-2 能力单项复验**：维护者只想复验某一项能力（如 editor-chat-panel 的 React SPA 主呈现路径），运行对应闭环子集，获得截图 + 断言，无需跑全量。
3. **S-3 偏差与清理闭环**：维护者确认 lib 陈旧 chunk 不再进入 .vsix、FiberState 债已修复、registry 不再为空，且废弃路径对应的 mock/测试/验证产物已被清除。

## 预期范围

**范围内**（三条已由用户拍板的决策，不偏离）：

1. **覆盖范围**：完整能力链 —— `vscode-dsh-ide`、`vscode-dsh-conversation-ui`、`vscode-dsh-chat-ready`、`vscode-dsh-code-context-diff`、`vscode-dsh-chat-ux`、`vscode-dsh-editor-chat-panel` 六个工作流。**但覆盖清单以当前代码真实实现为准，由 workflow 级 code-explorer 调研产出，六个 feature 文档的功能列表仅作候选参考。**
2. **代码形态**：以**层 V 真机驱动**为主（EDH 操作序列 + 截图 + 断言），不是 L2/L3 协议层测试。
3. **流程**：新 feature 工作流（spec 驱动），遵循 Human Gate / Phase DAG / 四视角审查。

**范围内的交付物类型**：

- 层 V 真机驱动代码（EDH 操作序列脚本 + 截图 + 断言，CJS 驱动扩展或等价的真机驱动形态）。
- 闭环编排脚本（复用/扩展 `run-layer-v-smoke.sh` 的显示解析、Node 解析、沙箱 HOME、凭证门控、进程回收基座）。
- 审计遗留偏差 4/5/6 的实际处理（见验收标准 AC-11 ~ AC-13）。
- mock 与过时用例/验证产物的清除（见验收标准 AC-14 ~ AC-16）。

## UI 相关性（存在界面时必填）

- **ui_relevant**: `false`
- **判定理由**：本工作流是**验证基础设施**工作流，交付物是层 V 真机驱动脚本 / 截图断言 / 闭环编排（bash 脚本 + CJS 驱动扩展 + 断言），**不新增、不修改任何产品 UI 视图文件**（HTML / CSS / JSX / TSX / Vue / Svelte / SwiftUI / Compose），不新增/修改任何页面、路由、组件、样式、主题、布局、响应式、暗色模式、动效。命中的「界面 / 截图」信号全部属于**验证对象**（产品 UI 的视觉呈现作为证据被截图捕获），而非**被设计的界面**——界面「长什么样」已在各工作流各自的 spec 中定义并冻结，本工作流不重新设计。判定依据落入「纯后端 / CI 配置 / 测试基础设施」类，因此不启用视觉信息链（HG-1.5 / 原型确认 / reviewer-visual / 视觉验证门禁）。
- **涉及页面数**：0（新增页面）；验证对象涉及当前产品界面（仅作截图证据，不作设计）。
- **前端技术栈**：不适用（无视图层交付物）。

> 说明：截图在本工作流中是**验证证据**（由 verifier 的断言判定「真机是否跑通」），不是「被设计的界面」。视觉验证由 AC 中的「截图 + 断言」覆盖，不经过 design-system / HG-1.5 / 原型确认链路——后者是为「正在构建 UI」的工作流服务的，本工作流不构建 UI。

## 功能区域

### 功能区域 1：层 V 真机闭环基础设施（复用 + 扩展）

复用 usable-loop 已建立的层 V 冒烟闭环基座，扩展其覆盖面到当前代码真实实现的能力，而不是从零重建显示解析 / Node 解析 / 沙箱 HOME / 凭证门控 / 进程回收逻辑。

### 功能区域 2：当前代码真实功能能力真机覆盖（code-explorer 驱动）

由 workflow 级 code-explorer 调研当前代码，产出「真实功能能力清单」，据此建立真机 EDH 操作序列 + 截图 + 断言。六个 feature 文档的功能列表降级为候选参考，不作为覆盖依据。

### 功能区域 3：审计遗留偏差处理

实际处理偏差 4（editor-chat-panel 层 V 真机视觉验证从未执行）、偏差 5（lib 陈旧 chunk 打进 .vsix）、偏差 6（FiberState 债未登记且未修复）。

### 功能区域 4：清除 mock 与过时用例/验证产物

清除已废弃生产路径对应的 mock 测试用例、过时测试用例、过时验证产物（清单由 code-explorer 调研产出，不得盲删）。

### 功能区域 5：闭环编排与证据产出

闭环运行后产出机器可读状态记录 + 截图 + journal + summary，并追加 artifact-index 行；退出码契约与既有层 V 语义一致。

## 验收标准（EARS 格式）

### 功能区域 1：层 V 真机闭环基础设施

- **AC-1**（普遍型）：系统 **必须** 复用 `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh` 已建立的层 V 真机冒烟闭环能力（Xvfb 显示解析、Node 引擎解析、沙箱 HOME、凭证门控、`--extensionDevelopmentPath` 启动真机 EDH、层 V 驱动扩展、进程回收），**不得** 从零重建同等的显示/Node/沙箱/凭证/进程逻辑。

- **AC-2**（普遍型）：系统 **必须** 在闭环运行的目标环境无 X 显示但存在 Xvfb 时自动拉起 Xvfb 完成真机运行，在既无显示又无 Xvfb 时以 `SKIPPED_NO_DISPLAY`（exit code 2）退出，且 **不得** 把「无显示导致无法运行」记为「验证通过」。

- **AC-3**（状态驱动型）：**在** 一次闭环运行**期间**，层 V 驱动 **必须** 将每一步操作序列与断言结果以机器可读 JSONL 形式**逐步追加**写入 journal（`apps/vscode-dsh/test-artifacts/layer-v/` 下），使得中途崩溃的运行仍能按步骤名定位失败点。

- **AC-4**（普遍型）：系统 **必须** 为每个被验证的功能能力产出至少 1 张真实桌面截图（PNG）作为证据；同一功能在复用显示上重复捕获的多张截图 **必须不** 全部共享同一 md5（防止复用显示导致的退化证据）。

- **AC-5**（普遍型）：系统 **必须** 遵循既有层 V 退出码/结论契约——`0`=PASS、`1`=LINK_FAILURE、`2`=SKIPPED_NO_DISPLAY、`3`=SKIPPED_NO_CREDENTIALS、`4`=HARNESS_ERROR，且结论**不得**被合并、降级或在证据不足时猜测。

### 功能区域 2：当前代码真实功能能力真机覆盖（code-explorer 驱动）

- **AC-6**（普遍型）：系统 **必须** 在设计阶段前委托 workflow 级 code-explorer 对当前代码（`apps/vscode-dsh/src/**`、`webview/src/**`、React SPA 主呈现路径等）进行调研，产出一份「真实功能能力清单」，清单中每一项 **必须** 附代码位置证据（`路径:行号`）；该清单是闭环功能覆盖的**唯一依据**，**不得** 引用六个 feature 文档中已被废弃/推翻的历史功能声明作为覆盖依据。

- **AC-7**（普遍型）：系统 **必须** 对「真实功能能力清单」中的每一项能力，在真机 EDH 中执行操作序列并产出截图 + 断言；覆盖范围 **必须** 至少包含当前 React SPA 主呈现路径（编辑器区单例 Panel、顶栏多 Tab、历史窗口）与当前会话/聊天主链路（建连、就绪、消息往返、流式呈现），**不得** 覆盖已废弃的 thin HTML 面板路径。

- **AC-8**（不期望行为型）：**如果** 某项功能被 code-explorer 调研确认已废弃、已被后续工作流推翻或被替代（例如 conversation-ui 的 thin HTML 面板已被 editor-chat-panel 的 React SPA 取代、thin HTML 已自我声明 fixture-only 非生产路径），**那么** 系统 **必须不** 为其建立真机闭环覆盖，且 **必须** 将其列入「过时功能清单」供后续清理。

- **AC-9**（普遍型，真实 LLM 强制）：系统 **必须** 在涉及聊天、流式、Continue、分叉等「模型往返」的功能验证中，使用真实 `DEEPSEEK_API_KEY` 完成真实 LLM 往返；**不得** 以注入/模拟（如 `dsh.test.answerApproval`、session 回放）作为这些功能闭环验证的等价验收。无 key 环境仍以 `SKIPPED_NO_CREDENTIALS`（exit code 3）fail-closed，**不得** 把无 key 记为验证通过。

- **AC-10**（普遍型）：系统 **必须** 为「真实功能能力清单」中的每一项能力产出至少 1 条可独立判定的端到端断言（读到的判定者能明确给出 ✅ 或 ❌），每条断言 **必须** 验证完整数据路径（操作 → 产品响应 → 截图/日志证据），**不得** 仅以「DOM 结构存在 / HTTP 200」代替行为断言。

### 功能区域 3：审计遗留偏差处理

- **AC-11**（状态驱动型，偏差 4）：**在** 本工作流结束**期间**，系统 **必须** 对 `vscode-dsh-editor-chat-panel` 的两个 Phase 产出层 V 真机视觉验证证据（截图 + 视觉断言），使「层 V 真机视觉验证从未执行」这一 PARTIAL 根因被消除；对该工作流缺失的 `review-visual.md` / `ui-spec.md` / `visual-baseline.md` 三文件的处理方式（补齐或在偏差记录中显式声明「本工作流为验证基础设施、不产出产品 UI 视觉基线」），**必须** 在 `implementation.md` 偏差章节显式说明。

- **AC-12**（普遍型，偏差 5，实际修复）：系统 **必须** 清理 `apps/vscode-dsh/lib/` 中 19 个陈旧 hash chunk（约 8MB），并调整 `package.json` 的 `files` 字段，使得 `.vsix` 打包产物**不再**包含陈旧 chunk。

- **AC-13**（普遍型，偏差 6，实际修复）：系统 **必须** 将 `vendor/cordis/src/fiber.ts:147` 的 `const enum FiberState` 导致的「多个包 vitest source-plane 无法运行」债务，登记进 `.specdev/specs/vscode-dsh-e2e-closure/tech-debt-registry.md`（当前为空），并**实施修复**——将 `const enum FiberState` 改为普通 `enum`（或等效修复），使受影响包（sdk/server、specdev、specdev-gate 等）的 vitest source-plane 可运行；若修改 `vendor/cordis/` 源码，**必须** 遵循 `vendor/README.md` 同步策略与本地修改记录流程。

### 功能区域 4：清除 mock 与过时用例/验证产物

- **AC-14**（普遍型）：系统 **必须** 由 workflow 级 code-explorer 调研产出一份「待清除的 mock/过时测试/过时验证产物清单」，清单中每一项 **必须** 附路径与「为何过时 / 被什么替代」的判定依据，**不得** 盲删。

- **AC-15**（普遍型）：系统 **必须** 清除清单中已确认不再被生产路径使用的 mock 测试用例（如 `apps/vscode-dsh/tests/fixtures/` 中不再被生产路径使用的 mock、thin HTML 旧面板的 fixture-only 测试等）。

- **AC-16**（状态驱动型）：**在** 交付完成**期间**，工作区 **不得** 残留「已废弃生产路径对应的 mock/测试/验证产物」（含 `.specdev/specs/*/phases/*/test-scripts/` 下已被取代的旧验证脚本、旧截图、旧 PARTIAL 验证报告等）；清除动作 **必须** 在 `implementation.md` 中留痕（列出被清除项清单）。

### 功能区域 5：闭环编排与证据产出

- **AC-17**（普遍型）：系统 **必须** 在闭环运行完成后产出机器可读的运行状态记录（含「真实功能能力清单」中每项能力的结论、证据路径、失败步骤）+ 截图 + journal + run-summary，并追加一行到 artifact-index（沿用 `run-layer-v-smoke.sh` 的 `artifact-index.md` 机制）。

- **AC-18**（不期望行为型）：**如果** 闭环运行中清单中任一能力的断言失败，**那么** 系统 **必须** 以非 0 退出码退出并在状态记录中标注该失败步骤与原因，**不得** 静默放行或以「skip」掩盖真实失败。

- **AC-19**（普遍型）：系统 **必须不** 破坏既有回归——交付完成后 `vitest run apps/vscode-dsh/tests`（59 files / 523 passed + 1 skipped）与 `run-chat-ready-regression.sh`（ALL OK，96 + 57 tests）**必须** 保持全绿。

## 不在范围内（明确排除）

- ❌ 不新增任何产品 UI 页面/组件/样式/主题/布局（产品 UI 已在各工作流中实现并冻结）。
- ❌ 不新增产品功能、不修改产品业务逻辑（含 agent-loop）。
- ❌ 不做 L2/L3 协议层测试（用户已拍板：以层 V 真机驱动为主）。
- ❌ 不修改六个能力链工作流各自的 spec 语义（本工作流只产出验证驱动与清理，不改它们的 AC）。
- ❌ **不基于六个 feature 文档的历史声明设计覆盖清单**——覆盖清单必须由 workflow 级 code-explorer 对当前代码的调研结果驱动。
- ❌ 不做 UI 视觉美化 / 深色模式 / 无障碍升级（本工作流 ui_relevant: false）。
- ❌ 不为六工作流补写各自的 `ui-spec.md` / `visual-baseline.md`（本工作流自身无 UI 交付物）。
- ❌ 不做真机闭环在 Windows 平台的适配（Xvfb + `code` CLI 为 Linux/macOS 形态；Windows 由既有 CI 信号覆盖）。
- ❌ 不在无 code-explorer 调研清单的情况下盲删任何 mock/测试/验证产物。

## 约束

- **宪法 §1.2 / §1.3**：每个 Phase 至少 1 个集成测试 + 至少 1 个端到端验证场景；本工作流本身以端到端（真机）为主。
- **宪法 §1.1**：任何推迟项必须 `@STUB` 标记并登记 `tech-debt-registry.md`；偏差 6 的债登记受 `pipeline-gate.sh` 的 `hg3=passed` 门禁程序化强制。
- **复用优先**：显示解析 / Node 解析 / 沙箱 HOME / 凭证门控 / 进程回收逻辑复用 `run-layer-v-smoke.sh`，不重写。
- **真机证据强制**：截图必须是真实桌面截图（Xvfb 上真实捕获），不得用图片注入 / 回放合成来伪造视觉证据。
- **覆盖清单以当前代码为准**：闭环功能覆盖清单必须由 workflow 级 code-explorer 对当前代码（`apps/vscode-dsh/src/**`、`webview/src/**`、React SPA 主呈现路径）的调研结果驱动，不得引用已废弃的 thin HTML / 已推翻的历史 spec。
- **真实 LLM 强制**：涉及模型往返的功能验证必须使用真实 `DEEPSEEK_API_KEY`（本工作流运行环境 key 已提供）；注入/模拟仅可作为辅助手段，不得作为等价验收。
- **vendor 策略**：偏差 6 修改 `vendor/cordis/` 源码时，必须遵循 `vendor/README.md` 的 vendoring 同步策略与本地修改记录流程。

## 开放问题（已答复，均已落入对应 AC）

- **Q-1（覆盖深度）— 已答复**：闭环覆盖必须基于「当前代码真实实现」，不得基于六个 feature 文档的历史声明。→ 已落入 AC-6 ~ AC-8（code-explorer 驱动清单 + 废弃功能不覆盖 + 过时功能清单），并新增功能区域 4（AC-14 ~ AC-16）用于清除 mock/过时用例/过时验证产物。

- **Q-2（真实 LLM 往返）— 已答复**：必须真实 LLM，key 已提供。→ 已落入 AC-9（真实 `DEEPSEEK_API_KEY` 往返强制，删除注入/模拟等价验收表述，保留 `SKIPPED_NO_CREDENTIALS` fail-closed 语义）。

- **Q-3（偏差 5/6 交付归属）— 已答复**：都实际修复。→ 已落入 AC-12（偏差 5 清理 chunk + 调整 files 字段）、AC-13（偏差 6 登记 + 将 `const enum` 改为普通 `enum` 等效修复）。

## 风险/假设

- **假设 A1**：Xvfb + `code` CLI 已就绪（usable-loop 验证过），本工作流可直接复用，无需重新调研显示/Node 解析。
- **假设 A2**：六工作流产品代码已实现，本工作流只新增验证驱动代码与清理，不修改产品功能代码（偏差 6 的 `vendor/` 源码修复除外）。
- **假设 A3**：`run-layer-v-smoke.sh`（约 149KB）是可用基座，本工作流在其上扩展覆盖面（新增驱动/编排），而非重写。

- **风险 R1（运行时长）**：层 V 真机运行单次耗时可能达 25 分钟（`DRIVER_WAIT_MS=1500000`），全量闭环耗时长，需在 Phase 拆分时考虑分批/并行。
- **风险 R2（截图断言易抖动）**：真机截图受窗口尺寸、字体渲染、X 显示差异影响，逐像素比对易误报；断言应以「关键区域存在 + 元素非退化」为主，避免逐像素比对。
- **风险 R3（vendor 改动面）**：偏差 6 修改 `vendor/cordis/` 源码可能影响 sdk/server、specdev、specdev-gate 等多个包的 source-plane 运行，需谨慎并遵循 vendor 同步策略。
- **风险 R4（清理误删）**：清除 mock/过时用例/过时验证产物必须先由 code-explorer 摸清清单，避免盲删导致仍在生产路径使用的测试/夹具被误删、进而破坏既有回归；删除动作须在 implementation 留痕以便追溯。

## 建议的 Phase 拆分方向

> 仅供 plan-generator 参考，非权威拆分。

1. **代码调研 + 真实功能能力清单**：workflow 级 code-explorer 调研当前代码，产出「真实功能能力清单」+「过时功能清单」+「待清除 mock/测试/验证产物清单」，作为后续所有覆盖与清理的依据（与 workflow 级 repo-exploration 合并或紧随其后）。
2. **闭环基座 + 单能力打样**：复用 `run-layer-v-smoke.sh` 基座，建立「多能力真机驱动编排」框架，先用当前 React SPA 主呈现路径（editor-chat-panel）打样出「操作序列 + 截图 + 断言」范式。
3. **逐能力真机驱动**：按打样范式，为清单中其余真实能力补齐真机驱动 + 断言（无依赖关系的能力可并行）。
4. **审计遗留偏差处理**：偏差 5（lib 陈旧 chunk）与偏差 6（FiberState 债）各拆 Phase，均实际修复。
5. **mock/过时产物清除**：按调研清单清除 mock 测试、过时用例、过时验证产物，并在 implementation 留痕。
6. **全链编排 + 回归护栏**：一条命令串起全链闭环，产出统一状态记录与 artifact-index，并跑既有回归护栏。
