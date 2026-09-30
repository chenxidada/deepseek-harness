---
description: "SpecDev 组地图：面向 DeepSeek Harness ide 配置的 Spec 驱动工作流运行时、命令、守卫执行与角色预设。"
kind: "package-group"
---

# packages/specdev

[English](README.md) | 中文

## 概述

SpecDev 组把 Spec 驱动开发带进 harness：在用户工作区落地持久 `.specdev` 布局，通过 `ctx.specdev.confirmGate` 确认 Human Gate，用会话事件与 `specdev/status` 投影服务桥接，并提供斜杠命令、失败关闭的流水线门禁、推进引导与角色 agent 预设。**ide** profile 叠加 [`dsh-specdev-app`](../bundle/specdev-app/README.zh.md)，由它挂载运行时、守卫、预设与名册；**sdk** profile 全都不挂。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`specdev`](specdev/README.zh.md) | 工作区根、工作流日志权威、`confirmGate`、斜杠命令、事件、`specdev/status` 投影、角色完成 → `specdev/advance` 引导 | `ctx.specdev` |
| [`specdev-guard`](specdev-guard/README.zh.md) | 失败关闭式守卫（`pre-step` / `pre-execute` / `guard`）：门禁、角色调度、分支、状态镜像与工作区范围 | （listeners） |
| [`specdev-presets`](specdev-presets/README.zh.md) | Orchestrator + 角色 presets；发布 `presetRoot` | `ctx.specdevPresets` |

Phase 4+ 兄弟能力：wiki 加固已完成（STUB-002 已关闭）。phase-runtime 的 git/review/debt 辅助现已挂在 `ctx.specdev`。

-----

<a id="related-documentation"></a>
## 相关文档

- [添加包](../../docs/cookbook/adding-a-package.zh.md) — 包清单。
- [SpecDev 子系统参考](../../docs/subsystems/specdev.zh.md) — `.specdev` 布局、Human Gates、状态投影、阶段运行时与预设名册。
- [会话投影](../session/session-projection/README.zh.md) — SpecDev 注册的投影 seam。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

Phase 1 交付 `@deepseek-ai/dsh-specdev` 与 sdk-app 挂载。Phase 2 增加 `specdev-presets`（含 sdk `agent-presets` roots）。Phase 3 交付守卫。Phase 4 在 `ctx.specdev` 上补齐 `/implement` + git/review/debt/re-run；Phase 5 关闭 `/wiki` + 终态 HG-3 自动 wiki → `docs/wiki/`（STUB-002）。重构把 `workflow.jsonl` 定为工作流唯一真相（`current-status.json` 为生成镜像），把 `specdev-gate` 更名为 `specdev-guard`，把 `specdev-advance` 并入 `specdev`，并把命令面收敛进 `specdev`（`/feature`、`/bugfix`、`/research`、`/spec`、`/implement`、`/status`、`/wiki`）。

</details>
