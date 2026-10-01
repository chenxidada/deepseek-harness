---
description: "SpecDev 角色 agent presets，以及名册组合为它们挂载的预设根。"
kind: "package-reference"
---

# @deepseek-ai/dsh-specdev-presets

[English](README.md) | 中文

## 概述

`dsh-specdev-presets` 在 `presets/` 下提供 SpecDev **角色** preset 源文件（`requirement-analyst`、`plan-generator`、`code-explorer`、`implementer`、`reviewer-*`、`reviewer`、`verifier`、`wiki`），以及随附 id 与 {@link rolePresetId}。[`dsh-specdev-app`](../../bundle/specdev-app/README.zh.md) 组合包在其 `presets/*.patch.yml` 中以 `@deepseek-ai/dsh-agent-preset` 行把每个角色注册进 agent-preset registry。主会话不是 SpecDev 角色：SpecDev 经其斜杠命令进入，角色派生把各 preset 挂到子会话上，部署的通用默认（`standard`）仍是默认 agent。

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
- id: specdev-presets
  name: '@deepseek-ai/dsh-specdev-presets'
- id: agent-preset-registry
  name: '@deepseek-ai/dsh-agent-preset-registry'
  config:
    default: standard
- id: preset-specdev-implementer
  name: '@deepseek-ai/dsh-agent-preset'
  config:
    id: specdev-implementer
    name: SpecDev Implementer
    order: 20
    plugins: []
```

角色 presets 含自身工作所需的读写文件系统工具。角色派生在生成时附加 `specdev.role` / `specdev.slug` / `specdev.phaseId?`（AC-24）。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

| 路径 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `SpecdevPresetsService` + `SPECDEV_PRESET_ROOT` + `SPECDEV_PRESET_IDS` |
| [`presets/*/`](presets/) | `preset.yml` + `agent.cordis.yml` 资产 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Agent preset registry](../../preset/agent-preset-registry/README.zh.md) — 名册挂载契约。
- [SpecDev 运行时](../specdev/README.zh.md) — 这些预设所服务的斜杠命令面。

-----

<a id="model-experience"></a>
## 模型体验

### 角色 personas

#### 模型看到什么

每个 preset 的 `@deepseek-ai/dsh-persona` `text` 成为该 agent 的系统提示（`complete: true`），因此被派生的角色子会话以自身角色开始。

#### Token 影响

Persona 文本在该 agent 的每次模型请求中保留；长度按 preset 固定。

#### KV Cache 影响

persona 配置不变时前缀稳定；修改 `agent.cordis.yml` persona 会从首个系统提示 token 起失效复用。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **名册归属边界** — [`dsh-specdev-app`](../../bundle/specdev-app/README.zh.md) 为 agent-preset registry 声明这些 preset，并把部署默认保持在通用 `standard` agent；`HarnessSdkJsonRpcServer.createSession` 在存在该服务时通过 `agentPresets.mount` 挂载该默认。只有工作流入口才附加 `specdev.*` 元数据。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

**运行时不变式：** 不发布伴生入口。本包只承载角色 preset 源文件；声明归属 [`dsh-specdev-app`](../../bundle/specdev-app/README.zh.md)，`tests/specdev-presets.spec.ts` 覆盖随附根、preset 目录与发布的服务。

</details>
