---
description: "SpecDev 组地图：面向 DeepSeek Harness sdk 配置的 Spec 驱动工作流运行时、命令、gate/advance 执行与角色预设。"
kind: "package-group"
---

# packages/specdev

[English](README.md) | 中文

## 概述

SpecDev 组把 Spec 驱动开发带进 harness：在用户工作区落地持久 `.specdev` 布局，通过 `ctx.specdev.confirmGate` 确认 Human Gate，用会话事件与 `specdev/status` 投影服务桥接，并提供斜杠命令、失败关闭的流水线门禁、推进钩子与角色 agent 预设。默认 **sdk** 配置挂载 SpecDev 运行时，并禁用原生 `dsh-plan-mode`，避免 Spec `/plan` 与 plan-mode 冲突。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`specdev`](specdev/README.zh.md) | 工作区根、状态 I/O、`confirmGate`、事件、`specdev/status` 投影 | `ctx.specdev` |
| [`specdev-gate`](specdev-gate/README.zh.md) | 失败关闭式 pipeline-gate（`pre-step` / `pre-execute` / `guard`） | （listeners） |
| [`specdev-advance`](specdev-advance/README.zh.md) | 角色完成 → `specdev/advance` 引导 | （listeners） |
| [`command-specdev`](command-specdev/README.zh.md) | 斜杠命令 `/feature`…`/wiki`、`/confirm-gate`、`/status` | （commands 注册表） |
| [`specdev-presets`](specdev-presets/README.zh.md) | Orchestrator + 角色 presets；发布 `presetRoot` | `ctx.specdevPresets` |

Phase 4+ 兄弟能力：wiki 加固已完成（STUB-002 已关闭）。phase-runtime 的 git/review/debt 辅助现已挂在 `ctx.specdev`。

-----

<a id="related-documentation"></a>
## 相关文档

- [添加包](../../docs/cookbook/adding-a-package.zh.md) — 包清单。
- [会话投影](../session/session-projection/README.zh.md) — SpecDev 注册的投影 seam。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

Phase 1 交付 `@deepseek-ai/dsh-specdev` 与 sdk-app 挂载。Phase 2 增加 `command-specdev` 与 `specdev-presets`（含 sdk `agent-presets` roots）。Phase 3 交付 `specdev-gate` 与 `specdev-advance`。Phase 4 在 `ctx.specdev` 上补齐 `/implement` + git/review/debt/re-run；Phase 5 关闭 `/wiki` + 终态 HG-3 自动 wiki → `docs/wiki/`（STUB-002）。

</details>
