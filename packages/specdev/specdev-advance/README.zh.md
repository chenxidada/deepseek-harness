---
description: "SpecDev pipeline-advance：在 SpecDev 角色子 Agent 完成时发出 specdev/advance 引导（绝不自动通过 Human Gate）。"
kind: "package-reference"
---

# @deepseek-ai/dsh-specdev-advance

[English](README.md) | 中文

## 概述

`dsh-specdev-advance` 监听 SpecDev 角色完成，并在父（Orchestrator）会话上追加整视图 `specdev/advance` 事件与下一步引导。主信号是子 Agent `agent/status` 从 `running → idle`（Phase 2 的 `dispatchSpecdevRole` 使用 `agents.create`，因此 `subagent/end` 可能永不触发）。它从不调用 `confirmGate`，也从不翻转 Human Gate 标志。

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

```yaml
- id: specdev-advance
  name: '@deepseek-ai/dsh-specdev-advance'
  inject: [specdev, agents]
```

角色子 Agent 进入 idle 后，父会话会收到：

```ts
session.append('specdev/advance', {
  kind: 'specdev/advance',
  version: 1,
  nextAction: '…guidance…',
  snapshot, // whole post-change view or null
})
```

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `agent/status` + `subagent/end` 监听；emit 辅助 |
| [`src/guidance.ts`](src/guidance.ts) | 角色 → nextAction 文案（pipeline-advance 意图） |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [SpecDev gate](../specdev-gate/README.zh.md) — 失败关闭式调度强制。
- [SpecDev 运行时](../specdev/README.zh.md) — `SpecdevAdvanceEvent` 类型与投影折叠。
- [Agent](../../core/agent/README.zh.md) — `agent/status` 生命周期。

-----

<a id="model-experience"></a>
## 模型体验

### Advance 引导

#### 模型看到什么

`specdev/advance` 是面向 Orchestrator / 桥接消费者的会话事件。除非后续回合把 `nextAction` 复制进对话，否则不会自动注入模型请求。

#### Token 影响

仅事件发射本身不产生直接模型 token。

#### KV Cache 影响

与模型缓存无关；advance 事件不改写对话前缀。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **Dispatch followup** — Phase 4 已关闭 GAP-002：`dispatchSpecdevRole` 用 `createUserMessage` + `agent.followup` 唤醒子 Agent（传 `prompt: null` 可跳过）。
- **Fallback Agent** — 永不离开 `idle` 的轻量 `dispatchSpecdevRole` fallback 不会经 status 路径发出 advance；测试中请使用真实 agent-loop 子 Agent 或显式调用 `emitAdvanceForAgent`。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

不发布 companion invariant。本包承载调度策略与完成态投影；`SpecdevAdvanceEvent` 类型与投影折叠属于 `specdev` 运行时，`tests/specdev-advance.spec.ts` 覆盖落地点与折叠。

</details>
