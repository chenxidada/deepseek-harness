---
description: "面向用户与维护者的 SpecDev 领域运行时：工作区 .specdev 解析、current-status I/O、confirmGate、会话事件与 specdev/status 投影。"
kind: "package-reference"
---

# @deepseek-ai/dsh-specdev

[English](README.md) | 中文

## 概述

`dsh-specdev` 是 SpecDev 领域运行时。它解析拥有 `.specdev` 的用户工作区根（绝不使用 `$DSH_HOME`），读写持久 `current-status.json`，暴露 `ctx.specdev.active()` / `snapshot()` / `confirmGate()` 作为唯一 Human Gate 写入入口，追加整视图 `specdev/*` 会话事件，并注册 `specdev/status` 投影。当组合需要 Spec 驱动工作流状态、且不引入 ACP、SDK 协议、Web Conversation UI 或知识库同步时，挂载本包。

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

`confirmGate` 是唯一可将 `human_gates.*` 设为 `passed` 的接受路径。它校验门禁顺序（HG-2 依赖 HG-1，HG-3 依赖 HG-2），原子写入 `current-status.json`，追加 `specdev/gate-decided`，并推进 `specdev/status` 投影。

### 元数据

`attachSpecdevMetadata` / `readSpecdevMetadata` 在 `AgentOptions` 上发布 `specdev.role`、`specdev.slug` 与可选的 `specdev.phaseId`，供桥接 Tab 谱系使用。角色预设本身在后续 Phase 交付。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

- **持久 SoT。** `.specdev/specs/<slug>/current-status.json` 是恢复权威；会话事件携带整视图供桥接与投影。
- **投影。** 键 `'specdev/status'`，`stateVersion: 1`，Zod `stateSchema` + wire `viewSchema`。无关事件返回同一状态引用。
- **事件。** `SessionEventMap` 合并 `specdev/workflow`、`gate-pending`、`gate-decided`、`phase`、`dispatch`、`review-verdict` 与 `advance`（advance 发射属后续包）。
- **禁止依赖。** 无 ACP 或 SDK 协议包。
- **sdk 挂载。** 默认 sdk 组合在 `packages/bundle/sdk-app/cordis.patch.yml` 中插入本包，并禁用基座 `plan-mode`。

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

- **斜杠命令 / Orchestrator 预设** — 不在本包注册；由 `command-specdev` / `specdev-presets` 负责 `/feature`…`/wiki` 与角色资产。
- **Gate waterfall / advance 监听** — 已在 `specdev-gate` / `specdev-advance`（Phase 3）交付。
- **Wiki** — `ctx.specdev.dispatchWiki`（Standalone / Pipeline）→ 工作区 `docs/wiki/`；`/wiki` 与终态 HG-3 自动路径共享该契约（Phase 5 / STUB-002 已关闭）。无 Knowledge Base 同步（AC-55）。
- **Snapshot schema v2** — `SpecdevSnapshot` 可含可选 `pipelineMode` / `initiatingCommand`（来自 durable `pipeline_mode` / `initiating_command`）。fold 同时接受无这些字段的 v1 与带字段的 v2 载荷。
- **Phase runtime（Phase 4）** — `ensurePhaseBranch` / `completePhaseGit` / `mergePhaseReviews` / `prepareRerun` / tech-debt Entry Gate；`dispatchRole` 通过 `createUserMessage` + `followup` 唤醒子 Agent。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

不发布 companion invariant。`.specdev` 布局、门禁次序、阶段运行时与 wiki 调度都由这一个服务持有，改动其中任何一项都是改动工作流义务本身；`tests/specdev.spec.ts` 与 `tests/phase-runtime.spec.ts` 覆盖布局、门禁转移与阶段运行时。

</details>
