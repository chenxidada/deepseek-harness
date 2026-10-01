---
description: "面向用户与维护者的 SpecDev profile 组合包：挂载 Spec 驱动工作流运行时及其门禁守卫与角色预设。"
kind: "package-bundle"
---

# `@deepseek-ai/dsh-specdev-app`

[English](README.md) | 中文

## 概述

SpecDev 应用作为 `dsh` profile 组合包，叠加在 [`dsh-sdk-app`](../sdk-app/README.zh.md) 之上。patch 插入 [`dsh-specdev`](../../specdev/specdev/README.zh.md)（工作流运行时、`workflow.jsonl` 权威、斜杠命令）、[`dsh-specdev-guard`](../../specdev/specdev-guard/README.zh.md)（失败关闭式门禁与角色强制）、[`dsh-specdev-presets`](../../specdev/specdev-presets/README.zh.md)（角色预设），以及部署默认保持通用 `standard` preset 的 [`dsh-agent-preset-registry`](../../preset/agent-preset-registry/README.zh.md)。preset 声明随后以 `presets/*.patch.yml` 给出：随附 `standard` preset 与每个 SpecDev 角色各一行 `@deepseek-ai/dsh-agent-preset`。`ide` profile 引用本包；`sdk` profile 保持无名册且不含 SpecDev。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

`ide` profile 会按 `PROFILE_TEMPLATES.ide` 自动初始化为 `dsh-base` + `dsh-sdk-app` + `dsh-ide` + `dsh-specdev-app`，无需额外参数。若只想在不引入 IDE 层的情况下使用 SpecDev，可在自建 profile 的 `dsh.profile.bundles` 中把 `@deepseek-ai/dsh-specdev-app` 排在 `dsh-sdk-app` 之后。

各行以 insert 形式加入，因此用户的 `cordis.patch.yml` 层仍可重述其 `config`，例如换用其他默认预设 id 或追加预设根。

<a id="model-experience"></a>
## 模型体验

None, as the bundle only inserts rows whose model-facing behavior belongs to the declared presets and `dsh-specdev-presets`.

#### KV 缓存效果

除插入的 SpecDev 各行外，不产生额外的模型请求影响。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **按 profile 安装** — 本包只被 `ide` profile 模板引用；要在其他 profile 上挂载 SpecDev，需显式列出本包。
- **预设信任** — 预设根行注册 `trust: system`，与原先 sdk-app 行相同；用户自己的根需要单独条目。
- **默认 agent** — 本包不会把工作流角色设为部署默认：主会话保持通用 `standard` agent，只有角色子会话挂载 SpecDev 预设。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

**运行时不变式：** 不发布伴随 invariant。组合测试负责插入的行；`specdev` 包测试负责各行所挂载的运行时。

</details>
