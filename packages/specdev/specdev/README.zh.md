---
description: "面向用户与维护者的 SpecDev 领域运行时：工作区 .specdev 解析、工作流日志权威、confirmGate、会话事件、推进引导与 specdev/status 投影。"
kind: "package-reference"
---

# @deepseek-ai/dsh-specdev

[English](README.md) | 中文

## 概述

`dsh-specdev` 是 SpecDev 领域运行时。它解析拥有 `.specdev` 的用户工作区根（绝不使用 `$DSH_HOME`），以工作流日志（`workflow.jsonl`）为权威并把 `current-status.json` 作为生成镜像导出，暴露 `ctx.specdev.active()` / `snapshot()` / `confirmGate()` 作为唯一 Human Gate 写入入口，在组合了命令注册表时注册 `/feature`、`/bugfix`、`/research`、`/spec`、`/implement`、`/status`、`/wiki` 命令，追加整视图 `specdev/*` 会话事件，在被派发角色结束时发射 `specdev/advance` 引导，在 Feature 终态 HG-3 通过后自动派发 wiki 角色，并注册 `specdev/status` 投影。当组合需要 Spec 驱动工作流状态、且不引入 ACP、SDK 协议、Web Conversation UI 或知识库同步时，挂载本包。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

用同时提供 `ctx.sessionProjections` 的组合条目加载：

```yaml
- name: '@deepseek-ai/dsh-specdev'
```

服务发布 `ctx.specdev`。常见调用：

```ts
const active = ctx.specdev.active({ cwd: workspaceRoot })
const snap = ctx.specdev.snapshot(session, { cwd: workspaceRoot })
const result = await ctx.specdev.confirmGate(session, { gate: 'hg1', decision: 'pass' }, { cwd: workspaceRoot })
await ctx.specdev.ensureLayout({ slug: 'my-feature', command: 'feature', workspaceRoot })
ctx.specdev.ensurePhaseBranch(phaseId, { cwd: workspaceRoot })
await ctx.specdev.dispatchRole(parent, { role: 'implementer', slug, phaseId })
ctx.specdev.completePhaseGit({ phaseId, files: ['src/a.ts'] }, { cwd: workspaceRoot })
```

### 工作区根（Q-1）

`resolveRoot` / `active` 优先选择已有 `.specdev/` 的文件夹；若多个匹配，与 `cwd` 相同者优先，否则取列表中第一个。尚无布局时使用主文件夹（或 `cwd`）。`$DSH_HOME` 绝不是 SpecDev 布局根。

### Human Gate

`confirmGate` 是唯一可将 `human_gates.*` 设为 `passed` 的接受路径。它校验门禁顺序（HG-2 依赖 HG-1，HG-3 依赖 HG-2），并对 `phase-plan.md` 声明了 UI 阶段的工作流校验视觉链：HG-1.5 在 HG-2 之前冻结已批准的 `visual-baseline.md`，逐阶段的 `prototype` 门禁（依据计划里的 `ui: true` 声明与该阶段 `implementation.md` 中的 `## Prototype` 段）在该 UI 阶段的评审者运行前确认其静态原型。被接受的门禁会原子写入 `current-status.json`、追加 `specdev/gate-decided` 并推进 `specdev/status` 投影。

### 快照视图

`snapshot` 以 bridge 视图返回持久状态——slug、stage、phase、各 Gate 状态、逐阶段的 step 与 prototype 状态、计划中的 `ui` 声明、pending gate、循环计数，以及注册表可解析时的技术债摘要——外加两个 IDE 直接渲染的视图。`plan` 按 DAG 顺序列出阶段计划，给出每个阶段的依赖关系与其 `done` / `active` / `todo` 进度；`phase-plan.md` 缺失或无法解析时该字段缺省，因此坏计划绝不会让状态读取失败。`artifacts` 始终列出活动工作流的文档：工作流级的 `requirements.md`、`design.md`、`phase-plan.md`（计划声明了 UI 阶段时再加 `visual-baseline.md`），随后是每个阶段的 `repo-exploration.md`、`implementation.md`、三份审查报告、`review.md` 与 `verification.md`——计划声明 `ui: true` 的阶段另有 `review-visual.md`。每一行都携带工作区相对的 POSIX 路径，以及直接读取文件得出的 `ready` / `missing` 状态；阶段行按计划顺序排列，计划不可读时改用持久状态自身的顺序。

