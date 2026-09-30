# Agent Note: SpecDev 视觉链 — `ui` 声明、HG-1.5、原型门禁与视觉评审者

Status: implemented

[English](2026-09-30-specdev-visual-chain.md) | 中文

## 问题

SpecDev 工作流此前把每个 Phase 都当作无界面工作：HG-1 冻结需求，HG-2 冻结设计，随后一个 Phase 依次跑实现者、评审者与验证者。计划里没有任何地方能说明某个 Phase 构建的是用户可见的界面，因此也没有任何东西能要求 UI 工作所需的产物——设计前获批的视觉基准、评审前确认的原型，以及对照冻结 token 的界面评审。Cursor 时代的工作流恰恰带着这些义务（`ui-spec.md`、`visual-baseline.md`、`review-visual.md`，以及 Phase 上的 `ui: true` 标记），而它们在运行时里都没有归宿。

没有声明，运行时无法区分 UI Phase 与后端 Phase，任何强制都只能是猜测。桥接层同样缺少这类门禁的词汇：`BridgeSpecdevGateId` 只知道三个 Human Gate 与一个阶段入口门禁，`BridgeSpecdevSnapshot.steps` 只携带实现者 / 评审者 / 验证者。

## 决定

### 阶段计划声明 UI 工作

`phase-plan.md` 的 DAG 节点携带可选的 `ui: boolean`，计划是这一事实的唯一归宿。`phaseUiDeclarations` 读取逐阶段声明，`uiWorkflowOf` 回答是否存在声明 `ui: true` 的 Phase；尚无计划的 workflow 读作没有 Phase（也就没有 UI），而存在却无法解析的计划读作 `'unknown'`。该声明以 `SpecdevSnapshot.ui`（schema v3）到达消费方，也以桥接快照的 `ui` 字段到达 IDE。

### HG-1.5 冻结视觉基准

`confirmGate({ gate: 'hg1_5' })` 仅在 HG-1 已通过、计划声明了 UI Phase、且 `visual-baseline.md` 非空时通过。它只记录门禁、不推进阶段，用户选定的候选方案由工作流日志的决定备注保留。在声明了 UI Phase 的 workflow 中，HG-2 还要求 HG-1.5 通过；没有 UI Phase 的 workflow 从不会遇到该门禁（`SPECDEV_GATE_NOT_APPLICABLE`；计划不可读时同样如此，因为该门禁无法被判定）。

### 原型门禁确认 UI Phase 的静态原型

`confirmGate({ gate: 'prototype' })` 是逐阶段门禁：它作用于当前 Phase，要求该 Phase 声明 `ui: true`，并要求该 Phase 的 `implementation.md` 含 `## Prototype` 段。`pass` 在同一次转移里写入 `phases[<phase>].prototype = 'passed'`；`reject`、`defer`、`cancel` 是被记录的决定，保持 pending；其他决定一律拒绝。该状态是持久的工作流状态而非标记文件：工作流日志的 `workflow/state` 行携带它，`readPhases` 会折叠回来。

### 守卫按视觉链拒绝派发

`dsh-specdev-guard` 扩展了角色派发：在声明 `ui: true` 且原型尚未确认的 Phase 中，实现者、reviewer\* 与验证者被拒绝；守卫的 UI 门禁把这三种角色一直挡到确认。声明为 `'unknown'` 的 Phase——没有投影、没有当前 Phase，或计划未描述该 Phase——按 `SPECDEV_UI_UNKNOWN` 拒绝，而不是假定无界面。计划未把该 Phase 声明为 UI 时，`reviewer-visual` 按 `SPECDEV_UI_NOT_DECLARED` 拒绝，因此视觉角色只在有东西可审时运行。

### 视觉评审者是一个角色，合并也知道它

`reviewer-visual` 加入 `SPECDEV_ROLES`，并带有随包预设（`specdev-reviewer-visual`）、派发提示词与推进指引。当 Phase 的计划声明 `ui: true` 时，`mergePhaseReviews` 把 `review-visual.md` 作为第四个视角合并，视觉裁决遵循同样的 MUST-FIX / SHOULD-FIX / PASS 规则。验证者被要求独立于视觉评审者的报告、对照 `visual-baseline.md` 验证 UI Phase。

## 考虑过的替代方案

