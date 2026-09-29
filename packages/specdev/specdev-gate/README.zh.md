---
description: "SpecDev 失败关闭式 pipeline-gate：以 Cordis pre-step / pre-execute / tools.guard 强制 Human Gate、git 分支与回炉上限。"
kind: "package-reference"
---

# @deepseek-ai/dsh-specdev-gate

[English](README.md) | 中文

## 概述

`dsh-specdev-gate` 把 Cursor shell hook 的 pipeline-gate 意图落地为原生 Cordis 强制：包装 `ctx.specdev.dispatchRole`、在 `agent/pre-step` 拒绝未就绪角色，并通过 `tools/pre-execute` + `tools.guard` 拒绝对 `current-status.json` 的工具写入。Human Gate 权威来自会话投影 / `confirmGate` 事件——裸改 JSON 的 HG 翻转不算通过（AC-28）。

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
- id: specdev-gate
  name: '@deepseek-ai/dsh-specdev-gate'
  inject: [specdev, tools, sessionProjections]
```

| 检查 | 行为 |
|---|---|
| HG / 阶段就绪 | 投影 gates 或 stage 未就绪时拒绝 implementer / reviewer* / verifier |
| Git 分支（implementer） | 分支 ≠ `impl-<current_phase>` 时拒绝（不创建分支） |
| 回炉上限 | `loop_count >= 2` 时拒绝并带 `escalate:user` |
| 状态文件写入 | 禁止在 `confirmGate` 之外 write/edit `current-status.json` |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件：包装 dispatchRole、pre-step、pre-execute、guard |
| [`src/authority.ts`](src/authority.ts) | 投影 / 失败关闭权威状态（AC-28） |
| [`src/check.ts`](src/check.ts) | 纯函数角色矩阵判定 |
| [`src/git-branch.ts`](src/git-branch.ts) | `git branch --show-current` 读取 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [SpecDev 运行时](../specdev/README.zh.md) — `confirmGate` 唯一 HG 写入路径。
- [SpecDev advance](../specdev-advance/README.zh.md) — 完成后引导事件。
- [Tools](../../core/tools/README.zh.md) — `pre-execute` / `guard`。

-----

<a id="model-experience"></a>
## 模型体验

### Gate 拒绝

#### 模型看到什么

被拒绝的工具调用返回带 gate 原因的错误内容块。被拒绝的 `agent/pre-step` 使该步无法进入模型回合。`dispatchRole` 抛出的 `SpecdevGateDeniedError` 面向 Orchestrator（除非写入对话，否则不计入模型 token）。

#### Token 影响

在工具体执行前拒绝时无直接 token；若 Orchestrator/工具环在后续回合上报拒绝结果，则可能出现在后续模型上下文中。

#### KV Cache 影响

与模型缓存无关；gate 记账不改写对话前缀。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **分支创建/合并** — 本包只拒绝错误/缺失分支；`ensurePhaseBranch` / HG-3 git 合并属于 Phase 4。
- **产物预检** — Cursor gate 会检查 `repo-exploration.md` / `implementation.md` / `review.md`；Phase 3 AC 聚焦 HG/阶段/分支/回炉，更深产物矩阵可随 Phase 4 runtime 落地。
- **Bash 路径绕过** — write/edit `current-status.json` 会被拒绝；即便 bash 改写文件，AC-28 仍因权威忽略未事件化的文件 HG 通过而生效。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

不发布 companion invariant。本包只对工具调用与角色调度做拒绝/放行判定；门禁次序、产物前置条件与持久追加属于 `specdev` 运行时，`tests/specdev-gate.spec.ts` 覆盖各条拒绝路径。

</details>
