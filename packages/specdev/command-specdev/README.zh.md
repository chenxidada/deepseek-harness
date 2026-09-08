---
description: "SpecDev 斜杠命令（/feature…/wiki、confirm-gate、/status），供在 sdk 配置文件上组合 Spec 驱动工作流的用户与维护者使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-command-specdev

[English](README.md) | 中文

## 摘要

`dsh-command-specdev` 在主机命令注册表上注册 SpecDev 斜杠命令面：`/feature`、`/bugfix`、`/brief`、`/research`、`/specify`、`/plan`、`/implement`、`/status`、`/wiki`，以及可选的 `/confirm-gate`。命令调用 `ctx.specdev.ensureLayout` / `snapshot` / `confirmGate`，不会把模糊自然语言回复当作门禁通过。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

与 `specdev`、`commands` 一起挂载（sdk-app 会自动插入）：

```yaml
- id: command-specdev
  name: '@deepseek-ai/dsh-command-specdev'
  inject: [specdev, commands]
```

| 命令 | 行为 |
|---|---|
| `/feature <desc>` | 确保 `.specdev` 布局；多 Phase Feature 走向 HG-1 |
| `/bugfix` / `/brief` / `/research` / `/specify` | 同级启动模式（见设计） |
| `/plan` | 架构路径；HG-1 未过或 requirements 为空时拒绝 |
| `/status` | 与 `snapshot()` 一致的人类可读报告 |
| `/confirm-gate <gate> <pass\|确认\|通过\|…>` | 唯一 NLP→API 路径，共享 `confirmGate` |
| `/implement` | Phase 运行时闭环：Entry Gate → `ensurePhaseBranch` → explorer/implementer 调度 + followup |
| `/wiki` | 已注册；实体延后到 Phase 5 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

处理器不会把斜杠行发给模型。工作流启动命令调用 `ensureLayout`（含 constitution / tech-debt 模板），并把 `pipeline_mode` / `initiating_command` 写入 `current-status.json`。门禁确认使用 `interpretGateReply`，只有明确关键词才会变成 `pass` / `reject` / `defer`。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 命令注册与处理器 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [SpecDev 运行时](../specdev/README.zh.md) — `ctx.specdev` API。
- [SpecDev presets](../specdev-presets/README.zh.md) — Orchestrator / 角色 presets。
- [Commands 包](../../interaction/commands/README.zh.md) — 注册表契约。

-----

<a id="model-experience"></a>
## 模型体验

### SpecDev 斜杠命令

#### 模型看到什么

斜杠输入与 `CommandResult` 文本不进入模型请求。成功文案中的 Orchestrator 指引仅供 UI，除非后续轮次复制进对话。

#### Token 影响

命令注册与处理结果不直接产生模型 token。

#### KV Cache 影响

与模型缓存独立；命令簿记不会改写会话前缀。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **`/wiki` 实体未完成** — 返回 `@STUB(phase-5-wiki-hardening)`；wiki 调度属 Phase 5。
- **HG-3 git** — Orchestrator 须在 `confirmGate(hg3)` 之后调用 `ctx.specdev.completePhaseGit({ phaseId, files })`，文件列表必须显式（禁止 `git add -A`）。