**`.prototype-approved` 标记文件。** Cursor 工作流用它，在这里只需三行。已否决：持久的工作流状态属于工作流日志——它可重放、有哈希链、进入投影；Phase 目录里的游离文件无法重放、过不了手改检测，还会给门禁制造第二个可能静默偏离的来源。

**由 `ui-spec.md` 是否存在推导 `ui`。** 无需改动 schema。已否决：工作流级文件无法说明是*哪些* Phase 构建界面；一个在前端 Phase 之外还包含后端 Phase 的 workflow 会把每个 Phase 都送进原型门禁。

**每个 Phase 都跑 `reviewer-visual` 并接受 `N/A` 裁决。** 评审者名册保持统一。已否决：它为没有东西可审的 Phase 花费子 Agent，并让合并依赖一个裁决为「非答案」的文件。

**把未知声明当作「非 UI」。** 最简单，也从不阻塞工作。已否决：它恰好在计划损坏时失败开放——计划不可解析的 UI Phase 会静默跳过它的基准、原型与视觉评审。

**让视觉链可按部署配置。** 有些团队不想要视觉门禁。已否决：该链是产品的 UI 工作流契约——角色提示词、产物名与计划 schema 都是照着它写的——配置面会让二者漂移。不交付 UI 工作的 workflow 不声明任何 `ui: true` Phase，也就完全不会碰到该链。

## 后果

`SpecdevSnapshot` 以 schema v3 引入这些字段：`gates.hg1_5`、`steps[].prototype` 与 `ui` 为必填，投影对 wire 视图严格解析，缺少这些字段的载荷会让 fold 失败并记录失败，而不是降级接受。桥接校验器与 Webview 卡片解析器遵循同一规则，因此旧载荷不渲染卡片，而不是渲染残缺卡片。

失败关闭是把双刃剑：`phase-plan.md` 无法解析的 workflow 现在会拒绝评审者派发，直到计划可读为止，而此前的矩阵会让该 Phase 无界面地跑下去。代价换来的是：UI Phase 无法通过弄坏自己的计划来跳过视觉链。

视觉评审者与原型门禁作用于 Feature 路径的 Phase；brief 管线的单一 `reviewer` 保持它的一份文件契约，跑 brief 管线的 UI workflow 按设计没有视觉视角。

IDE 会显示这条链：状态卡带有 HG-1.5 标记、计划声明为 UI 的每个 Phase 的原型标记，待决门禁也被命名（`等待门禁 HG-1.5` / `原型确认`）。这些门禁在卡片自己的决定表单上决定，见[IDE 面说明](2026-09-30-specdev-ide-surface.zh.md)；`confirmGate` 仍是唯一写入者。

## 测试

`packages/specdev/specdev/tests/ui-chain.spec.ts` 固定计划声明（解析、缺失、`'unknown'`、非布尔拒绝）、HG-1.5 的次序与三条拒绝、HG-2 对 HG-1.5 的依赖、原型门禁的完整路径（含已通过与非法决定两类拒绝）、非 UI 与无当前 Phase 的拒绝，以及 `mergePhaseReviews` 恰好对 `ui: true` 的 Phase 要求 `review-visual.md`。`packages/specdev/specdev/tests/phase-runtime.spec.ts` 固定四视角合并。`packages/specdev/specdev-guard/tests/specdev-guard.spec.ts` 固定派发拒绝：原型未确认、原型已确认、声明未知、`reviewer-visual` 处于非 UI Phase，以及非 UI Phase 不要求原型。`packages/ide/ide-bridge/tests/bridge-session-frames.spec.ts` 固定 v3 wire 视图、两个新门禁 id，以及缺失 `ui` 与畸形声明的拒绝；`apps/vscode-dsh/tests/cap-webview.spec.tsx` 固定卡片的 HG-1.5 标记、原型条与门禁名称。

## 相关

[SpecDev 子系统](../../../../docs/subsystems/specdev.zh.md) 承载面向用户的整体图景；[工作流权威笔记](2026-09-29-specdev-workflow-authority.zh.md) 持有视觉链所扩展的门禁与日志决定；[权限模型笔记](2026-09-30-specdev-permission-model.zh.md) 持有守卫的范围检查，二者共用派发路径；[守卫 README](../../../../packages/specdev/specdev-guard/README.zh.md) 列出强制检查，[预设 README](../../../../packages/specdev/specdev-presets/README.zh.md) 列出随包名册。