### 元数据

`attachSpecdevMetadata` / `readSpecdevMetadata` 在 `AgentOptions` 上发布 `specdev.role`、`specdev.slug` 与可选的 `specdev.phaseId`，供桥接 Tab 谱系使用。角色预设本身在后续 Phase 交付。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

- **持久 SoT。** `.specdev/specs/<slug>/workflow.jsonl` 是恢复权威；`current-status.json` 是生成镜像，会话事件携带整视图供桥接与投影。
- **投影。** 键 `'specdev/status'`，`stateVersion: 1`，Zod `stateSchema` + wire `viewSchema`。无关事件返回同一状态引用。
- **事件。** `SessionEventMap` 合并 `specdev/workflow`、`gate-pending`、`gate-decided`、`phase`、`dispatch`、`review-verdict` 与 `advance`（在被派发角色进入 idle 时发射）。
- **禁止依赖。** 无 ACP 或 SDK 协议包。
- **ide 挂载。** `ide` profile 叠加 [`dsh-specdev-app`](../../bundle/specdev-app/README.zh.md)，由它插入本包；`sdk` profile 两者都不挂。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- 组地图：[`packages/specdev/README.zh.md`](../README.zh.md)
- 会话投影 seam：[`@deepseek-ai/dsh-session-projection`](../../session/session-projection/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过后续 Phase 中消费 `ctx.specdev` 的 SpecDev 斜杠命令与角色预设；本包自身不注册提示词段落或工具 schema。

#### KV 缓存效果

与模型请求 token 无关：SpecDev 状态存在于工作区文件与会话事件中，不在模型 transcript 里。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **斜杠命令** — `/feature`、`/bugfix`、`/research`、`/spec` 启动工作流；不带描述的 `/spec` 执行设计步骤；`/implement`、`/status`、`/wiki` 驱动既有工作流。Human Gate 决定由面板经 `confirmGate` 应用，不走命令。
- **Orchestrator 预设** — 由 `specdev-presets` 负责。
- **Gate waterfall** — 已在 `specdev-guard` 交付；本包负责 advance 监听与终态 HG-3 的 wiki 推进（Phase 3）。
- **工作流日志权威** — `workflow.jsonl` 是唯一真相（`workflow-log.ts`）；`current-status.json` 是每次追加后导出的生成镜像，无日志的旧工作流首次被触碰时自动认领。
- **Wiki** — `ctx.specdev.dispatchWiki`（Standalone / Pipeline）→ 工作区 `docs/wiki/`；`/wiki` 与终态 HG-3 自动路径共享该契约（Phase 5 / STUB-002 已关闭）。无 Knowledge Base 同步（AC-55）。
- **Snapshot schema v4** — v2 增加可选的 `pipelineMode` / `initiatingCommand`，v3 增加视觉链（`gates.hg1_5`、`steps[].prototype` 与 `ui`），v4 增加 IDE 视图 `plan`（`SpecdevPlanRow`）与 `artifacts`（`SpecdevArtifactRow`）。fold 对 wire 视图严格解析，缺少必需字段或字段形状错误的载荷都会被拒绝并记录失败，而不是降级接受。
- **Phase runtime（Phase 4）** — `ensurePhaseBranch` / `completePhaseGit` / `mergePhaseReviews` / `prepareRerun` / tech-debt Entry Gate；阶段声明 `ui: true` 时，`mergePhaseReviews` 会把 `review-visual.md` 与三个 Feature 视角一并合并；`dispatchRole` 通过 `createUserMessage` + `followup` 唤醒子 Agent。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

**运行时不变式：** 不发布伴生入口。`.specdev` 布局、门禁次序、阶段运行时与 wiki 调度都由这一个服务持有，改动其中任何一项都是改动工作流义务本身；`tests/specdev.spec.ts` 与 `tests/phase-runtime.spec.ts` 覆盖布局、门禁转移与阶段运行时。

</details>
